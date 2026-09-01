/**
 * Build the SDK runtime executables and Python node carrier. The fixed
 * `@yao-pkg/pkg --sea` route, deploy flags, and artifact layout are owned by
 * .agents/notes/implemented/architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md.
 * The staged closure is symlink-free, and whole-tree assets cover Cordis's
 * runtime imports that pkg cannot discover statically.
 */

import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { chmod, copyFile, cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { parseArgs } from 'node:util'
import { resolveLinuxNodePtyAddon } from './build-exe-for-python-sdk-native-pty.ts'

const root = resolve(import.meta.dirname, '..')

/** The closure manifest whose dependencies define the executable. */
const DEPLOY_ROOT_PACKAGE = 'dsh-jsonrpc-agent-pkg'
/** The closed-runtime app entry inside the deployed closure. */
const ENTRY_BIN = 'node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/packaged-bin.js'
const OUTPUT_BASENAME = 'dsh-jsonrpc-agent-pkg'
/** Default Node major; SEA mode requires at least Node 22. */
const DEFAULT_NODE_RANGE = 'node24'
/** Pinned for reproducible builds. */
const PKG_SPEC = '@yao-pkg/pkg@6.21.0'
const OUT_DIR = 'dist-exe'
/** Python package destination; created when absent. */
const PYTHON_RUNTIME_DIR = 'python/sdk-runtime/src/deepseek_harness_runtime/runtime'
/** The deployed closure doubles as the node-mode carrier. */
const PYTHON_NODE_SUBDIR = 'node'
/** Legacy deploy may hoist peer-specialized workspace packages back here. */
const DEPLOY_SOURCE_NODE_MODULES = 'python/sdk-runtime/node_modules'
/** Documentation excluded from the generated runtime directory. */
const DEPLOY_ONLY_DOCS = ['README.md', 'README.zh.md', 'README.i18n.yaml']

/**
 * Whole-tree assets cover Cordis's runtime bare-package imports, which pkg's
 * static analysis cannot see. Package manifests are explicit because bare-name
 * resolution depends on them.
 */
const ASSET_GLOBS = [
  'package.json',
  'node_modules/**/*.js',
  'node_modules/**/*.cjs',
  'node_modules/**/*.mjs',
  'node_modules/**/package.json',
  'node_modules/**/*.json',
  'node_modules/**/*.node',
  'node_modules/**/*.wasm',
]

const PLATFORMS = ['linux', 'macos', 'win32'] as const
const ARCHES = ['x64', 'arm64'] as const
type Platform = (typeof PLATFORMS)[number]
type Arch = (typeof ARCHES)[number]

function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value)
}

function isArch(value: string): value is Arch {
  return (ARCHES as readonly string[]).includes(value)
}

/**
 * A parsed pkg target triple, constructed from `--targets` or the host.
 */
class Target {
  private constructor(
    /** pkg Node range (`node<major>`). */
    readonly nodeRange: string,
    /**
     * pkg platform tag. Windows was a documented non-goal of the single-exe
     * pipeline; the desktop standalone packaging added it with real-machine
     * validation (see the 2026-09-01 desktop packaging Agent Note).
     */
    readonly platform: Platform,
    /** pkg CPU tag. */
    readonly arch: Arch,
  ) {}

  /** The pkg `--targets` spec string `<nodeRange>-<platform>-<arch>`. */
  get spec(): string {
    return `${this.nodeRange}-${this.platform}-${this.arch}`
  }

