import { defineConfig } from 'tsdown'
import { typertPlugin } from './packages/typert/generator/lib/types/tsdown-plugin.js'

function isBuildFaceClient(value: unknown): boolean {
  if (value === undefined || value === 'host') return false
  if (value === 'client') return true
  throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host or client, received ${String(value)}`)
}

/**
 * The ordinary workspace build consumes JavaScript emitted by the Host
 * TypeScript project and runs Typert. The Client pass selects packages that
 * declare a browser bundle and lets their package-local configs emit both
 * their Node loader entry and browser artifact.
 */
export default defineConfig(({ env }) => {
  const client = isBuildFaceClient(env?.DSH_BUILD_FACE)
  return {
    // packages/desktop is a single-level Electron app (not a Cordis package).
    // Its children (src/, config/, …) still match packages/*/* as directories;
    // exclude them so tsdown does not walk up to @deepseek-ai/dsh-desktop and
    // try to emit lib/types entries that package does not have.
    workspace: {
      include: ['vendor/*', 'packages/*/*', 'apps/cli'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/test?(s)/**',
        '**/t?(e)mp/**',
        'packages/desktop/**',
      ],
    },
    entry: client ? '' : ['lib/types/{index,invariant,startup}.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    plugins: client ? [] : [typertPlugin({ mode: 'workspace', faces: ['host'] })],
  }
})
