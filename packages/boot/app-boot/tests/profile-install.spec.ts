import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { boot, updateRootIncludePatches } from '../src/index.ts'
import { anchorPathSpec, installProfileBundle, reconcileProfileBundles } from '../src/profile-install.ts'

const NAME = 'dsh-profile-install-spec'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'dsh-profile-install-'))

/** A profile manifest on disk with the given dependencies and bundle layers. */
function writeProfile(dir: string, options: {
  dependencies?: Record<string, string>
  bundles?: string[]
}): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-spec',
    private: true,
    ...options.dependencies !== undefined ? { dependencies: options.dependencies } : {},
    dsh: { profile: { bundles: options.bundles ?? [] } },
  }, null, 2))
}

/** A resolvable fixture bundle under the profile's node_modules. */
function writeBundle(dir: string, name: string, withBundle: boolean): void {
  const packageDir = join(dir, 'node_modules', ...name.split('/'))
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
    name,
    version: '0.0.0',
    ...withBundle ? { dsh: { bundle: { patch: './cordis.patch.yml' } } } : {},
  }))
}

const readManifest = (dir: string): { dsh?: { profile?: { bundles?: string[] } } } =>
  JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))

describe('anchorPathSpec', () => {
  const base = join(tmpdir(), 'anchor-spec')

  it('resolves bare relative paths against the anchor cwd', () => {
    expect(anchorPathSpec('.', base)).toBe(resolve(base))
    expect(anchorPathSpec('../plugin', base)).toBe(resolve(base, '../plugin'))
  })

  it('keeps file: and link: prefixes while resolving their paths', () => {
    expect(anchorPathSpec('file:./pkg', base)).toBe(`file:${resolve(base, 'pkg')}`)
    expect(anchorPathSpec('link:../pkg', base)).toBe(`link:${resolve(base, '../pkg')}`)
  })

  it('passes registry names and absolute specs through untouched', () => {
    expect(anchorPathSpec('@deepseek-ai/dsh-base', base)).toBe('@deepseek-ai/dsh-base')
    expect(anchorPathSpec('git+https://example.com/pkg.git', base)).toBe('git+https://example.com/pkg.git')
  })
})