  /**
   * Parse one target spec, rejecting malformed triples and unsupported platform or architecture.
   * @param spec - the raw triple, e.g. `node24-linux-x64`.
   * @returns the parsed target.
   */
  static parse(spec: string): Target {
    const parts = spec.split('-')
    const [nodeRange, platform, arch] = parts
    if (parts.length !== 3 || nodeRange === undefined || platform === undefined || arch === undefined) {
      throw new Error(`build-exe-for-python-sdk: target ${JSON.stringify(spec)} must be <nodeRange>-<platform>-<arch>, e.g. node24-linux-x64.`)
    }
    if (!/^node\d+$/.test(nodeRange)) {
      throw new Error(`build-exe-for-python-sdk: target ${JSON.stringify(spec)}: node range must look like node24, got ${JSON.stringify(nodeRange)}.`)
    }
    if (!isPlatform(platform)) {
      throw new Error(`build-exe-for-python-sdk: target ${JSON.stringify(spec)}: platform must be one of ${PLATFORMS.join(', ')}, got ${JSON.stringify(platform)}.`)
    }
    if (!isArch(arch)) {
      throw new Error(`build-exe-for-python-sdk: target ${JSON.stringify(spec)}: arch must be one of ${ARCHES.join(', ')}, got ${JSON.stringify(arch)}.`)
    }
    return new Target(nodeRange, platform, arch)
  }

  /**
   * Resolve the host-platform default on Node 24.
   * @returns the host target; throws on an unsupported host platform or arch.
   */
  static host(): Target {
    const platform = process.platform === 'darwin' ? 'macos' : process.platform === 'linux' ? 'linux' : process.platform === 'win32' ? 'win32' : undefined
    if (platform === undefined) {
      throw new Error(`build-exe-for-python-sdk: unsupported host platform ${process.platform}; pass --targets explicitly.`)
    }
    const arch = process.arch === 'x64' || process.arch === 'arm64' ? process.arch : undefined
    if (arch === undefined) {
      throw new Error(`build-exe-for-python-sdk: unsupported host arch ${process.arch}; pass --targets explicitly.`)
    }
    return new Target(DEFAULT_NODE_RANGE, platform, arch)
  }
}

/**
 * Validated CLI configuration; construction owns help and parse-error exits.
 */
class BuildCli {
  private constructor(
    /** Build targets; defaults to the host platform only. */
    readonly targets: readonly Target[],
    /** Skip step 1 entirely; lib/ artifacts must already exist. */
    readonly skipBuild: boolean,
    /** Build only the deploy closure (tsc -b projects + tsdown dirs) instead of the full workspace. */
    readonly buildClosure: boolean,
    /** Print every command and config patch instead of executing. */
    readonly dryRun: boolean,
  ) {}

  /**
   * Parse argv. Help exits 0; malformed flags exit 1; invalid or colliding
   * targets throw.
   * @param argv - the raw arguments (`process.argv.slice(2)`).
   * @returns the parsed, validated configuration.
   */
  static parse(argv: string[]): BuildCli {
    let values: ReturnType<typeof BuildCli.parseRaw>
    try {
      values = BuildCli.parseRaw(argv)
    } catch (error) {
      console.error(`build-exe-for-python-sdk: ${error instanceof Error ? error.message : String(error)}\n`)
      console.error(BuildCli.usage())
      process.exit(1)
    }
    if (values.help) {
      console.log(BuildCli.usage())
      process.exit(0)
    }
    if (values['skip-build'] && values['build-closure']) {
      throw new Error('build-exe-for-python-sdk: --skip-build and --build-closure are mutually exclusive.')
    }
    const targets = values.targets === undefined
      ? [Target.host()]
      : values.targets.split(',').map(part => part.trim()).filter(part => part !== '').map(spec => Target.parse(spec))
    if (targets.length === 0) throw new Error('build-exe-for-python-sdk: --targets is empty.')
    const seen = new Set<string>()
    for (const target of targets) {
      const key = `${target.platform}-${target.arch}`
      if (seen.has(key)) {
        throw new Error(`build-exe-for-python-sdk: duplicate platform-arch ${key} in --targets; canonical product names would collide.`)
      }
      seen.add(key)
    }
    return new BuildCli(targets, values['skip-build'], values['build-closure'], values['dry-run'])
  }

