// Packaged-mode DSH checkout resolution.
//
// The dev shell finds the runtime SDK by walking up from `src/main/`
// (profiles.js `resolveHarnessDev` candidate 2) — a layout that exists only
// inside a repo clone. A packaged app keeps its code inside `app.asar`, so
// that walk-up lands on the install directory and preflight refuses to boot.
// This module runs once at main-process startup, before profiles.js is
// required, and materializes the checkout as `DSH_DEV_ROOT` when unset:
//
//   1. env `DSH_DEV_ROOT` — explicit override, left untouched.
//   2. config.json field `harnessDevRoot` — a persisted user choice,
//      validated against the runtime-bin marker.
//   3. walk-up from the portable origin dir (`PORTABLE_EXECUTABLE_DIR`,
//      set by electron-builder portable targets) and the executable
//      directory — covers a packaged exe dropped inside or below a
//      deepseek-harness checkout.
//   4. well-known checkouts under the home directory: `deepseek-harness`,
//      then `deepseek-harness-dev`.
//
// Every candidate is validated against the same runtime-bin marker
// profiles.js walks up for, so a stale config value or unrelated directory
// is skipped instead of producing phantom spawn paths. When nothing matches
// the env stays unset and profiles.js preflight throws its self-describing
// error naming the paths it tried.

'use strict'

const path = require('node:path')

/** Marker that identifies a deepseek-harness checkout (same probe profiles.js uses). */
const DEV_ROOT_MARKER = path.join('apps', 'cli', 'src', 'bin.ts')

/** Walk-up cap, mirroring profiles.js so a deep install dir can't scan the filesystem root. */
const WALK_UP_LIMIT = 6

/** Well-known checkout directory names under the home directory, in preference order. */
const HOME_CHECKOUTS = ['deepseek-harness', 'deepseek-harness-dev']

function hasRuntimeMarker(exists, root) {
  return exists(path.join(root, DEV_ROOT_MARKER))
}

/**
 * Walk up from `start` looking for the runtime-bin marker, capped so an
 * install dir at the filesystem root cannot scan unbounded.
 * @param {string} start - directory to walk up from.
 * @param {(p: string) => boolean} exists - filesystem probe.
 * @returns {string | null} first ancestor holding the marker, else null.
 */
function walkUpToMarker(start, exists) {
  let dir = start
  for (let i = 0; i < WALK_UP_LIMIT; i += 1) {
    if (hasRuntimeMarker(exists, dir)) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

function readConfiguredDevRoot(configPath, exists) {
  let raw
  try {
    raw = require('node:fs').readFileSync(configPath, 'utf8')
  } catch (_) {
    // No config.json (first run) — there is no persisted choice to read.
    return null
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (_) {
    // A hand-edited config.json must not break checkout discovery; the
    // shell rewrites valid JSON on every persisted setting change.
    return null
  }
  const configured = parsed && typeof parsed.harnessDevRoot === 'string' ? parsed.harnessDevRoot : null
  if (!configured) return null
  const root = path.resolve(configured)
  return hasRuntimeMarker(exists, root) ? root : null
}

/**
 * Resolve the deepseek-harness checkout for a packaged shell. Pure so tests
 * can drive it against a mock filesystem and fake environment.
 *
 * @param {object} deps - injected inputs.
 * @param {Record<string, string | undefined>} deps.env - process environment.
 * @param {string} deps.homedir - user home directory.
 * @param {(p: string) => boolean} deps.exists - filesystem probe.
 * @param {string} deps.exeDir - directory of the running executable.
 * @param {string | undefined} deps.portableDir - portable origin directory.
 * @param {string | undefined} [deps.configHome] - overrides `~/.dsh-desktop`.
 * @returns {{ source: 'env' | 'config' | 'walkup' | 'home', root: string } | null}
 */
function resolvePackagedDevRoot({ env, homedir, exists, exeDir, portableDir, configHome }) {
  if (env.DSH_DEV_ROOT) {
    return { source: 'env', root: path.resolve(env.DSH_DEV_ROOT) }
  }
  const shellHome = configHome || path.join(homedir, '.dsh-desktop')
  const fromConfig = readConfiguredDevRoot(path.join(shellHome, 'config.json'), exists)
  if (fromConfig) return { source: 'config', root: fromConfig }
  for (const start of [portableDir, exeDir]) {
    if (!start) continue
    const found = walkUpToMarker(start, exists)
    if (found) return { source: 'walkup', root: found }
  }
  for (const name of HOME_CHECKOUTS) {
    const candidate = path.join(homedir, name)
    if (hasRuntimeMarker(exists, candidate)) return { source: 'home', root: candidate }
  }
  return null
}

/**
 * Apply {@link resolvePackagedDevRoot} to the live environment: sets
 * `env.DSH_DEV_ROOT` when a checkout is found and the env override is
 * unset. Called once at packaged startup, before profiles.js is required.
 *
 * @param {Record<string, string | undefined>} env - the environment to write.
 * @param {object} [deps] - overrides for tests; defaults probe the real filesystem.
 * @returns {{ source: string, root?: string }} what was applied, or `{ source: 'none' }`.
 */
function applyPackagedDevRoot(env, deps = {}) {
  const exists = deps.exists || ((p) => { try { require('node:fs').accessSync(p); return true } catch (_) { return false } })
  const homedir = deps.homedir || require('node:os').homedir()
  const resolved = resolvePackagedDevRoot({
    env,
    homedir,
    exists,
    exeDir: deps.exeDir || process.execPath && path.dirname(process.execPath),
    portableDir: deps.portableDir !== undefined ? deps.portableDir : process.env.PORTABLE_EXECUTABLE_DIR,
    configHome: deps.configHome,
  })
  if (!resolved) return { source: 'none' }
  if (!env.DSH_DEV_ROOT) env.DSH_DEV_ROOT = resolved.root
  return resolved
}

module.exports = { applyPackagedDevRoot, resolvePackagedDevRoot, walkUpToMarker, DEV_ROOT_MARKER }
