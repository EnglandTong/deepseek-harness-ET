// HARNESS_DEV candidate-ordering lock (2026-07-18, P0-1 in-repo detection).
//
// Fresh clones of the official repo don't have a sibling
// `deepseek-harness-dev/`, so the previous sibling-only resolver handed
// the runtime spawner a phantom path and preflight refused to boot.
// `resolveHarnessDev` now tries three candidates in order:
//
//   1. env `DSH_DEV_ROOT` — explicit override.
//   2. walk-up in-repo — first ancestor of the startDir that contains
//      `apps/cli/src/bin.ts` (the dsh CLI entry the alpha.4 source launch
//      spawns). This is the shape a user hits when this shell ships
//      inside deepseek-harness at `packages/desktop/`.
//   3. sibling `deepseek-harness-dev/` (with `.worktrees/integration`
//      preference) — the original dev-workflow layout.
//
// These tests drive the resolver against a mock filesystem so the
// ordering is locked without needing either real layout on disk. Fixtures
// resolve every root through `path.resolve` before joining the marker so
// the ordering is locked identically on Windows and POSIX separators.

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { resolveHarnessDev } = require('../src/main/profiles.js')

const CLI_MARKER_AT = (root) => path.join(path.resolve(root), 'apps', 'cli', 'src', 'bin.ts')

function mockFsWith(existing) {
  // A minimal `accessSync` shim that throws unless the queried path
  // matches one of the entries in `existing` (a Set of absolute paths).
  const set = existing instanceof Set ? existing : new Set(existing)
  return {
    accessSync(p) {
      if (!set.has(p)) {
        const err = new Error(`ENOENT: no such file or directory, access '${p}'`)
        err.code = 'ENOENT'
        throw err
      }
    },
  }
}

test('candidate 1 wins: DSH_DEV_ROOT env overrides everything else', () => {
  // Even if the in-repo marker exists AND a sibling clone exists, the
  // env override takes precedence and gets resolved to an absolute path.
  const start = path.resolve('/repo/packages/desktop/src/main')
  const fs = mockFsWith([
    // in-repo marker (would win candidate 2 otherwise)
    CLI_MARKER_AT('/repo'),
    // integration cli entry (would win candidate 3 otherwise)
    CLI_MARKER_AT(path.resolve('/other/deepseek-harness-dev/.worktrees/integration')),
  ])
  const got = resolveHarnessDev(start, { DSH_DEV_ROOT: '/custom/checkout' }, fs)
  assert.equal(got, path.resolve('/custom/checkout'))
})

test('candidate 2 wins: in-repo marker on the ancestor chain when no env', () => {
  // Startdir is packages/desktop/src/main; repo root three levels up
  // holds the dsh CLI marker. The walk-up should return that root
  // before falling through to the sibling candidate.
  const start = path.resolve('/repo/packages/desktop/src/main')
  const fs = mockFsWith([CLI_MARKER_AT('/repo')])
  const got = resolveHarnessDev(start, {}, fs)
  assert.equal(got, path.resolve('/repo'))
})

test('candidate 2 walks up at most 6 levels, then gives up', () => {
  // Bury the marker 7+ levels up — beyond the cap. Resolver must NOT
  // find it; it should fall through to candidate 3 (sibling) which
  // itself doesn't exist here, so the resolver returns the base sibling
  // path unchanged (no exception).
  const start = path.resolve('/a/b/c/d/e/f/g/src/main')
  const fs = mockFsWith([CLI_MARKER_AT('/a')]) // 8 walk levels up from start
  const got = resolveHarnessDev(start, {}, fs)
  // Sibling fallback: startDir's ../../../deepseek-harness-dev
  const expectedBase = path.resolve(start, '..', '..', '..', 'deepseek-harness-dev')
  assert.equal(got, expectedBase, 'walk-up must not reach past the 6-level cap; falls through to sibling')
})

test('candidate 3 wins: sibling deepseek-harness-dev is the fallback when no marker on chain', () => {
  // No in-repo marker anywhere, and no integration cli entry either
  // — the resolver returns the base sibling path.
  const start = path.resolve('/ws/dsh-desktop-demo/src/main')
  const fs = mockFsWith([]) // nothing exists
  const got = resolveHarnessDev(start, {}, fs)
  assert.equal(got, path.resolve(start, '..', '..', '..', 'deepseek-harness-dev'), 'sibling one directory up from the demo root')
})

test('candidate 3 prefers .worktrees/integration when its cli entry is materialized there', () => {
  // Sibling `deepseek-harness-dev` exists with the integration worktree
  // materialized (its dsh CLI entry is the shape the source launch
  // loads), so the resolver returns the integration path over the base clone.
  const start = path.resolve('/ws/dsh-desktop-demo/src/main')
  const base = path.resolve(start, '..', '..', '..', 'deepseek-harness-dev')
  const integration = path.join(base, '.worktrees', 'integration')
  const fs = mockFsWith([CLI_MARKER_AT(integration)])
  const got = resolveHarnessDev(start, {}, fs)
  assert.equal(got, integration, 'integration worktree preferred over base clone when its cli entry is there')
})

test('official-repo shape end-to-end: startDir inside packages/desktop resolves to repo root', () => {
  // The failure the P0-1 fix was written for: user clones
  // deepseek-harness fresh, launches the shell from packages/desktop.
  // Resolver must NOT hand back
  // `deepseek-harness/packages/deepseek-harness-dev` (which doesn't
  // exist). It must return the repo root itself.
  const start = path.resolve('/Users/downloader/deepseek-harness/packages/desktop/src/main')
  const fs = mockFsWith([CLI_MARKER_AT('/Users/downloader/deepseek-harness')])
  const got = resolveHarnessDev(start, {}, fs)
  assert.equal(got, path.resolve('/Users/downloader/deepseek-harness'))
})
