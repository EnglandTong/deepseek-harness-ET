/**
 * Profile bundle installation and reconciliation shared by the CLI
 * (`dsh plugin`) and the web plugin-import surface. The CLI keeps its own
 * terminal-streaming `spawnSync` invocation; the web surface calls
 * {@link installProfileBundle}, which captures output for a browser result.
 * Both reconcile through {@link reconcileProfileBundles}, so a bundle that
 * declares `dsh.bundle` joins the profile layer stack exactly once.
 * @module @deepseek-ai/dsh-app-boot/profile-install
 */

import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import {
  readProfileManifest,
  resolveBundleDir,
  writeProfileManifest,
  type ProfileManifest,
} from './profile.ts'

/**
 * Rewrite relative filesystem specs against a caller-chosen directory.
 * pnpm runs with cwd = the profile directory, so a bare `.` or `../plugin`
 * (or their `file:`/`link:` forms) would silently resolve inside the profile
 * — `add .` from a plugin checkout would self-link the profile. Absolute
 * specs, registry names, and every other pnpm argument pass through
 * untouched.
 * @param argument - one pnpm argument, verbatim from the caller.
 * @param cwd - the directory the spec is relative to.
 * @returns the argument with a relative path spec anchored to `cwd`.
 */
export function anchorPathSpec(argument: string, cwd: string): string {
  const match = /^(?<prefix>(?:file|link):)?(?<path>\.{1,2}(?:[/\\].*)?)$/.exec(argument)
  if (match?.groups?.path === undefined) return argument
  // A bare path stays bare and a prefixed spec keeps its prefix: pnpm's
  // link-vs-copy semantics differ between `file:` and a plain directory
  // path, and the anchor must not change which one the caller asked for.
  const prefix = match.groups.prefix ?? ''
  return `${prefix}${resolve(cwd, match.groups.path)}`
}

/**
 * Whether a resolved dependency exports a profile patch, i.e. is a bundle.
 * @param binName - the diagnostic prefix.
 * @param packageName - the dependency's package name.
 * @param installAnchor - absolute path of the dsh app's package.json.
 * @param profileDir - the profile directory (resolution anchor).
 * @returns true when the package manifest declares `dsh.bundle`.
 */
function exportsPatch(binName: string, packageName: string, installAnchor: string, profileDir: string): boolean {
  let dir: string
  try {
    dir = resolveBundleDir(binName, packageName, installAnchor, profileDir)
  } catch {
    return false // pnpm reported success yet the package is unresolvable — treat as plain
  }
  const manifest = readProfileManifest(binName, dir)
  return manifest.dsh?.bundle?.patch !== undefined
}

/**
 * Reconcile `dsh.profile.bundles` against the installed state: pnpm has
 * already written the real installed names (so a git/path/tarball/alias spec
 * reconciles by its true package name) and materialized the packages. A
 * dependency that resolves to a `dsh.bundle`-declaring package joins the
 * layer stack (appended in dependency order); a dependency-listed name that
 * no longer does — removed, or the installed version dropped the declaration
 * — leaves it. In-box bundles from the profile template are not dependencies
 * and are never touched.
 * @param binName - the diagnostic prefix.
 * @param installAnchor - absolute path of the dsh app's package.json.
 * @param profileDir - the profile directory.
 * @param before - the manifest snapshot taken before pnpm ran.
 * @param warn - receives the plain-dependency orientation warning.
 * @returns the bundle names newly joined to the layer stack, in order.
 */
