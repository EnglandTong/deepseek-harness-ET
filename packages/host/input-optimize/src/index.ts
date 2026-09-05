/**
 * Host Remote for composer draft cleanup and optional local speech-to-text.
 * Calls `ctx.llm` with `purpose: 'input-optimize'` when a helper route is
 * configured (desktop `--patch` pins `local-edge` when the sidecar is healthy).
 */

import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  BlockAssembler,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  DesktopHelperMode,
  DesktopHelperModeSource,
  HelperModeSnapshot,
  InputOptimizeStatus,
  OptimizeTextResult,
  SetHelperModeResult,
  TranscribeResult,
} from './types.ts'

export type * from './types.ts'

/** Filename under `$DSH_HOME` for Settings overrides (outranks install-dir JSON). */
export const DESKTOP_HELPER_MODE_FILE = 'desktop-helper-mode.json'
/** Filename under `$DSH_HOME` written by Electron with the last resolved mode. */
export const DESKTOP_HELPER_EFFECTIVE_FILE = 'desktop-helper-effective.json'

/** Plugin configuration for the helper route and STT binary. */
export interface InputOptimizeConfig {
  /** When false, Remote methods report unavailable. */
  enabled?: boolean
  /** Helper LLM provider route (e.g. `local-edge`). */
  provider?: string
  /** Helper LLM model id. */
  model?: string
  /** Max output tokens for the optimize call. */
  maxTokens?: number
  /**
   * Optional local STT executable. Receives `--input <wav-or-webm path>` and
   * must print transcript text on stdout. Env `DSH_LOCAL_STT_BIN` overrides.
   */
  sttBin?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Draft optimize + local STT Remote owner. */
    inputOptimize: InputOptimizeGateway
  }
}

const OPTIMIZE_SYSTEM = [
  'You clean user drafts for an agent composer.',
  'Fix obvious speech-to-text and typing mistakes, keep the user intent,',
  'preserve technical tokens and paths, and return only the cleaned draft text',
  'with no preface or quotation marks.',
].join(' ')

/**
 * Host service backing the generated `ctx.remote.inputOptimize` namespace.
 */
export class InputOptimizeGateway extends TypertRemoteService {
  static Config: z<InputOptimizeConfig> = z.object({
    enabled: z.boolean().default(false),
    provider: z.string().default(''),
    model: z.string().default(''),
    maxTokens: z.number().default(2048),
    sttBin: z.string().default(''),
  })

  private readonly config: Required<InputOptimizeConfig>

  /**
   * @param ctx - Cordis context; `llm` is read with `ctx.get` so the service can mount without a helper route.
   * @param config - validated plugin config from cordis.yml / --patch.
   */
  constructor(ctx: Context, config: InputOptimizeConfig) {
    super(ctx, 'inputOptimize')
    this.config = {
      enabled: config.enabled ?? false,
      provider: config.provider ?? '',
      model: config.model ?? '',
      maxTokens: config.maxTokens ?? 2048,
      sttBin: config.sttBin ?? '',
    }
  }

  private resolveSttBin(): string | null {
    const env = process.env.DSH_LOCAL_STT_BIN
    if (typeof env === 'string' && env.trim() !== '') return env.trim()
    if (this.config.sttBin.trim() !== '') return this.config.sttBin.trim()
    return null
  }

  private resolveRoute(): { provider: string; model: string } | null {
    const configuredProvider = this.config.provider.trim()
    const configuredModel = this.config.model.trim()
    if (configuredProvider !== '' && configuredModel !== '') {
      return { provider: configuredProvider, model: configuredModel }
    }
    // Cloud / Settings path: follow the same default model the Models page owns.
    const defaults = this.ctx.get('agentDefaultModel') as
      | { currentSelection(): { provider: string; model: string } }
      | undefined
    const selection = defaults?.currentSelection()
    if (
      selection !== undefined
      && selection.provider.trim() !== ''
      && selection.model.trim() !== ''
    ) {
      return { provider: selection.provider.trim(), model: selection.model.trim() }
    }
    return null
  }

  private routeOrThrow(): { provider: string; model: string } {
    if (!this.config.enabled) {
      throw new RemoteError(
        'input-optimize/unavailable',
        'input optimize is disabled',
        { reason: 'enabled=false' },
      )
    }
    if (this.ctx.get('llm') === undefined) {
      throw new RemoteError(
        'input-optimize/unavailable',
        'llm service is not mounted',
        { reason: 'llm missing' },
      )
    }
    const route = this.resolveRoute()
    if (route === null) {
      throw new RemoteError(
        'input-optimize/unavailable',
        'no helper provider/model: set input-optimize config or choose a model in Settings',
        { reason: 'missing provider/model' },
      )
    }
    return route
  }

