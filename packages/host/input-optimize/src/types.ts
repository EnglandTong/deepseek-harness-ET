/** Types for the input-optimize Remote surface. */

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Helper route is disabled or no provider/model is configured. */
    'input-optimize/unavailable': { readonly reason: string }
    /** Local speech-to-text binary is not configured or failed. */
    'input-optimize/stt-unavailable': { readonly reason: string }
    /** The helper model produced no usable text. */
    'input-optimize/empty': {}
    /** Helper mode value is not cloud|local|off. */
    'input-optimize/bad-mode': { readonly mode: string }
  }
}

/** Desktop helper install/runtime modes. */
export type DesktopHelperMode = 'cloud' | 'local' | 'off'

/** Where the effective helper mode was resolved from. */
export type DesktopHelperModeSource = 'env' | 'home' | 'install' | 'default'

/** Result of one draft optimization call. */
export interface OptimizeTextResult {
  /** Cleaned draft text ready for composer confirmation. */
  readonly text: string
  /** Provider route used for the helper call. */
  readonly provider: string
  /** Model id used for the helper call. */
  readonly model: string
}

/** Result of one local speech-to-text call. */
export interface TranscribeResult {
  /** Transcript text (may still need optimizeText). */
  readonly text: string
}

/** Capability probe for the Client chrome. */
export interface InputOptimizeStatus {
  /** Whether optimizeText can run with the current config and llm routes. */
  readonly optimizeAvailable: boolean
  /** Whether local STT is configured. */
  readonly sttAvailable: boolean
  /** Configured helper provider, when set. */
  readonly provider: string | null
  /** Configured helper model, when set. */
  readonly model: string | null
  /** Human-readable reason when optimize is unavailable. */
  readonly reason: string | null
}

/** Effective desktop helper mode for Settings. */
export interface HelperModeSnapshot {
  /** Resolved mode used on next desktop launch. */
  readonly mode: DesktopHelperMode
  /** Resolution source. */
  readonly source: DesktopHelperModeSource
  /** True when `DSH_HELPER_MODE` env wins and Settings cannot override. */
  readonly envLocked: boolean
  /** Changing mode requires restarting the desktop shell to re-apply the patch. */
  readonly restartRequired: true
}

/** Outcome of writing a home-level helper mode override. */
export interface SetHelperModeResult {
  /** Mode now stored under `$DSH_HOME`. */
  readonly mode: DesktopHelperMode
  /** Always true: Electron must relaunch to rebuild the helper patch. */
  readonly restartRequired: true
}