export function reconcileProfileBundles(
  binName: string,
  installAnchor: string,
  profileDir: string,
  before: ProfileManifest,
  warn: (message: string) => void,
): string[] {
  const after = readProfileManifest(binName, profileDir)
  const beforeDeps = new Set(Object.keys(before.dependencies ?? {}))
  const dependencies = Object.keys(after.dependencies ?? {})
  const plugins = after.dsh?.profile?.bundles ?? []
  const added: string[] = []
  let changed = false
  for (const packageName of dependencies) {
    const isBundle = exportsPatch(binName, packageName, installAnchor, profileDir)
    if (isBundle && !plugins.includes(packageName)) {
      plugins.push(packageName)
      added.push(packageName)
      changed = true
    } else if (!isBundle && !beforeDeps.has(packageName)) {
      warn(
        `${binName}: warning: ${packageName} declares no dsh.bundle — installed as a plain dependency, not a profile layer `
        + '(a later update that gains one activates it automatically)',
      )
    }
  }
  const dependencySet = new Set(dependencies)
  for (const packageName of [...plugins]) {
    // Only dependency-managed entries are subject to removal; template
    // bundles (dsh-base and friends) are not dependencies.
    const wasDependency = beforeDeps.has(packageName) || dependencySet.has(packageName)
    const stillBundle = dependencySet.has(packageName) && exportsPatch(binName, packageName, installAnchor, profileDir)
    if (wasDependency && !stillBundle) {
      plugins.splice(plugins.indexOf(packageName), 1)
      changed = true
    }
  }
  if (!changed) return added
  after.dsh = { ...after.dsh, profile: { ...after.dsh?.profile, bundles: plugins } }
  writeProfileManifest(profileDir, after)
  return added
}

/** Inputs for {@link installProfileBundle}. */
export interface InstallProfileBundleOptions {
  /** Diagnostic prefix on warnings. */
  binName: string
  /** The profile directory (pnpm cwd). */
  profileDir: string
  /** Absolute path of the dsh app's package.json (first bundle-resolution anchor). */
  installAnchor: string
  /** The pnpm add spec: a registry name, or a `file:`/`link:`/bare path. */
  spec: string
  /** Directory a relative path spec anchors to; omitted leaves the spec verbatim. */
  anchorCwd?: string
}

/** The outcome of one {@link installProfileBundle} call. */
export interface InstallProfileBundleResult {
  /** Whether pnpm exited 0 and reconciliation completed. */
  ok: boolean
  /** The pnpm exit code (127 when pnpm itself is missing). */
  exitCode: number
  /** Combined captured stdout/stderr plus reconciliation warnings. */
  output: string
  /** Bundle names newly joined to `dsh.profile.bundles` by reconciliation. */
  addedBundles: string[]
}

/**
 * Install one package into a profile through pnpm and reconcile its bundle
 * layer list. Mirrors `dsh plugin --profile <name> add <spec>` but runs
 * asynchronously and captures output instead of inheriting the terminal, so
 * a browser request can report the full install transcript.
 * @param options - inputs; see {@link InstallProfileBundleOptions}.
 * @returns the captured install result.
 */
export async function installProfileBundle(options: InstallProfileBundleOptions): Promise<InstallProfileBundleResult> {
  const { binName, profileDir, installAnchor, spec } = options
  const before = readProfileManifest(binName, profileDir)
  const anchored = options.anchorCwd === undefined ? spec : anchorPathSpec(spec, options.anchorCwd)
  const chunks: string[] = []
  const exitCode = await new Promise<number | null>((resolveExit, reject) => {
    // Windows resolves pnpm through its .cmd shim, which spawn() refuses
    // without a shell since the CVE-2024-27980 hardening.
    const child = spawn('pnpm', ['add', anchored], {
      cwd: profileDir,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout?.on('data', (chunk: Buffer | string) => { chunks.push(String(chunk)) })
    child.stderr?.on('data', (chunk: Buffer | string) => { chunks.push(String(chunk)) })
    child.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        resolveExit(null)
      } else {
        reject(error)
      }
    })
    child.on('close', (code) => { resolveExit(code) })
  })
  const transcript = chunks.join('')
  if (exitCode === null) {
    return {
      ok: false,
      exitCode: 127,
      output: `${binName}: pnpm not found on PATH — install pnpm to manage profile plugins`,
      addedBundles: [],
    }
  }
  if (exitCode !== 0) {
    return {
      ok: false,
      exitCode,
      output: `${binName}: pnpm failed in profile directory ${profileDir}\n${transcript}`,
      addedBundles: [],
    }
  }
  const warnings: string[] = []
  const addedBundles = reconcileProfileBundles(binName, installAnchor, profileDir, before, (message) => {
    warnings.push(message)
  })
  return {
    ok: true,
    exitCode: 0,
    output: [...warnings, transcript].join(''),
    addedBundles,
  }
}
