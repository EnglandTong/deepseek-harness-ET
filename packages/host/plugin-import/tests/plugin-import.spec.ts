import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import PluginImportGateway, { PROFILE_PLUGIN_MANAGER_KEY } from '../src/index.ts'
import type { ProfilePluginManager } from '../src/types.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const tmp = (): string => mkdtempSync(join(tmpdir(), 'dsh-plugin-import-'))

/** A profile directory with a bundle layer list and one resolvable fixture bundle. */
function writeProfile(dir: string, bundles: string[], dependencies: Record<string, string> = {}): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-spec',
    private: true,
    dependencies,
    dsh: { profile: { bundles } },
  }, null, 2))
}

function writeBundle(dir: string, name: string): void {
  const packageDir = join(dir, 'node_modules', ...name.split('/'))
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
    name,
    version: '0.0.0',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
}

async function harness(manager: ProfilePluginManager | undefined): Promise<{
  ctx: Context
  gateway: PluginImportGateway
}> {
  const ctx = new Context()
  contexts.push(ctx)
  if (manager !== undefined) ctx.provide(PROFILE_PLUGIN_MANAGER_KEY, manager)
  await ctx.plugin(PluginImportGateway)
  const gateway = ctx.get('pluginImport') as PluginImportGateway
  return { ctx, gateway }
}

const STUB_MANAGER: ProfilePluginManager = {
  context: {
    binName: 'dsh-spec',
    name: 'spec-profile',
    dir: tmp(),
    installAnchor: join(tmp(), 'package.json'),
  },
  applyInstalledBundles: async () => ({ ok: true }),
}

