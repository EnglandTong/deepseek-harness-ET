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
 *
 * `DSH_TSDOWN_WORKSPACE_DIRS` (comma-separated package directories)
 * narrows the build to an explicit closure — the Windows single-exe
 * packaging uses it because a checkout can hold workspace-junctioned
 * packages whose build is owned elsewhere. Unset keeps the full default.
 */
export default defineConfig(({ env }) => {
  const client = isBuildFaceClient(env?.DSH_BUILD_FACE)
  const workspaceDirs = env?.DSH_TSDOWN_WORKSPACE_DIRS?.split(',').map(dir => dir.trim()).filter(dir => dir !== '')
  return {
    workspace: workspaceDirs ?? ['vendor/*', 'packages/*/*', 'apps/cli'],
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