  /**
   * Report whether optimize and STT are currently usable.
   * @returns capability snapshot for Client chrome.
   */
  @Remote
  status(): InputOptimizeStatus {
    const sttAvailable = this.resolveSttBin() !== null
    if (!this.config.enabled) {
      return {
        optimizeAvailable: false,
        sttAvailable,
        provider: null,
        model: null,
        reason: 'disabled',
      }
    }
    if (this.ctx.get('llm') === undefined) {
      return {
        optimizeAvailable: false,
        sttAvailable,
        provider: null,
        model: null,
        reason: 'llm missing',
      }
    }
    const route = this.resolveRoute()
    if (route === null) {
      return {
        optimizeAvailable: false,
        sttAvailable,
        provider: null,
        model: null,
        reason: 'missing provider/model',
      }
    }
    return {
      optimizeAvailable: true,
      sttAvailable,
      provider: route.provider,
      model: route.model,
      reason: null,
    }
  }

  /**
   * Clean a composer draft through the helper model before the user confirms send.
   * @param text - raw draft (typed or transcribed).
   * @param signal - caller cancellation.
   * @returns optimized text plus the helper route used.
   */
  @Remote
  async optimizeText(text: string, signal?: AbortSignal): Promise<OptimizeTextResult> {
    const route = this.routeOrThrow()
    const trimmed = text.trim()
    if (trimmed.length === 0) {
      throw new RemoteError('input-optimize/empty', 'draft is empty', {})
    }
    signal?.throwIfAborted()
    const messages: Message[] = [createUserMessage({
      content: [{ type: 'text', text: trimmed }],
      source: { kind: 'plugin', plugin: 'dsh-host-input-optimize' },
    })]
    const options: GenerateOptions = {
      provider: route.provider,
      model: route.model,
      messages,
      system: OPTIMIZE_SYSTEM,
      maxTokens: this.config.maxTokens,
      purpose: 'input-optimize',
      ...(signal === undefined ? {} : { signal }),
    }
    const llm = this.ctx.get('llm')
    /* v8 ignore next 7 -- routeOrThrow already requires llm; retained as a same-method guard. */
    if (llm === undefined) {
      throw new RemoteError(
        'input-optimize/unavailable',
        'llm service is not mounted',
        { reason: 'llm missing' },
      )
    }
    const assembler = new BlockAssembler()
    for await (const chunk of llm.stream(options)) {
      signal?.throwIfAborted()
      assembler.push(chunk)
    }
    signal?.throwIfAborted()
    const finish = assembler.finish
    if (finish.kind === 'error' || finish.kind === 'aborted') {
      throw new RemoteError(
        'input-optimize/unavailable',
        finish.failure.message,
        { reason: finish.failure.message },
      )
    }
    const out = assembler.blocks()
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim()
    if (out.length === 0) {
      throw new RemoteError('input-optimize/empty', 'helper model produced no text', {})
    }
    return { text: out, provider: route.provider, model: route.model }
  }

  /**
   * Read the effective desktop helper mode (env → `$DSH_HOME` override → install default).
   * @returns mode snapshot for Settings; always notes that a change needs restart.
   */
  @Remote
  async helperMode(): Promise<HelperModeSnapshot> {
    const detail = await resolveHelperModeFromHome(resolveDshHome())
    return {
      mode: detail.mode,
      source: detail.source,
      envLocked: detail.source === 'env',
      restartRequired: true,
    }
  }

  /**
   * Persist a home-level helper mode override. Does not rebuild the Electron patch
   * until the desktop shell restarts.
   * @param mode - `cloud` | `local` | `off`.
   * @returns written mode plus restartRequired.
   */
  @Remote
  async setHelperMode(mode: string): Promise<SetHelperModeResult> {
    const parsed = parseHelperMode(mode)
    if (parsed === null) {
      throw new RemoteError(
        'input-optimize/bad-mode',
        `helper mode must be cloud|local|off, got ${JSON.stringify(mode)}`,
        { mode: String(mode) },
      )
    }
    if (parseHelperMode(process.env.DSH_HELPER_MODE ?? '') !== null) {
      throw new RemoteError(
        'input-optimize/unavailable',
        'DSH_HELPER_MODE is set; unset it to change mode from Settings',
        { reason: 'env locked' },
      )
    }
    const home = resolveDshHome()
    await mkdir(home, { recursive: true })
    const path = join(home, DESKTOP_HELPER_MODE_FILE)
    await writeFile(path, `${JSON.stringify({ mode: parsed }, null, 2)}\n`, 'utf8')
    return { mode: parsed, restartRequired: true }
  }

