// Packaged-mode checkout resolution lock (dev-root.js).
//
// A packaged shell cannot walk up from `src/main/` (the code lives inside
// app.asar), so discovery runs at main-process startup and materializes
// `DSH_DEV_ROOT`. The candidate order is a contract:
//
//   1. env `DSH_DEV_ROOT` — untouched, wins.
//   2. config.json `harnessDevRoot` — validated against the runtime marker.
//   3. walk-up from the portable origin dir, then the exe dir.
//   4. `~/deepseek-harness`, then `~/deepseek-harness-dev`.
//
// Every candidate must hold `apps/cli/src/bin.ts` (the dsh CLI entry the
// alpha.4 source launch spawns), so stale config values and unrelated
// directories are skipped. Fixtures resolve every root through `path.resolve`
// before joining the marker so the ordering is locked identically on Windows
// and POSIX separators.

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const realFs = require('node:fs')

const { resolvePackagedDevRoot, walkUpToMarker, DEV_ROOT_MARKER } = require('../src/main/dev-root.js')

const MARKER_AT = (root) => path.join(path.resolve(root), DEV_ROOT_MARKER)

function mockFsWith(existing) {
  const set = existing instanceof Set ? existing : new Set(existing)
  return (p) => set.has(p)
}

function baseDeps(fs, over = {}) {
  return {
    env: {},
    homedir: path.resolve('/home/user'),
    exists: fs,
    exeDir: path.resolve('/opt/dsh-desktop'),
    portableDir: undefined,
    ...over,
  }
}

test('env DSH_DEV_ROOT wins and is resolved to an absolute path', () => {
  const fs = mockFsWith([MARKER_AT('/repo')])
  const got = resolvePackagedDevRoot(baseDeps(fs, { env: { DSH_DEV_ROOT: '/custom/checkout' } }))
  assert.deepEqual(got, { source: 'env', root: path.resolve('/custom/checkout') })
})

// readConfiguredDevRoot reads the real filesystem, so the config-candidate
// tests materialize a temp config.json and lock the contract end to end.
function tempConfigHome(config) {
  const dir = realFs.mkdtempSync(path.join(os.tmpdir(), 'dsh-dev-root-'))
  realFs.writeFileSync(path.join(dir, 'config.json'), typeof config === 'string' ? config : JSON.stringify(config))
  return dir
}

test('config candidate: valid harnessDevRoot is used and marker-validated', () => {
  const configHome = tempConfigHome({ harnessDevRoot: path.resolve('/repo-from-config') })
  try {
    const fs = mockFsWith([MARKER_AT('/repo-from-config')])
    const got = resolvePackagedDevRoot(baseDeps(fs, { configHome }))
    assert.deepEqual(got, { source: 'config', root: path.resolve('/repo-from-config') })
  } finally {
    realFs.rmSync(configHome, { recursive: true, force: true })
  }
})

test('config candidate: a stale harnessDevRoot without the marker is skipped', () => {
  const configHome = tempConfigHome({ harnessDevRoot: path.resolve('/stale-checkout') })
  try {
    const fs = mockFsWith([])
    const got = resolvePackagedDevRoot(baseDeps(fs, { configHome }))
    assert.equal(got, null, 'stale config must fall through, not produce phantom spawn paths')
  } finally {
    realFs.rmSync(configHome, { recursive: true, force: true })
  }
})

test('config candidate: malformed config.json is ignored, not fatal', () => {
  const dir = tempConfigHome('{ not json')
  try {
    const fs = mockFsWith([])
    const got = resolvePackagedDevRoot(baseDeps(fs, { configHome: dir }))
    assert.equal(got, null)
  } finally {
    realFs.rmSync(dir, { recursive: true, force: true })
  }
})

test('walk-up candidate: portable origin dir wins before exe dir', () => {
  // The marker sits above BOTH candidates' ancestor chains; the portable
  // root must win, proving the exe dir is only consulted second.
  const portableRoot = path.resolve('/repo-portable')
  const exeRoot = path.resolve('/repo-exe')
  const fs = mockFsWith([MARKER_AT(portableRoot), MARKER_AT(exeRoot)])
  const got = resolvePackagedDevRoot(baseDeps(fs, {
    portableDir: path.join(portableRoot, 'tools', 'dsh-portable'),
    exeDir: path.join(exeRoot, 'app'),
  }))
  assert.deepEqual(got, { source: 'walkup', root: portableRoot })
})

test('walk-up candidate: exe dir is used when no portable dir is set', () => {
  const exeRoot = path.resolve('/app-repo')
  const fs = mockFsWith([MARKER_AT(exeRoot)])
  const got = resolvePackagedDevRoot(baseDeps(fs, { exeDir: path.join(exeRoot, 'DSH Desktop') }))
  assert.deepEqual(got, { source: 'walkup', root: exeRoot })
})

test('walk-up candidate: caps at 6 levels like the dev resolver', () => {
  // Marker at /a is 7 walk levels above the install dir — beyond the cap.
  const fs = mockFsWith([MARKER_AT('/a')])
  const got = resolvePackagedDevRoot(baseDeps(fs, { exeDir: path.resolve('/a/b/c/d/e/f/g/install') }))
  assert.equal(got, null, 'walk-up must not reach past the cap')
})

test('walk-up candidate: a directory without the marker is never accepted', () => {
  const fs = mockFsWith([])
  const got = resolvePackagedDevRoot(baseDeps(fs))
  assert.equal(got, null)
})

test('home candidate: deepseek-harness wins over deepseek-harness-dev', () => {
  const home = path.resolve('/home/user')
  const fs = mockFsWith([MARKER_AT(path.join(home, 'deepseek-harness')), MARKER_AT(path.join(home, 'deepseek-harness-dev'))])
  const got = resolvePackagedDevRoot(baseDeps(fs))
  assert.deepEqual(got, { source: 'home', root: path.join(home, 'deepseek-harness') })
})

test('home candidate: deepseek-harness-dev is the last resort', () => {
  const home = path.resolve('/home/user')
  const fs = mockFsWith([MARKER_AT(path.join(home, 'deepseek-harness-dev'))])
  const got = resolvePackagedDevRoot(baseDeps(fs))
  assert.deepEqual(got, { source: 'home', root: path.join(home, 'deepseek-harness-dev') })
})

test('no candidates: returns null so profiles.js preflight owns the failure', () => {
  const fs = mockFsWith([])
  const got = resolvePackagedDevRoot(baseDeps(fs))
  assert.equal(got, null)
})

test('walkUpToMarker: walks up from nested dirs and stops at the filesystem root', () => {
  const root = path.resolve('/repo')
  const fs = mockFsWith([MARKER_AT(root)])
  assert.equal(walkUpToMarker(path.join(root, 'packages', 'desktop', 'src', 'main'), fs), root)
  const none = mockFsWith([])
  assert.equal(walkUpToMarker(root, none), null, 'root hit must not loop forever')
})
