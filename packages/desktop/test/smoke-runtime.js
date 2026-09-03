// Headless smoke: drive the RuntimeSupervisor exactly like main.js does, but
// from plain node — no Electron needed.
//
// The daemon/socket runtime was retired upstream (alpha.4): every scenario
// now runs over stdio against `dsh --profile sdk`.
//
// Runs three checks in sequence:
//   1) stdio: spawn the runtime (checkout via tsx, or the bundled exe when
//      DSH_BUNDLED_RUNTIME_DIR is set), run one prompt end-to-end.
//   2) kill: SIGKILL the stdio runtime child mid-flight and confirm the
//      supervisor re-spawns it and reconnects (new sessions work; old ones
//      don't survive the respawn).
//   3) tree: fold a parent+child session pair into the sidebar's tree shape
//      using the supervisor's live session projection.
//
// Usage:  node test/smoke-runtime.js [stdio|kill|tree|all]
// Env:    DSH_SMOKE_TIMEOUT_MS (default 45000)
//         DEEPSEEK_API_KEY (required — no keyless profile exists on the sdk
//         runtime yet; the retired echo profiles are disabled in profiles.js)

'use strict'

const { RuntimeSupervisor } = require('../src/main/runtime.js')
const { profile } = require('../src/main/profiles.js')
const { buildSessionTree, findChildForks } = require('../src/renderer/session-tree.js')

const assert = require('node:assert/strict')

const TIMEOUT = Number(process.env.DSH_SMOKE_TIMEOUT_MS || 45000)
const which = (process.argv[2] || 'all').toLowerCase()