describe('PluginImportGateway', () => {
  it('publishes listBundles and import under the pluginImport namespace', async () => {
    const { ctx, gateway } = await harness(STUB_MANAGER)
    expect(gateway.typertRemote).toMatchObject({
      serviceKey: 'pluginImport',
      namespace: 'pluginImport',
    })
    expect(remoteMethods(gateway).map(method => method.method)).toEqual(['listBundles', 'import'])
    await ctx.fiber.dispose()
  })

  it('answers RemoteError when the surface is not booted through a profile', async () => {
    const { gateway } = await harness(undefined)
    await expect(async () => gateway.listBundles()).rejects.toMatchObject({
      code: 'plugin-import/unavailable',
    })
  })

  it('reports the layer list with per-bundle resolution from the profile anchors', async () => {
    const dir = tmp()
    try {
      writeProfile(dir, ['@fixture/ok', '@fixture/missing'])
      writeBundle(dir, '@fixture/ok')
      const { gateway } = await harness({
        context: { binName: 'dsh-spec', name: 'spec-profile', dir, installAnchor: join(dir, 'package.json') },
        applyInstalledBundles: async () => ({ ok: true }),
      })
      expect(gateway.listBundles()).toEqual({
        profileName: 'spec-profile',
        bundles: [
          { name: '@fixture/ok', resolvable: true },
          { name: '@fixture/missing', resolvable: false },
        ],
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('imports through pnpm, reconciles, and hot-applies the new layers', async () => {
    const dir = tmp()
    const binDir = tmp()
    const previousPath = process.env.PATH
    try {
      writeProfile(dir, [])
      // The fake pnpm mutates the profile manifest exactly like `pnpm add`
      // would, so the real reconciliation path runs against real files.
      mkdirSync(binDir, { recursive: true })
      const shim = join(binDir, 'pnpm-shim.mjs')
      writeFileSync(shim, [
        'const { readFileSync, writeFileSync, mkdirSync } = await import("node:fs")',
        'const { join } = await import("node:path")',
        'const spec = process.argv[3]',
        'const manifest = JSON.parse(readFileSync("package.json", "utf8"))',
        'manifest.dependencies = { ...manifest.dependencies, [spec]: "0.0.0" }',
        'writeFileSync("package.json", JSON.stringify(manifest, null, 2))',
        'const packageDir = join("node_modules", ...spec.split("/"))',
        'mkdirSync(packageDir, { recursive: true })',
        'writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: spec, version: "0.0.0", dsh: { bundle: { patch: "./cordis.patch.yml" } } }))',
      ].join('\n'))
      if (process.platform === 'win32') {
        writeFileSync(join(binDir, 'pnpm.cmd'), `@echo off\r\nnode "${shim}" %*\r\n`)
      } else {
        const { chmodSync } = await import('node:fs')
        const entry = join(binDir, 'pnpm')
        writeFileSync(entry, `#!/usr/bin/env sh\nexec node "${shim}" "$@"\n`)
        chmodSync(entry, 0o755)
      }
      process.env.PATH = `${binDir}${process.platform === 'win32' ? ';' : ':'}${previousPath ?? ''}`

      let applied = 0
      const { gateway } = await harness({
        context: { binName: 'dsh-spec', name: 'spec-profile', dir, installAnchor: join(dir, 'package.json') },
        applyInstalledBundles: async () => {
          applied += 1
          return { ok: true }
        },
      })
      const report = await gateway.import('@fixture/kit')
      expect(report).toMatchObject({
        ok: true,
        exitCode: 0,
        addedBundles: ['@fixture/kit'],
        applied: true,
      })
      expect(applied).toBe(1)
      expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).dsh.profile.bundles)
        .toEqual(['@fixture/kit'])
    } finally {
      if (previousPath === undefined) delete process.env.PATH
      else process.env.PATH = previousPath
      rmSync(dir, { recursive: true, force: true })
      rmSync(binDir, { recursive: true, force: true })
    }
  })

  it('reports a failed install without hot-applying', async () => {
    const dir = tmp()
    const binDir = tmp()
    const previousPath = process.env.PATH
    try {
      writeProfile(dir, [])
      mkdirSync(binDir, { recursive: true })
      // A fake pnpm that fails immediately: the report carries the failure and
      // the manager trigger never fires.
      if (process.platform === 'win32') {
        writeFileSync(join(binDir, 'pnpm.cmd'), '@echo off\r\nexit /b 3\r\n')
      } else {
        const { chmodSync } = await import('node:fs')
        const entry = join(binDir, 'pnpm')
        writeFileSync(entry, '#!/usr/bin/env sh\nexit 3\n')
        chmodSync(entry, 0o755)
      }
      process.env.PATH = `${binDir}${process.platform === 'win32' ? ';' : ':'}${previousPath ?? ''}`

      let applied = 0
      const { gateway } = await harness({
        context: { binName: 'dsh-spec', name: 'spec-profile', dir, installAnchor: join(dir, 'package.json') },
        applyInstalledBundles: async () => {
          applied += 1
          return { ok: true }
        },
      })
      const report = await gateway.import('@fixture/broken')
      expect(report).toMatchObject({ ok: false, exitCode: 3, addedBundles: [], applied: false })
      expect(applied).toBe(0)
    } finally {
      if (previousPath === undefined) delete process.env.PATH
      else process.env.PATH = previousPath
      rmSync(dir, { recursive: true, force: true })
      rmSync(binDir, { recursive: true, force: true })
    }
  })

  it('reports an install that adds no bundle layer without triggering the manager', async () => {
    const dir = tmp()
    const binDir = tmp()
    const previousPath = process.env.PATH
    try {
      writeProfile(dir, [])
      mkdirSync(binDir, { recursive: true })
      // The fake pnpm adds the dependency but no dsh.bundle declaration, so
      // reconciliation installs a plain library and adds no layer.
      const shim = join(binDir, 'pnpm-shim.mjs')
      writeFileSync(shim, [
        'const { readFileSync, writeFileSync } = await import("node:fs")',
        'const manifest = JSON.parse(readFileSync("package.json", "utf8"))',
        'manifest.dependencies = { ...manifest.dependencies, [process.argv[3]]: "0.0.0" }',
        'writeFileSync("package.json", JSON.stringify(manifest, null, 2))',
      ].join('\n'))
      if (process.platform === 'win32') {
        writeFileSync(join(binDir, 'pnpm.cmd'), `@echo off\r\nnode "${shim}" %*\r\n`)
      } else {
        const { chmodSync } = await import('node:fs')
        const entry = join(binDir, 'pnpm')
        writeFileSync(entry, `#!/usr/bin/env sh\nexec node "${shim}" "$@"\n`)
        chmodSync(entry, 0o755)
      }
      process.env.PATH = `${binDir}${process.platform === 'win32' ? ';' : ':'}${previousPath ?? ''}`

      let applied = 0
      const { gateway } = await harness({
        context: { binName: 'dsh-spec', name: 'spec-profile', dir, installAnchor: join(dir, 'package.json') },
        applyInstalledBundles: async () => {
          applied += 1
          return { ok: true }
        },
      })
      const report = await gateway.import('@fixture/plain')
      expect(report).toMatchObject({ ok: true, exitCode: 0, addedBundles: [], applied: false })
      expect(report.output).toContain('declares no dsh.bundle')
      expect(applied).toBe(0)
    } finally {
      if (previousPath === undefined) delete process.env.PATH
      else process.env.PATH = previousPath
      rmSync(dir, { recursive: true, force: true })
      rmSync(binDir, { recursive: true, force: true })
    }
  })

  it('carries the manager re-apply failure into the report', async () => {
    const dir = tmp()
    const binDir = tmp()
    const previousPath = process.env.PATH
    try {
      writeProfile(dir, [])
      mkdirSync(binDir, { recursive: true })
      const shim = join(binDir, 'pnpm-shim.mjs')
      writeFileSync(shim, [
        'const { readFileSync, writeFileSync, mkdirSync } = await import("node:fs")',
        'const { join } = await import("node:path")',
        'const spec = process.argv[3]',
        'const manifest = JSON.parse(readFileSync("package.json", "utf8"))',
        'manifest.dependencies = { ...manifest.dependencies, [spec]: "0.0.0" }',
        'writeFileSync("package.json", JSON.stringify(manifest, null, 2))',
        'const packageDir = join("node_modules", ...spec.split("/"))',
        'mkdirSync(packageDir, { recursive: true })',
        'writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: spec, version: "0.0.0", dsh: { bundle: { patch: "./cordis.patch.yml" } } }))',
      ].join('\n'))
      if (process.platform === 'win32') {
        writeFileSync(join(binDir, 'pnpm.cmd'), `@echo off\r\nnode "${shim}" %*\r\n`)
      } else {
        const { chmodSync } = await import('node:fs')
        const entry = join(binDir, 'pnpm')
        writeFileSync(entry, `#!/usr/bin/env sh\nexec node "${shim}" "$@"\n`)
        chmodSync(entry, 0o755)
      }
      process.env.PATH = `${binDir}${process.platform === 'win32' ? ';' : ':'}${previousPath ?? ''}`

      const { gateway } = await harness({
        context: { binName: 'dsh-spec', name: 'spec-profile', dir, installAnchor: join(dir, 'package.json') },
        applyInstalledBundles: async () => ({ ok: false, error: 'the tree refused the re-apply' }),
      })
      await expect(gateway.import('@fixture/kit')).resolves.toMatchObject({
        ok: true,
        addedBundles: ['@fixture/kit'],
        applied: false,
        applyError: 'the tree refused the re-apply',
      })
    } finally {
      if (previousPath === undefined) delete process.env.PATH
      else process.env.PATH = previousPath
      rmSync(dir, { recursive: true, force: true })
      rmSync(binDir, { recursive: true, force: true })
    }
  })
})
