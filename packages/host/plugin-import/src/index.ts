/**
 * Remote owner of the `pluginImport` namespace: installs a plugin bundle into
 * the profile this web surface booted from, reconciles `dsh.profile.bundles`,
 * and hot-applies the fresh layers through the launcher-provided manager seam.
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { installProfileBundle, readProfileManifest, resolveBundleDir } from '@deepseek-ai/dsh-app-boot'
import type { BundleListSnapshot, ImportReport, ProfilePluginManager } from './types.ts'

export type * from './types.ts'

/**
 * Context key under which the launcher provides the profile plugin manager.
 * Only surfaces booted through a dsh profile (`runProfile`) provide it.
 */
export const PROFILE_PLUGIN_MANAGER_KEY = '@deepseek-ai/dsh-host-plugin-import/manager'

/**
 * Host service backing the generated `ctx.remote.pluginImport` namespace.
 * Every write is a profile-directory install through pnpm, exactly what
 * `dsh plugin --profile <name> add` performs from the terminal.
 */
export class PluginImportGateway extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'pluginImport')
  }

  private manager(): ProfilePluginManager {
    const manager = this.ctx.get(PROFILE_PLUGIN_MANAGER_KEY) as ProfilePluginManager | undefined
    if (manager === undefined) {
      throw new RemoteError(
        'plugin-import/unavailable',
        'plugin import is unavailable: this web surface is not booted through a dsh profile',
        {},
      )
    }
    return manager
  }

  /**
   * Report the profile's current bundle layer list with per-bundle resolution.
   * @returns the profile name plus one row per `dsh.profile.bundles` entry, in layer order.
   */
  @Remote
  listBundles(): BundleListSnapshot {
    const { context } = this.manager()
    const manifest = readProfileManifest(context.binName, context.dir)
    const bundles = (manifest.dsh?.profile?.bundles ?? []).map((name) => {
      let resolvable = false
      try {
        resolveBundleDir(context.binName, name, context.installAnchor, context.dir)
        resolvable = true
      } catch {
        resolvable = false
      }
      return { name, resolvable }
    })
    return { profileName: context.name, bundles }
  }

  /**
   * Install one package into the profile through pnpm, reconcile its bundle
   * layers, and hot-apply them to the running tree. A pnpm or reconciliation
   * failure is reported in the returned report, not thrown, so the browser
   * can show the full install transcript.
   * @param spec - a registry name or a `file:`/`link:`/path spec (relative paths anchor to the profile).
   * @param signal - caller lifetime; aborts the install await.
   * @returns the import report.
   */
  @Remote
  async import(spec: string, signal?: AbortSignal): Promise<ImportReport> {
    const { context } = this.manager()
    const result = await installProfileBundle({
      binName: context.binName,
      profileDir: context.dir,
      installAnchor: context.installAnchor,
      spec,
      anchorCwd: context.dir,
    })
    if (signal?.aborted === true) {
      throw new RemoteError('gateway/cancelled', 'plugin import was aborted', {})
    }
    if (!result.ok) {
      return {
        ok: false,
        exitCode: result.exitCode,
        output: result.output,
        addedBundles: [],
        applied: false,
      }
    }
    let applied = false
    let applyError: string | undefined
    if (result.addedBundles.length > 0) {
      try {
        const apply = await this.manager().applyInstalledBundles()
        applied = apply.ok
        applyError = apply.error
      } catch (error: unknown) {
        applied = false
        applyError = error instanceof Error ? error.message : String(error)
      }
    }
    return {
      ok: true,
      exitCode: 0,
      output: result.output,
      addedBundles: result.addedBundles,
      applied,
      ...(applyError !== undefined ? { applyError } : {}),
    }
  }
}

export default PluginImportGateway