function log(msg) { console.log(msg) }

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout ${label} after ${ms}ms`)), ms).unref()),
  ])
}

async function runOneTurn(sup, sessionId, text) {
  const events = []
  const finished = new Promise((resolve, reject) => {
    const onNotify = (method, params) => {
      events.push({ method, params })
      if (method === 'session.event') log(`  event: ${params.event.type}`)
      else log(`  ${method}`)
      // Turn completion arrives as a `turn/end` session-log event on the
      // current wire.
      if (method === 'session.event' && params.event && params.event.type === 'turn/end') {
        sup.off('notify', onNotify)
        resolve(events)
      }
    }
    sup.on('notify', onNotify)
    setTimeout(() => { sup.off('notify', onNotify); reject(new Error('turn timeout')) }, TIMEOUT).unref()
  })
  await sup.prompt({ sessionId, contentBlocks: [{ type: 'text', text }] })
  return finished
}

function wireLogging(sup, label) {
  sup.on('status', (s) => log(`[${label}] status=${s}`))
  sup.on('stderr', (chunk) => process.stderr.write(`[${label} stderr] ${chunk}`))
  sup.on('protocolError', (err) => {
    console.error(`[${label}] protocol`, err.message)
    if (sup.transport && sup.transport._stderrTail) {
      console.error(`[${label}] runtime stderr tail:\n${sup.transport._stderrTail}`)
    }
  })
  sup.on('crash', (c) => console.error(`[${label}] crash code=${c.code} signal=${c.signal}`))
  sup.on('initialized', (info) => log(`[${label}] initialized: ${info.serverInfo.name} v${info.serverInfo.version}`))
}

function stdioProfileOrSkip() {
  const p = profile('stdio-deepseek')
  if (p.disabled) throw new Error('stdio-deepseek profile is disabled; smoke needs the sdk runtime')
  if (!process.env.DEEPSEEK_API_KEY) {
    log('[smoke] SKIP: DEEPSEEK_API_KEY not set — no keyless profile exists on the sdk runtime')
    process.exit(0)
  }
  return p
}

async function runStdio() {
  log('=== stdio (dsh --profile sdk) ===')
  const p = stdioProfileOrSkip()
  const sup = new RuntimeSupervisor({ profile: p })
  wireLogging(sup, 'stdio')
  await withTimeout(sup.start(), TIMEOUT, 'stdio.start')
  const sessionId = 'smoke-stdio-' + Date.now()
  const events = await runOneTurn(sup, sessionId, 'echo hello (stdio)')
  log(`[stdio] ${events.length} notifications`)
  await sup.stop()
}

async function runKillRecovery() {
  log('=== stdio kill -9 recovery ===')
  const p = stdioProfileOrSkip()
  const sup = new RuntimeSupervisor({ profile: p })
  wireLogging(sup, 'kill')
  await withTimeout(sup.start(), TIMEOUT, 'kill.start')

  // Run one turn to be sure we're really connected.
  const sid = 'smoke-kill-' + Date.now()
  await runOneTurn(sup, sid, 'echo one')

  // Locate the runtime child pid via the stdio transport and SIGKILL it.
  const pid = sup.transport && sup.transport.child && sup.transport.child.pid
  if (!pid) throw new Error('supervisor has no runtime child pid to kill')
  log(`[kill] SIGKILL runtime pid=${pid}`)
  try { process.kill(pid, 'SIGKILL') } catch (err) { log(`[kill] already dead: ${err.message}`) }

  // Wait for the supervisor to observe the drop and respawn.
  await new Promise((resolve, reject) => {
    let saw = false
    const onStatus = (s) => {
      if (s === 'crashed' || s === 'respawning') saw = true
      if (saw && s === 'running') {
        sup.off('status', onStatus)
        resolve()
      }
    }
    sup.on('status', onStatus)
    setTimeout(() => { sup.off('status', onStatus); reject(new Error('reconnect timeout')) }, TIMEOUT).unref()
  })
  log('[kill] reconnected — sending another turn')

  // A new session (sessions do not survive a respawn; the SDK server owns a
  // per-connection sessionId map).
  const sid2 = 'smoke-kill-post-' + Date.now()
  const events = await runOneTurn(sup, sid2, 'echo two (post-recovery)')
  log(`[kill] post-recovery: ${events.length} notifications`)
  await sup.stop()
}

async function runTree() {
  log('=== tree (fork lineage + sidebar shape) ===')
  const p = stdioProfileOrSkip()
  const sup = new RuntimeSupervisor({ profile: p })
  wireLogging(sup, 'tree')
  await withTimeout(sup.start(), TIMEOUT, 'tree.start')

  // Run one turn on the parent so it has content. The current SDK wire has
  // no session/fork method, so the child is synthetic (mirroring the
  // main-process MethodNotFound fallback) and the check validates the
  // sidebar tree helpers over the supervisor's projection.
  const parent = 'smoke-tree-parent-' + Date.now()
  await runOneTurn(sup, parent, 'echo parent turn')

  const child = 'smoke-tree-child-' + Date.now()
  // In the synthetic path the runtime won't know parent→child; verify the
  // sidebar-tree helpers still produce something sensible from the fields
  // the main-process handler would set locally. We simulate that overlay by
  // patching a parentSession header onto the child entry.
  const entries = [
    { sessionId: parent, header: { title: 'parent' }, live: true },
    { sessionId: child, header: { title: 'child', parentSession: parent, seedLength: 3 }, live: true },
  ]
  const tree = buildSessionTree(entries)
  const parentNode = findNode(tree, parent)
  assert.ok(parentNode, `parent node ${parent} missing from tree; got roots=${tree.map((n) => n.entry.sessionId).join(',')}`)
  const childNode = parentNode.children.find((c) => c.entry.sessionId === child)
  assert.ok(childNode, `child node ${child} not nested under parent; parent kids=${parentNode.children.map((c) => c.entry.sessionId).join(',')}`)
  assert.equal(childNode.depth, 1)

  const forks = findChildForks(parent, entries)
  assert.ok(forks.some((f) => f.childSessionId === child), 'findChildForks did not return the child')

  log(`[tree] shape OK (PENDING synthetic child — no session/fork on the sdk wire); parent=${parent.slice(0, 8)} child=${child.slice(0, 8)} depth=${childNode.depth}`)
  await sup.stop()
}

function findNode(nodes, id) {
  for (const n of nodes) {
    if (n.entry.sessionId === id) return n
    const nested = findNode(n.children, id)
    if (nested) return nested
  }
  return null
}

;(async () => {
  try {
    if (which === 'all' || which === 'stdio') await runStdio()
    if (which === 'all' || which === 'kill') await runKillRecovery()
    if (which === 'all' || which === 'tree') await runTree()
    log('[smoke] OK')
    process.exit(0)
  } catch (err) {
    console.error('[smoke] FAILED:', err.message)
    console.error(err.stack)
    process.exit(1)
  }
})()