  private static parseRaw(argv: string[]) {
    return parseArgs({
      args: argv,
      options: {
        'targets': { type: 'string' },
        'skip-build': { type: 'boolean', default: false },
        'build-closure': { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        'help': { type: 'boolean', default: false },
      },
    }).values
  }

  private static usage(): string {
    return [
      'Usage: pnpm exec tsx scripts/build-exe-for-python-sdk.ts [flags]',
      '',
      '  --targets=<t1,t2,...>  pkg targets, e.g. node24-linux-x64,node24-linux-arm64,node24-macos-arm64.',
      '                         Default: the host platform only (on node24).',
      '  --skip-build           skip `pnpm run build` (lib/ artifacts must already exist).',
      '  --build-closure        build only the deploy closure (tsc -b projects + tsdown dirs) instead',
      '                         of the full workspace; used on Windows where excluded workspace-',
      '                         junction packages can fail the full build.',
      '  --dry-run              print every command and config patch without executing.',
      '  --help                 print this help.',
      '',
      `Build route: ${PKG_SPEC} --sea; see .agents/notes/implemented/architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md.`,
      `Stages the node carrier in ${PYTHON_RUNTIME_DIR}/${PYTHON_NODE_SUBDIR} and writes executables to ${OUT_DIR}/.`,
    ].join('\n')
  }
}

function pnpmBin(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

function npxBin(): string {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx'
}

/**
 * Render a command for logs and errors, quoting arguments with spaces.
 * @param command - the executable.
 * @param args - its arguments.
 * @returns the printable command line.
 */
function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(part => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ')
}

/**
 * Sequential build pipeline. Subprocesses inherit stdio and errors include
 * the command; dry runs print commands and filesystem changes.
 */
class SingleExeBuild {
  /**
   * The cleared deploy target, pkg input, and Python node-mode carrier. The
   * checked-in default `cordis.yml` remains in its parent directory.
   */
  readonly staging = resolve(root, PYTHON_RUNTIME_DIR, PYTHON_NODE_SUBDIR)
  private readonly outDir = resolve(root, OUT_DIR)

  constructor(private readonly cli: BuildCli) {}

  /** Verify the closure before compiling or packaging. */
  async verifyClosure(): Promise<void> {
    await this.run('runtime dependency closure', pnpmBin(), [
      ...this.pnpmStabilityFlags(),
      'run', 'verify-runtime-closure',
    ])
  }

  /**
   * pnpm config flags every pipeline invocation carries: the pre-run
   * dependencies check rewrites `.bin` shims (Windows EBUSY) and its
   * config-drift purge prompts for a TTY the pipeline does not have.
   */
  private pnpmStabilityFlags(): string[] {
    return ['--config.verify-deps-before-run=false', '--config.confirm-modules-purge=false']
  }

  /** Build all package artifacts unless `--skip-build` was passed. */
  async build(): Promise<void> {
    if (this.cli.skipBuild) {
      console.log('build-exe-for-python-sdk: skipping pnpm run build (--skip-build)')
      return
    }
    if (this.cli.buildClosure) {
      await this.buildClosureArtifacts()
      return
    }
    await this.run('build', pnpmBin(), ['run', 'build'])
  }

  /**
   * Build only the deploy closure: `tsc -b` over one generated solution
   * config referencing every closure package, then tsdown narrowed to the
   * same package directories via DSH_TSDOWN_WORKSPACE_DIRS. Windows uses
   * this because a checkout can hold workspace-junctioned packages (owned
   * by a separate repository) whose sources fail the full-workspace build.
   */
  private async buildClosureArtifacts(): Promise<void> {
    const { projects, dirs } = this.resolveClosureProjects()
    const solution = join(tmpdir(), `tsconfig.exe-closure-${process.pid}.json`)
    if (this.cli.dryRun) {
      console.log(`build-exe-for-python-sdk: [dry-run] write ${solution} with ${projects.length} references`)
    } else {
      await writeFile(solution, `${JSON.stringify({ files: [], references: projects.map(project => ({ path: project })) }, null, 2)}\n`)
    }
    await this.run('closure tsc -b', npxBin(), ['tsc', '-b', solution])
    const slashDirs = dirs.map(dir => dir.replaceAll(sep, '/'))
    await this.run('closure tsdown', pnpmBin(), [
      'exec', 'tsdown',
      '--env.DSH_BUILD_FACE=host',
      `--env.DSH_TSDOWN_WORKSPACE_DIRS=${slashDirs.join(',')}`,
    ])
  }

  /**
   * Traverse the deploy manifest's dependency + workspace-peer closure and
   * return each package's tsconfig path (for `tsc -b`) and directory (for
   * tsdown's workspace narrowing). Linux-only native platform packages are
   * skipped: they never build on a non-Linux host and pnpm deploy stages
   * only the matching-platform optionals.
   */
  private resolveClosureProjects(): { projects: string[]; dirs: string[] } {
    const deployManifest = JSON.parse(readFileSync(resolve(root, 'python/sdk-runtime/package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const index = new Map<string, string>()
    const scan = (base: string, depth: number): void => {
      for (const entry of existsSync(base) ? readdirSync(base, { withFileTypes: true }) : []) {
        if (!entry.isDirectory()) continue
        const dir = join(base, entry.name)
        const packageManifest = join(dir, 'package.json')
        if (existsSync(packageManifest)) {
          const name = (JSON.parse(readFileSync(packageManifest, 'utf8')) as { name?: string }).name
          if (name && !index.has(name)) index.set(name, dir)
        } else if (depth > 0) {
          scan(dir, depth - 1)
        }
      }
    }
    scan(join(root, 'packages'), 1)
    scan(join(root, 'vendor'), 0)
    scan(join(root, 'apps'), 0)
    scan(join(root, 'python'), 0)

    const skip = new Set([
      '@deepseek-ai/node-addon-landlock-run',
      '@deepseek-ai/node-addon-landlock-run-linux-arm64',
      '@deepseek-ai/node-addon-landlock-run-linux-x64',
    ])
    const closure = new Set<string>()
    const queue = Object.keys(deployManifest.dependencies ?? {})
    while (queue.length > 0) {
      const name = queue.pop() as string
      if (closure.has(name)) continue
      closure.add(name)
      const dir = index.get(name)
      if (dir === undefined) continue
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>
        peerDependencies?: Record<string, string>
      }
      const refs = Object.entries({ ...pkg.dependencies, ...pkg.peerDependencies })
        .filter(([, spec]) => typeof spec === 'string' && spec.startsWith('workspace:'))
        .map(([ref]) => ref)
      for (const ref of refs) if (!closure.has(ref)) queue.push(ref)
    }

    const projects: string[] = []
    const dirs: string[] = []
    for (const name of [...closure].sort()) {
      if (skip.has(name)) continue
      const dir = index.get(name)
      const tsconfig = dir === undefined ? undefined : join(dir, 'tsconfig.json')
      if (dir === undefined || !existsSync(tsconfig as string)) continue
      projects.push(tsconfig as string)
      dirs.push(dir)
    }
    // The tsdown config imports the Typert generator's built plugin, so the
    // generator must be built even though no runtime package depends on it.
    const typertGenerator = join(root, 'packages', 'typert', 'generator')
    if (existsSync(join(typertGenerator, 'tsconfig.json')) && !dirs.includes(typertGenerator)) {
      projects.push(join(typertGenerator, 'tsconfig.json'))
      dirs.push(typertGenerator)
    }
    return { projects, dirs }
  }

  /** Clear and deploy the runtime closure into the node carrier. */
  async deployStaging(): Promise<void> {
    if (this.staging === root || root.startsWith(this.staging + sep)) {
      throw new Error(`build-exe-for-python-sdk: refusing to clear staging dir ${this.staging}: it contains the repo root.`)
    }
    if (this.cli.dryRun) console.log(`build-exe-for-python-sdk: [dry-run] rm -rf ${this.staging}`)
    else await rm(this.staging, { recursive: true, force: true })
    await this.run('deploy', pnpmBin(), [
      ...this.pnpmStabilityFlags(),
      '--filter',
      DEPLOY_ROOT_PACKAGE,
      'deploy',
      '--legacy',
      '--prod',
      '--config.node-linker=hoisted',
      '--config.auto-install-peers=false',
      '--config.link-workspace-packages=true',
      this.staging,
    ])
    await this.restoreLegacyHoists()
    await this.materializeStagedLinks()
    if (this.cli.dryRun) {
      for (const name of DEPLOY_ONLY_DOCS) console.log(`build-exe-for-python-sdk: [dry-run] rm -f ${join(this.staging, name)}`)
    } else {
      await Promise.all(DEPLOY_ONLY_DOCS.map(name => rm(join(this.staging, name), { force: true })))
    }
  }

  /**
   * Restore direct packages that pnpm's legacy hoister places beside the deploy
   * source instead of in the target. The runtime manifest supplies every peer,
   * so package-local node_modules trees are omitted to preserve one flat Cordis
   * instance and a symlink-free packaged payload.
   */
  private async restoreLegacyHoists(): Promise<void> {
    if (this.cli.dryRun) {
      console.log('build-exe-for-python-sdk: [dry-run] restore direct dependencies omitted by legacy deploy')
      return
    }
    const manifestPath = join(this.staging, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const sourceNodeModules = resolve(root, DEPLOY_SOURCE_NODE_MODULES)
    const restored: string[] = []
    for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
      const destination = join(this.staging, 'node_modules', dependency)
      if (existsSync(destination)) continue
      const source = join(sourceNodeModules, dependency)
      if (!existsSync(source)) {
        throw new Error(
          `build-exe-for-python-sdk: deployed dependency ${dependency} is absent from both ${destination} and ${source}.`,
        )
      }
      await mkdir(dirname(destination), { recursive: true })
      const nestedNodeModules = join(source, 'node_modules')
      await cp(source, destination, {
        recursive: true,
        dereference: true,
        filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
      })
      restored.push(dependency)
    }
    const stillMissing = Object.keys(manifest.dependencies ?? {})
      .filter(dependency => !existsSync(join(this.staging, 'node_modules', dependency)))
    if (stillMissing.length > 0) {
      throw new Error(`build-exe-for-python-sdk: staged dependencies remain missing: ${stillMissing.join(', ')}.`)
    }
    if (restored.length > 0) {
      console.log(`build-exe-for-python-sdk: restored legacy deploy hoists: ${restored.join(', ')}`)
    }
  }

  /** Replace deploy-time package links with files and reject any remaining link. */
  private async materializeStagedLinks(): Promise<void> {
    if (this.cli.dryRun) {
      console.log('build-exe-for-python-sdk: [dry-run] materialize staged package links')
      return
    }
    const nodeModules = join(this.staging, 'node_modules')
    let remaining = await this.findSymlink(nodeModules)
    while (remaining !== undefined) {
      const segments = remaining.slice(nodeModules.length + 1).split(sep)
      const binIndex = segments.lastIndexOf('.bin')
      if (binIndex >= 0) {
        await rm(join(nodeModules, ...segments.slice(0, binIndex + 1)), { recursive: true, force: true })
        remaining = await this.findSymlink(nodeModules)
        continue
      }
      const destination = remaining
      const source = await realpath(destination)
      const nestedNodeModules = join(source, 'node_modules')
      await rm(destination, { recursive: true, force: true })
      await cp(source, destination, {
        recursive: true,
        dereference: true,
        filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
      })
      remaining = await this.findSymlink(nodeModules)
    }
  }

  /** Return the first symbolic link below a directory, if one exists. */
  private async findSymlink(directory: string): Promise<string | undefined> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink()) return path
      if (metadata.isDirectory()) {
        const nested = await this.findSymlink(path)
        if (nested !== undefined) return nested
      }
    }
    return undefined
  }

  /** Add the executable entry and pkg assets to the staged manifest. */
  async injectPkgConfig(): Promise<void> {
    const patch = { bin: ENTRY_BIN, pkg: { assets: ASSET_GLOBS } }
    const manifestPath = join(this.staging, 'package.json')
    if (this.cli.dryRun) {
      console.log(`build-exe-for-python-sdk: [dry-run] patch ${manifestPath} with ${JSON.stringify(patch)}`)
      return
    }
    if (!existsSync(manifestPath)) {
      throw new Error(`build-exe-for-python-sdk: ${manifestPath} missing — pnpm deploy did not produce a staged package.`)
    }
    if (!existsSync(join(this.staging, ENTRY_BIN))) {
      throw new Error(`build-exe-for-python-sdk: ${join(this.staging, ENTRY_BIN)} missing — run without --skip-build so lib/ artifacts exist.`)
    }
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    await writeFile(manifestPath, `${JSON.stringify({ ...manifest, ...patch }, null, 2)}\n`)
    console.log(`build-exe-for-python-sdk: injected pkg config into ${manifestPath}`)
  }

  /**
   * Package one target; SEA mode accepts one target per invocation.
   * @param target - the pkg target triple to build.
   * @returns the executable path and, on macOS, its helper path.
   */
  async pack(target: Target): Promise<string[]> {
    const extension = target.platform === 'win32' ? '.exe' : ''
    const product = join(this.outDir, `${OUTPUT_BASENAME}-${target.platform}-${target.arch}${extension}`)
    await this.prepareNativePty(target)
    if (!this.cli.dryRun) await mkdir(this.outDir, { recursive: true })
    await this.run(`pkg ${target.spec}`, pnpmBin(), [
      'dlx',
      PKG_SPEC,
      this.staging,
      '--sea',
      '--targets',
      target.spec,
      '--output',
      product,
    ])
    if (!this.cli.dryRun && !existsSync(product)) {
      throw new Error(`build-exe-for-python-sdk: product ${product} is missing after the pkg run; inspect ${this.outDir}.`)
    }
    if (target.platform !== 'macos') return [product]
    const spawnHelper = `${product}-spawn-helper`
    const source = join(this.staging, 'node_modules', 'node-pty', 'prebuilds', `darwin-${target.arch}`, 'spawn-helper')
    if (this.cli.dryRun) {
      console.log(`build-exe-for-python-sdk: [dry-run] cp ${source} ${spawnHelper}`)
    } else {
      await copyFile(source, spawnHelper)
      await chmod(spawnHelper, 0o755)
    }
    return [product, spawnHelper]
  }

  /**
   * Put the target node-pty addon in the staged closure. The release workflow
   * provides a manylinux build; ordinary installs use node-pty's target prebuild.
   * @param target - the pkg target whose native addon is being staged.
   */
  private async prepareNativePty(target: Target): Promise<void> {
    const stagedBuild = join(this.staging, 'node_modules', 'node-pty', 'build')
    if (this.cli.dryRun) console.log(`build-exe-for-python-sdk: [dry-run] rm -rf ${stagedBuild}`)
    else await rm(stagedBuild, { recursive: true, force: true })
    if (target.platform !== 'linux') return
    const packageDirectory = join(
      root,
      'packages',
      'subprocess',
      'subprocess-local',
      'node_modules',
      'node-pty',
    )
    const destination = join(stagedBuild, 'Release', 'pty.node')
    const source = resolveLinuxNodePtyAddon(packageDirectory, target.arch)
    if (this.cli.dryRun) {
      console.log(`build-exe-for-python-sdk: [dry-run] cp ${source} ${destination}`)
      return
    }
    const host = Target.host()
    if (target.platform !== host.platform || target.arch !== host.arch) {
      throw new Error(
        'build-exe-for-python-sdk: build the Linux runtime on its target architecture; '
        + `target ${target.platform}-${target.arch} does not match host ${host.platform}-${host.arch}.`,
      )
    }
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(source, destination)
  }

  /**
   * Print each product path and, outside dry-run mode, its size.
   * @param products - the product paths returned by {@link pack}.
   */
  printProducts(products: string[]): void {
    console.log(this.cli.dryRun ? 'build-exe-for-python-sdk: [dry-run] would produce:' : 'build-exe-for-python-sdk: products:')
    for (const path of products) {
      if (this.cli.dryRun) {
        console.log(`  ${path}`)
        continue
      }
      const megabytes = statSync(path).size / (1024 * 1024)
      console.log(`  ${path}  (${megabytes.toFixed(1)} MB)`)
    }
  }

  /**
   * Copy each product into the Python runtime package. The deployed node
   * carrier is already in place, and `dist-exe/` retains upload copies.
   * Windows products stay out: the Python wheels name linux/macos runtimes
   * only, and the desktop standalone packaging stages its own copy.
   * @param products - the product paths returned by {@link pack}.
   */
  async syncToPythonRuntime(products: string[]): Promise<void> {
    const destDir = resolve(root, PYTHON_RUNTIME_DIR)
    if (this.cli.dryRun) {
      for (const path of products) {
        console.log(`build-exe-for-python-sdk: [dry-run] cp ${path} ${join(destDir, basename(path))}`)
      }
      return
    }
    await mkdir(destDir, { recursive: true })
    for (const path of products) {
      if (path.endsWith('.exe')) {
        console.log(`build-exe-for-python-sdk: keeping ${basename(path)} out of the Python runtime (desktop packaging owns it)`)
        continue
      }
      const destination = join(destDir, basename(path))
      await copyFile(path, destination)
      await chmod(destination, statSync(path).mode & 0o777)
      console.log(`build-exe-for-python-sdk: synced ${destination}`)
    }
  }

  /**
   * Run one subprocess with inherited stdio. Spawn and non-zero-exit errors
   * include the command; dry runs only print it.
   * @param label - the step name used in logs and error messages.
   * @param command - the executable.
   * @param args - its arguments.
   */
  private async run(label: string, command: string, args: string[]): Promise<void> {
    const printable = formatCommand(command, args)
    if (this.cli.dryRun) {
      console.log(`build-exe-for-python-sdk: [dry-run] ${printable}`)
      return
    }
    console.log(`build-exe-for-python-sdk: ${label}: ${printable}`)
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(command, args, {
        cwd: root,
        stdio: 'inherit',
        // Windows resolves pnpm/npx through .cmd shims, and Node >= 20.12
        // requires shell mode for those (spawn EINVAL otherwise). Every
        // argument this script passes is space-free, so cmd joining is safe.
        shell: process.platform === 'win32',
        // Artifact builds must not mutate or validate a developer's Git hooks.
        // verify-deps-before-run stays off: the Windows check locks `.bin`
        // shims (EBUSY) while pnpm inspects them, failing unrelated steps.
        env: { ...process.env, CI: 'true', npm_config_verify_deps_before_run: 'false' },
      })
      child.once('error', (error) => {
        reject(new Error(`build-exe-for-python-sdk: ${label} failed to spawn: ${error.message} (${printable})`))
      })
      child.once('exit', (code, signal) => {
        if (code === 0) {
          resolvePromise()
          return
        }
        const cause = code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${code}`
        reject(new Error(`build-exe-for-python-sdk: ${label} failed (${cause}): ${printable}`))
      })
    })
  }
}

async function main(): Promise<void> {
  const cli = BuildCli.parse(process.argv.slice(2))
  const pipeline = new SingleExeBuild(cli)
  console.log(`build-exe-for-python-sdk: targets: ${cli.targets.map(target => target.spec).join(', ')}`)
  console.log(`build-exe-for-python-sdk: staging: ${pipeline.staging}`)
  await pipeline.verifyClosure()
  await pipeline.build()
  await pipeline.deployStaging()
  await pipeline.injectPkgConfig()
  const products: string[] = []
  for (const target of cli.targets) products.push(...await pipeline.pack(target))
  pipeline.printProducts(products)
  await pipeline.syncToPythonRuntime(products)
}

await main()