  /**
   * Run optional local STT on a browser-captured audio blob (base64).
   * @param audioBase64 - raw audio bytes, base64-encoded.
   * @param mimeType - browser MediaRecorder mime type (used only for file suffix).
   * @param signal - caller cancellation.
   * @returns transcript text.
   */
  @Remote
  async transcribe(audioBase64: string, mimeType: string, signal?: AbortSignal): Promise<TranscribeResult> {
    const bin = this.resolveSttBin()
    if (bin === null) {
      throw new RemoteError(
        'input-optimize/stt-unavailable',
        'no local STT binary (set DSH_LOCAL_STT_BIN or input-optimize.sttBin)',
        { reason: 'missing stt binary' },
      )
    }
    signal?.throwIfAborted()
    const suffix = mimeType.includes('wav') ? '.wav' : mimeType.includes('mp4') ? '.mp4' : '.webm'
    const dir = await mkdtemp(join(tmpdir(), 'dsh-stt-'))
    const inputPath = join(dir, `audio${suffix}`)
    try {
      await writeFile(inputPath, Buffer.from(audioBase64, 'base64'))
      signal?.throwIfAborted()
      const text = await runStt(bin, inputPath, signal)
      const trimmed = text.trim()
      if (trimmed.length === 0) {
        throw new RemoteError('input-optimize/empty', 'STT produced no text', {})
      }
      return { text: trimmed }
    } finally {
      try {
        await rm(dir, { recursive: true, force: true })
      } catch {
        /* v8 ignore next -- temp cleanup is best-effort when the OS still holds the file. */
      }
    }
  }
}

/**
 * @param value - raw mode string.
 * @returns normalized mode or null.
 */
function parseHelperMode(value: string): DesktopHelperMode | null {
  const v = value.trim().toLowerCase()
  if (v === 'cloud' || v === 'local' || v === 'off') return v
  return null
}

/**
 * Resolve helper mode the same precedence as `apps/desktop/sidecar.js` for
 * Settings: env → home override → Electron effective snapshot → default local.
 * @param dshHome - absolute `$DSH_HOME`.
 * @returns mode and source.
 */
async function resolveHelperModeFromHome(
  dshHome: string,
): Promise<{ mode: DesktopHelperMode; source: DesktopHelperModeSource }> {
  const fromEnv = parseHelperMode(process.env.DSH_HELPER_MODE ?? '')
  if (fromEnv !== null) return { mode: fromEnv, source: 'env' }
  try {
    const raw = JSON.parse(await readFile(join(dshHome, DESKTOP_HELPER_MODE_FILE), 'utf8')) as {
      mode?: unknown
    }
    if (typeof raw.mode === 'string') {
      const mode = parseHelperMode(raw.mode)
      if (mode !== null) return { mode, source: 'home' }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Invalid JSON: treat as unset.
    }
  }
  try {
    const raw = JSON.parse(await readFile(join(dshHome, DESKTOP_HELPER_EFFECTIVE_FILE), 'utf8')) as {
      mode?: unknown
      source?: unknown
    }
    if (typeof raw.mode === 'string') {
      const mode = parseHelperMode(raw.mode)
      if (mode !== null) {
        const source = raw.source === 'install' || raw.source === 'default' || raw.source === 'home' || raw.source === 'env'
          ? raw.source
          : 'install'
        return { mode, source }
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Invalid effective snapshot: treat as unset.
    }
  }
  return { mode: 'local', source: 'default' }
}

/**
 * @param bin - STT executable path.
 * @param inputPath - audio file path.
 * @param signal - optional abort.
 * @returns stdout transcript.
 */
function runStt(bin: string, inputPath: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const useShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)
    const child = spawn(bin, ['--input', inputPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: useShell,
    })
    let stdout = ''
    let stderr = ''
    const onAbort = (): void => {
      child.kill('SIGTERM')
      reject(new RemoteError('gateway/cancelled', 'STT was aborted', {}))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout?.on('data', (chunk: Buffer | string) => { stdout += String(chunk) })
    child.stderr?.on('data', (chunk: Buffer | string) => { stderr += String(chunk) })
    child.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort)
      reject(new RemoteError(
        'input-optimize/stt-unavailable',
        err.message,
        { reason: err.message },
        { cause: err },
      ))
    })
    child.on('exit', (code) => {
      signal?.removeEventListener('abort', onAbort)
      if (code !== 0) {
        reject(new RemoteError(
          'input-optimize/stt-unavailable',
          `STT exited ${code}: ${stderr.trim() || 'no stderr'}`,
          { reason: `exit ${code}` },
        ))
        return
      }
      resolve(stdout)
    })
  })
}

/** Cordis class-plugin entry. */
export default InputOptimizeGateway
