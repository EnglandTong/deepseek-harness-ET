// Unit tests for src/main/profiles.js — targeted at leafPathFor, the seam
// the Plugins tab reads to answer "which yaml is this profile actually
// booting from?". The previous behavior hardcoded daemon-echo.yml under
// activeBasePath() in main.js, so the Plugins tab under stdio-deepseek
// showed the wrong leaf and the runtime fold reconciled against noise.
// QA round-3 shot 07 (2026-07-16) caught the regression; team-lead
// asked for a pin here so switching the leaf mapping later can't drift
// silently.

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const { profile, listProfiles, leafPathFor, PROFILE_LEAF, configDir } = require('../src/main/profiles.js')

test('leafPathFor returns the profile-specific yaml leaf', () => {
  assert.strictEqual(path.basename(leafPathFor('daemon-echo')), 'daemon-echo.yml')
  assert.strictEqual(path.basename(leafPathFor('stdio-echo')), 'echo-jsonrpc.yml')
  assert.strictEqual(path.basename(leafPathFor('stdio-deepseek')), 'deepseek-jsonrpc.yml')
  assert.strictEqual(path.basename(leafPathFor('daemon-vibe-echo')), 'daemon-vibe.yml')
  assert.strictEqual(path.basename(leafPathFor('stdio-vibe-deepseek')), 'deepseek-vibe.yml')
})

test('leafPathFor throws for an unknown profile (fail-loud rather than default)', () => {
  // Silent-default to daemon-echo.yml was the shape that caused the shot-07
  // bug. Locking the error path here so a typo in a future call site never
  // slips back into that behavior.
  assert.throws(() => leafPathFor('nope'), /unknown profile/)
  assert.throws(() => leafPathFor(''), /unknown profile/)
  assert.throws(() => leafPathFor(undefined), /unknown profile/)
})

test('leafPathFor covers every id in listProfiles()', () => {
  // If listProfiles adds a new entry (a future desktop-web profile, say),
  // the map must gain the corresponding leaf too. This test fails until
  // that happens.
  for (const name of listProfiles()) {
    assert.doesNotThrow(() => leafPathFor(name), `missing leaf for profile ${name}`)
  }
})

test('every mapped leaf exists on disk under config/', () => {
  for (const [name, leaf] of Object.entries(PROFILE_LEAF)) {
    const full = path.join(configDir, leaf)
    assert.ok(
      fs.existsSync(full),
      `config leaf missing for profile "${name}": ${full}. Either add the leaf, ` +
        `rename it in profiles.js, or drop the profile from listProfiles.`,
    )
  }
})

test('profile() surfaces leafName matching leafPathFor', () => {
  // The leafName field on the profile object is what other main-side
  // callers can inspect without dipping into PROFILE_LEAF (e.g. a probe
  // handler that wants "the leaf this profile boots from" without
  // reparsing spawn argv).
  for (const name of listProfiles()) {
    const p = profile(name)
    assert.strictEqual(
      p.leafName,
      PROFILE_LEAF[name],
      `profile(${name}).leafName should be "${PROFILE_LEAF[name]}"`,
    )
    assert.strictEqual(
      path.join(configDir, p.leafName),
      leafPathFor(name),
      'leafName + configDir should equal leafPathFor()',
    )
  }
})

test('stdio deepseek profiles launch the dsh CLI with the sdk profile', () => {
  // The alpha.4 runtime is the dsh CLI serving `--profile sdk` over stdio
  // JSON-RPC (packages/examples/jsonrpc-demo is gone), so the spawn argv
  // ends with the profile pair instead of a yml leaf. Regression pin: if
  // someone reverts to leaf argv or retargets the profile, this catches it.
  const stdioDeepseek = profile('stdio-deepseek')
  assert.strictEqual(stdioDeepseek.mode, 'stdio')
  assert.deepStrictEqual(stdioDeepseek.args.slice(-2), ['--profile', 'sdk'])
  assert.match(stdioDeepseek.args[stdioDeepseek.args.length - 3], /bin\.ts$/)

  const stdioVibe = profile('stdio-vibe-deepseek')
  assert.deepStrictEqual(stdioVibe.args.slice(-2), ['--profile', 'sdk'])
  assert.doesNotMatch(stdioVibe.args.join(' '), /daemon-echo\.yml/)
})

test('bundled deepseek profiles pass --profile sdk to the standalone exe', () => {
  // When a bundled runtime exe is materialized (packaged builds, or a dev
  // checkout with DSH_BUNDLED_RUNTIME_DIR staged), the deepseek profiles
  // spawn it with the same --profile sdk argv. BUNDLED_RUNTIME is captured
  // at module load, so point the env at a stub and re-require fresh.
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-desktop-bundled-'))
  fs.writeFileSync(path.join(stubDir, 'deepseek-harness-sdk-runtime-win-x64.exe'), '')
  process.env.DSH_BUNDLED_RUNTIME_DIR = stubDir
  try {
    delete require.cache[require.resolve('../src/main/profiles.js')]
    const fresh = require('../src/main/profiles.js')
    for (const name of ['stdio-deepseek', 'stdio-vibe-deepseek']) {
      const p = fresh.profile(name)
      assert.strictEqual(p.runtime, 'bundled')
      assert.deepStrictEqual(p.args, ['--profile', 'sdk'])
      assert.strictEqual(p.cmd, path.join(stubDir, 'deepseek-harness-sdk-runtime-win-x64.exe'))
    }
  } finally {
    delete process.env.DSH_BUNDLED_RUNTIME_DIR
    delete require.cache[require.resolve('../src/main/profiles.js')]
    fs.rmSync(stubDir, { recursive: true, force: true })
  }
})

test('retired daemon/echo profiles report disabled instead of spawning', () => {
  // The alpha.4 runtime serves stdio only: daemon/socket mode and the
  // shell-owned mock-echo adapter have no route. The entries stay (persisted
  // configs reference them) but must never yield a spawnable command.
  for (const name of ['daemon-echo', 'stdio-echo', 'daemon-vibe-echo']) {
    const p = profile(name)
    assert.strictEqual(p.disabled, true, `${name} should be disabled`)
    assert.ok(p.disabledReason.length > 0, `${name} should carry a reason`)
  }
})