describe('reconcileProfileBundles', () => {
  it('appends a newly installed bundle to the layer list and writes the manifest', () => {
    const dir = tmp()
    try {
      writeBundle(dir, '@fixture/base', true)
      writeBundle(dir, '@fixture/kit', true)
      writeProfile(dir, {
        dependencies: { '@fixture/base': '^1.0.0', '@fixture/kit': '^1.0.0' },
        bundles: ['@deepseek-ai/dsh-base', '@fixture/base'],
      })
      const added = reconcileProfileBundles(NAME, join(dir, 'package.json'), dir, { dependencies: { '@fixture/base': '^1.0.0' } }, () => {})
      expect(added).toEqual(['@fixture/kit'])
      expect(readManifest(dir).dsh?.profile?.bundles).toEqual(['@deepseek-ai/dsh-base', '@fixture/base', '@fixture/kit'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('warns for a new dependency that declares no dsh.bundle and skips the layer list', () => {
    const dir = tmp()
    try {
      writeBundle(dir, '@fixture/plain', false)
      writeProfile(dir, { dependencies: { '@fixture/plain': '^1.0.0' }, bundles: [] })
      const warnings: string[] = []
      const added = reconcileProfileBundles(NAME, join(dir, 'package.json'), dir, { dependencies: {} }, (message) => {
        warnings.push(message)
      })
      expect(added).toEqual([])
      expect(warnings).toEqual([expect.stringContaining('@fixture/plain declares no dsh.bundle')])
      expect(readManifest(dir).dsh?.profile?.bundles).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('drops a dependency-managed layer whose installed package no longer declares dsh.bundle', () => {
    const dir = tmp()
    try {
      writeBundle(dir, '@fixture/gone', false)
      writeProfile(dir, { dependencies: { '@fixture/gone': '^1.0.0' }, bundles: ['@fixture/gone'] })
      const added = reconcileProfileBundles(NAME, join(dir, 'package.json'), dir, { dependencies: {} }, () => {})
      expect(added).toEqual([])
      expect(readManifest(dir).dsh?.profile?.bundles).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('never touches template bundles that are not dependencies', () => {
    const dir = tmp()
    try {
      writeProfile(dir, { bundles: ['@deepseek-ai/dsh-base'] })
      const before = readFileSync(join(dir, 'package.json'), 'utf8')
      const added = reconcileProfileBundles(NAME, join(dir, 'package.json'), dir, {}, () => {})
      expect(added).toEqual([])
      expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(before)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('installProfileBundle', () => {
  /**
   * A fake pnpm on PATH, driven by environment variables:
   * `FAKE_PNPM_EXIT` sets the exit code; `FAKE_PNPM_RECEIVED` makes the shim
   * record the spec it received there instead of mutating the profile.
   */
  function writeFakePnpm(binDir: string): void {
    mkdirSync(binDir, { recursive: true })
    const shim = [
      'const { readFileSync, writeFileSync, mkdirSync } = await import("node:fs")',
      'const { join } = await import("node:path")',
      'const spec = process.argv[3]',
      'if (process.env.FAKE_PNPM_RECEIVED !== undefined) {',
      '  writeFileSync(process.env.FAKE_PNPM_RECEIVED, spec ?? "")',
      '} else {',
      '  const exit = Number(process.env.FAKE_PNPM_EXIT ?? "0")',
      '  if (exit === 0 && spec !== undefined) {',
      '    const manifest = JSON.parse(readFileSync("package.json", "utf8"))',
      '    manifest.dependencies = { ...manifest.dependencies, [spec]: "0.0.0" }',
      '    writeFileSync("package.json", JSON.stringify(manifest, null, 2))',
      '    const packageDir = join("node_modules", ...spec.split("/"))',
      '    mkdirSync(packageDir, { recursive: true })',
      '    writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: spec, version: "0.0.0", dsh: { bundle: { patch: "./cordis.patch.yml" } } }))',
      '  }',
      '  process.exit(exit)',
      '}',
    ].join('\n')
    const shimPath = join(binDir, 'pnpm-shim.mjs')
    writeFileSync(shimPath, shim)
    if (process.platform === 'win32') {
      writeFileSync(join(binDir, 'pnpm.cmd'), `@echo off\r\nnode "${shimPath}" %*\r\n`)
    } else {
      const entry = join(binDir, 'pnpm')
      writeFileSync(entry, `#!/usr/bin/env sh\nexec node "${shimPath}" "$@"\n`)
      chmodSync(entry, 0o755)
    }
  }

  /** Prepend `binDir` to PATH for one await, restoring it afterwards. */
  function withPath(binDir: string): void {
    process.env.PATH = `${binDir}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`
  }
  function restorePath(previousPath: string | undefined): void {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
  }

  it('installs through pnpm, reconciles, and reports the added bundle', async () => {
    const dir = tmp()
    const binDir = tmp()
    const previousPath = process.env.PATH
    try {
      writeProfile(dir, { dependencies: {}, bundles: ['@deepseek-ai/dsh-base'] })
      writeFakePnpm(binDir)
      withPath(binDir)
      const result = await installProfileBundle({
        binName: NAME,
        profileDir: dir,
        installAnchor: join(dir, 'package.json'),
        spec: '@fixture/kit',
      })
      expect(result).toMatchObject({ ok: true, exitCode: 0, addedBundles: ['@fixture/kit'] })
      expect(readManifest(dir).dsh?.profile?.bundles).toEqual(['@deepseek-ai/dsh-base', '@fixture/kit'])
    } finally {
      restorePath(previousPath)
      rmSync(dir, { recursive: true, force: true })
      rmSync(binDir, { recursive: true, force: true })
    }
  })

  it('reports a failed install without reconciling', async () => {
    const dir = tmp()
    const binDir = tmp()
    const previousPath = process.env.PATH
    process.env.FAKE_PNPM_EXIT = '1'
    try {
      writeProfile(dir, { dependencies: {}, bundles: [] })
      writeFakePnpm(binDir)
      withPath(binDir)
      const result = await installProfileBundle({
        binName: NAME,
        profileDir: dir,
        installAnchor: join(dir, 'package.json'),
        spec: '@fixture/broken',
      })
      expect(result.ok).toBe(false)
      expect(result.exitCode).toBe(1)
      expect(result.addedBundles).toEqual([])
      expect(result.output).toContain('pnpm failed in profile directory')
      expect(readManifest(dir).dsh?.profile?.bundles).toEqual([])
    } finally {
      delete process.env.FAKE_PNPM_EXIT
      restorePath(previousPath)
      rmSync(dir, { recursive: true, force: true })
      rmSync(binDir, { recursive: true, force: true })
    }
  })

  it('anchors a relative path spec to the given cwd', async () => {
    const dir = tmp()
    const anchorDir = tmp()
    const binDir = tmp()
    const previousPath = process.env.PATH
    process.env.FAKE_PNPM_RECEIVED = join(anchorDir, 'received.txt')
    try {
      writeProfile(dir, { dependencies: {}, bundles: [] })
      writeFakePnpm(binDir)
      withPath(binDir)
      await installProfileBundle({
        binName: NAME,
        profileDir: dir,
        installAnchor: join(dir, 'package.json'),
        spec: '.',
        anchorCwd: anchorDir,
      })
      expect(readFileSync(join(anchorDir, 'received.txt'), 'utf8')).toBe(anchorDir)
    } finally {
      delete process.env.FAKE_PNPM_RECEIVED
      restorePath(previousPath)
      rmSync(dir, { recursive: true, force: true })
      rmSync(anchorDir, { recursive: true, force: true })
      rmSync(binDir, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')('reports pnpm missing when PATH has no pnpm', async () => {
    const dir = tmp()
    const emptyBin = tmp()
    const previousPath = process.env.PATH
    try {
      writeProfile(dir, { dependencies: {}, bundles: [] })
      // POSIX spawns pnpm directly (no shell), so a PATH without pnpm
      // reaches the ENOENT arm; the Windows .cmd shell reports the same
      // condition as a non-zero exit instead.
      process.env.PATH = emptyBin
      const result = await installProfileBundle({
        binName: NAME,
        profileDir: dir,
        installAnchor: join(dir, 'package.json'),
        spec: '@fixture/kit',
      })
      expect(result).toMatchObject({ ok: false, exitCode: 127, addedBundles: [] })
      expect(result.output).toContain('pnpm not found on PATH')
    } finally {
      restorePath(previousPath)
      rmSync(dir, { recursive: true, force: true })
      rmSync(emptyBin, { recursive: true, force: true })
    }
  })
})

describe('updateRootIncludePatches', () => {
  it('hot-applies a fresh patch stack inserting a new plugin into the live tree', async () => {
    const dir = tmp()
    try {
      writeFileSync(join(dir, 'noop.mjs'), 'export const name = "noop"\nexport function apply() {}\n')
      writeFileSync(join(dir, 'late.mjs'), 'export const name = "late"\nexport function apply() {}\n')
      writeFileSync(join(dir, 'cordis.yml'), '- id: noop\n  name: ./noop.mjs\n')
      const ctx = await boot(NAME, join(dir, 'cordis.yml'))
      try {
        const lateHref = pathToFileURL(join(dir, 'late.mjs')).href
        expect([...ctx.loader.entries()].some(entry => entry.options.name === lateHref)).toBe(false)
        await updateRootIncludePatches(ctx, [{ insert: [{ id: 'late', name: lateHref }] }])
        expect([...ctx.loader.entries()].some(entry => entry.options.name === lateHref)).toBe(true)
      } finally {
        await ctx.fiber.dispose()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('throws when the booted tree has no root include entry', async () => {
    const ctx = new Context()
    await expect(updateRootIncludePatches(ctx, [])).rejects.toThrow('root include entry is unavailable')
    await ctx.fiber.dispose()
  })
})
