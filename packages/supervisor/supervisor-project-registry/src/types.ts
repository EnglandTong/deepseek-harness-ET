/** Public records used by the Personal Supervisor project registry. */

import type { SupervisorProjectId, SupervisorProjectSnapshot } from '@deepseek-ai/dsh-supervisor'

/** Filesystem observation for one explicitly supplied path. */
export type ProjectPathKind =
  | 'directory'
  | 'symlink'
  | 'junction'
  | 'missing'
  | 'not-directory'
  | 'inaccessible'

/** Read-only result returned by bounded candidate discovery. */
export interface ProjectCandidate {
  /** Absolute path spelling supplied or enumerated by the caller. */
  readonly path: string
  /** Canonical path when the target exists and can be resolved. */
  readonly realPath?: string
  /** Display name derived from the final path component. */
  readonly displayName: string
  /** Path kind observed without reading project file contents. */
  readonly kind: ProjectPathKind
  /** Whether the canonical directory has a `.git` file worktree marker. */
  readonly isWorktree: boolean
  /** Existing registry owner, when the canonical path is already enrolled. */
  readonly registeredProjectId?: SupervisorProjectId
  /** Stable diagnostic for missing or inaccessible observations. */
  readonly reason?: string
}

/** Options for bounded, read-only candidate discovery. */
export interface ProjectDiscoveryOptions {
  /** Explicit parent directories to inspect; no implicit disk-wide scan occurs. */
  readonly roots: readonly string[]
  /** Maximum immediate child directories inspected per root. */
  readonly maxCandidatesPerRoot?: number
  /** Optional cancellation signal for filesystem enumeration. */
  readonly signal?: AbortSignal
}

/** Plugin configuration for project registry behavior. */
export interface ProjectRegistryConfig {
  /** Provider name used when registering with `ctx.supervisor`; defaults to `filesystem`. */
  readonly providerName?: string
  /** Maximum immediate child entries inspected by discovery; defaults to 256. */
  readonly maxCandidatesPerRoot?: number
}

/** Snapshot returned by an explicit enrollment operation. */
export type RegisteredProject = SupervisorProjectSnapshot
