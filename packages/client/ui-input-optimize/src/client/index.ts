/** Composer input-optimize controls and desktop helper-mode Settings row. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  InputOptimizeControls,
} from './InputOptimizeControls.tsx'
import {
  HelperModeRow,
  type HelperModeRowInjected,
} from './HelperModeRow.tsx'
import { en, zh, type InputOptimizeLocaleKey } from './locales.ts'

export type { InputOptimizeLocaleKey } from './locales.ts'

/** Injected Remote verbs for the composer controls. */
export interface InputOptimizeControlsInjected {
  /** Probe helper + STT availability. */
  status(): Promise<{
    optimizeAvailable: boolean
    sttAvailable: boolean
    provider: string | null
    model: string | null
    reason: string | null
  }>
  /** Clean a draft; caller replaces the composer text. */
  optimizeText(text: string): Promise<string>
  /** Transcribe base64 audio from MediaRecorder. */
  transcribe(audioBase64: string, mimeType: string): Promise<string>
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Input-optimize composer copy. */
    inputOptimize: InputOptimizeLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'inputOptimize'

/** Services required by the registration and generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.inputOptimize']

/** Contribute optimize / mic controls and the helper-mode Settings row. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-input-optimize: dictionaries')

  const composerInjected = (): InputOptimizeControlsInjected => ({
    status: async () => {
      const result = await ctx.remote.inputOptimize.status()
      if (!result.ok) {
        throw new Error(`inputOptimize.status failed: ${result.error.code}: ${result.error.message}`)
      }
      return result.value
    },
    optimizeText: async (text) => {
      const result = await ctx.remote.inputOptimize.optimizeText(text)
      if (!result.ok) {
        throw new Error(`${result.error.code}: ${result.error.message}`)
      }
      return result.value.text
    },
    transcribe: async (audioBase64, mimeType) => {
      const result = await ctx.remote.inputOptimize.transcribe(audioBase64, mimeType)
      if (!result.ok) {
        throw new Error(`${result.error.code}: ${result.error.message}`)
      }
      return result.value.text
    },
  })

  const helperInjected = (): HelperModeRowInjected => ({
    helperMode: async () => {
      const result = await ctx.remote.inputOptimize.helperMode()
      if (!result.ok) {
        throw new Error(`inputOptimize.helperMode failed: ${result.error.code}: ${result.error.message}`)
      }
      return result.value
    },
    setHelperMode: async (mode) => {
      const result = await ctx.remote.inputOptimize.setHelperMode(mode)
      if (!result.ok) {
        throw new Error(`${result.error.code}: ${result.error.message}`)
      }
      return result.value
    },
  })

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'input-optimize',
    order: 40,
    locale: NS,
    inject: composerInjected,
  }, InputOptimizeControls))

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'desktop-helper-mode',
    order: 35,
    locale: NS,
    inject: helperInjected,
  }, HelperModeRow))
}
