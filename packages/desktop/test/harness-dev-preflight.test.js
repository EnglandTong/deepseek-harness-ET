// HARNESS_DEV phantom-path preflight (2026-07-18, fix/harness-dev-guard).
//
// profiles.js resolves the harness checkout via resolveHarnessDev (env
// DSH_DEV_ROOT, then the apps/cli walk-up, then the sibling clone). When the
// resolved root doesn't hold the CLI entry — a worktree without the checkout,
// or an installer user who never cloned deepseek-harness — spawn dies with
// `spawn <path> ENOENT` and an empty stderr, and the shell used to
// misclassify it as "Runtime file missing — check your profile leaves"
// (wrong hint). The fix is a fail-loud preflight that emits an actionable
// error before spawn.
//
// These tests drive `preflightRuntimeBinaries()` directly. The dev spawn is
// `dsh --profile sdk` (packages/examples/jsonrpc-demo is gone), so the only
// dev precondition is the CLI entry plus installed deps (tsx) and an
// adequate Node. Bundled profiles precondition only the staged exe. The
// Electron wiring in main.js is exercised by a static grep — no
// BrowserWindow / IPC boot needed for the unit path.
//
// Companion fixes tested in siblings:
//   test/renderer-runtime-banner-classify.test.js  — classifier bucket
//   test/runtime-stderr-log.test.js                — full-stderr log file

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  preflightRuntimeBinaries,
  _HARNESS_DEV,
  _dshCliBin,
} = require('../src/main/profiles.js')

test('preflight: throws DSH_RUNTIME_SDK_NOT_FOUND when the dsh CLI entry is absent from HARNESS_DEV', () => {
  // In a worktree checkout the sibling `deepseek-harness-dev/` doesn't
  // exist, so this fires the real error path. If a future test runner
  // materializes the checkout there, this test skips its own body — the
  // guard is functionally correct either way, but the fail-loud shape is
  // what we're locking here.
  let cliExists = true
  try { fs.accessSync(_dshCliBin) } catch (_) { cliExists = false }
  if (cliExists) {
    // Checkout is on disk (dev environment ran from the main clone). Skip.
    return
  }
  assert.throws(
    () => preflightRuntimeBinaries('stdio-deepseek'),
    (err) => {
      assert.equal(err.code, 'DSH_RUNTIME_SDK_NOT_FOUND', 'error must carry the sentinel code')
      assert.match(err.message, /DSH CLI entry not found at /, 'message names the specific path')
      assert.match(err.message, /DSH_DEV_ROOT/, 'message names the env override')
      assert.match(err.message, /clone deepseek-harness as a sibling/, 'message names the second fix')
      assert.ok(Array.isArray(err.missingPaths) && err.missingPaths.length > 0, 'missingPaths payload present')
      assert.equal(err.harnessDevRoot, _HARNESS_DEV, 'harnessDevRoot payload for diagnostics')
      return true
    },
  )
})

test('preflight: bundled deepseek profiles precondition only the staged exe', () => {
  // The bundled runtime composes from DSH_HOME at runtime, so the exe (plus
  // its ripgrep sidecar) is the whole precondition — no checkout, tsx, or
  // system Node participates. Point DSH_BUNDLED_RUNTIME_DIR at a stub and
  // re-require so BUNDLED_RUNTIME resolves.
  const stubDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dsh-preflight-'))
  fs.writeFileSync(path.join(stubDir, 'deepseek-harness-sdk-runtime-win-x64.exe'), '')
  process.env.DSH_BUNDLED_RUNTIME_DIR = stubDir
  try {
    delete require.cache[require.resolve('../src/main/profiles.js')]
    const fresh = require('../src/main/profiles.js')
    const resolved = fresh.preflightRuntimeBinaries('stdio-deepseek')
    assert.match(resolved.bundledRuntime, /deepseek-harness-sdk-runtime-win-x64\.exe$/)
    // The stdio (dev) profile still reports the CLI anchor for diagnostics.
    assert.ok(resolved.dshCliBin.endsWith(path.join('apps', 'cli', 'src', 'bin.ts')))
  } finally {
    delete process.env.DSH_BUNDLED_RUNTIME_DIR
    delete require.cache[require.resolve('../src/main/profiles.js')]
    fs.rmSync(stubDir, { recursive: true, force: true })
  }
})

test('preflight: disabled daemon/echo profiles never reach the spawn preflight', () => {
  // Retired profiles surface no spawnable runtime; main.js fails loud on
  // `disabled` before calling preflight. Lock the shape here too so a
  // preflight call on them cannot resurrect a phantom daemon/echo spawn.
  for (const name of ['daemon-echo', 'stdio-echo', 'daemon-vibe-echo']) {
    const p = require('../src/main/profiles.js').profile(name)
    assert.equal(p.disabled, true, `${name} must stay disabled so preflight is unreachable for it`)
  }
})

test('preflight: main.js calls preflight inside startRuntime before constructing the supervisor', () => {
  // Static lock: the wiring must exist and must run BEFORE `new
  // RuntimeSupervisor(...)`. If a future refactor moves preflight past
  // that line, spawn will still race the classifier and the whole point
  // of the fail-loud path is lost.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8')
  const preflightIdx = src.indexOf('preflightRuntimeBinaries(name)')
  assert.notEqual(preflightIdx, -1, 'preflightRuntimeBinaries must be called from main.js')
  const supervisorIdx = src.indexOf('new RuntimeSupervisor(')
  assert.notEqual(supervisorIdx, -1, 'RuntimeSupervisor construction must still exist in main.js')
  assert.ok(preflightIdx < supervisorIdx, 'preflight must run BEFORE new RuntimeSupervisor')
  // The failure branch must send runtime:error so the classifier's
  // Runtime-binary-failed-to-launch bucket picks it up.
  const window = src.slice(preflightIdx, supervisorIdx)
  assert.match(window, /send\('runtime:error'/, 'preflight failure must emit runtime:error to the renderer')
})
