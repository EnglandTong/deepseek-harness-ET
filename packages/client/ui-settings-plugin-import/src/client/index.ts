/** Plugin bundle import tab registered into Web Settings. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { PluginImportTab, type PluginImportSettingsTabInjected } from './PluginImportTab.tsx'
import { en, zh, type PluginImportLocaleKey } from './locales.ts'

export type { PluginImportSettingsTabInjected, PluginImportSettingsTabProps } from './PluginImportTab.tsx'
export type { PluginImportLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Plugin import copy. */
    'settings.pluginImport': PluginImportLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.pluginImport'

/** Services required by the Settings registration and generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginImport', 'remote.directoryPicker']

/** Contribute the import tab to the Plugins settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-plugin-import: dictionaries')

  const t = ctx.locale.bind(NS)
  const listBundles: PluginImportSettingsTabInjected['listBundles'] = async () => {
    const result = await ctx.remote.pluginImport.listBundles()
    if (!result.ok) {
      throw new Error(`pluginImport.listBundles failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const importSpec: PluginImportSettingsTabInjected['importSpec'] = async (spec) => {
    const result = await ctx.remote.pluginImport.import(spec)
    if (!result.ok) {
      throw new Error(`pluginImport.import failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const browseLocalPath: PluginImportSettingsTabInjected['browseLocalPath'] = async () => {
    const result = await ctx.remote.directoryPicker.pick()
    if (!result.ok) {
      throw new Error(`directoryPicker.pick failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const injected = (): PluginImportSettingsTabInjected => ({ listBundles, importSpec, browseLocalPath })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'import',
    order: 20,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, PluginImportTab))
}
