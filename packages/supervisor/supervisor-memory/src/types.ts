/** Durable and prompt-facing values owned by the Supervisor memory layer. */

import type {
  SupervisorEvent,
  SupervisorProjection,
  SupervisorProjectId,
  SupervisorTaskId,
} from '@deepseek-ai/dsh-supervisor'
import type { ProjectGovernanceState } from '@deepseek-ai/dsh-supervisor-project-state'

/** One raw Supervisor event with an explicit source sequence. */
export interface SupervisorMemoryRecord {
  readonly seq: number
  readonly event: SupervisorEvent
}

/** A bounded set of records used to create one rolling summary. */
export interface MemorySourceRange {
  readonly start: number
  readonly end: number
}

/** One source reference retained in a summary or query brief. */
export interface MemoryEvidenceReference {
  readonly kind: 'event' | 'run' | 'session' | 'governance' | 'policy'
  readonly value: string
  readonly seq?: number
}

/** Compact project/task facts prepared for the main Supervisor prompt. */
export interface SupervisorRollingSummary {
  readonly projectId: SupervisorProjectId
  readonly taskIds: readonly SupervisorTaskId[]
  readonly currentState: string
  readonly projectRevision: number
  readonly taskRevisions: Readonly<Record<string, number>>
  readonly userDecisions: readonly string[]
  readonly pendingConfirmations: readonly string[]
  readonly blockers: readonly string[]
  readonly uniqueNextSteps: readonly string[]
  readonly evidence: readonly MemoryEvidenceReference[]
  readonly sourceRange: MemorySourceRange
  readonly authorityFingerprint?: string
  readonly policyVersion?: string
  readonly generatedAt: string
}

/** Optional governance snapshot associated with a registered project. */
export interface SupervisorGovernanceMemory {
  readonly projectId: SupervisorProjectId
  readonly state: ProjectGovernanceState
}

/** All structured facts derived from raw events and current governance reads. */
export interface SupervisorMemoryProjection {
  readonly supervisor: SupervisorProjection
  readonly governance: ReadonlyMap<string, ProjectGovernanceState>
  readonly sourceSeq: number
}

/** Summary collection persisted as a bounded memory checkpoint. */
export interface SupervisorMemoryCheckpoint {
  readonly version: 1
  readonly sourceSeq: number
  readonly sourceDigest: string
  readonly summaries: readonly SupervisorRollingSummary[]
  readonly authorityFingerprints: Readonly<Record<string, string | undefined>>
}

/** Reason a checkpoint is reused or rebuilt during startup reconciliation. */
export type MemoryReconciliationAction = 'reused' | 'tail-replayed' | 'fully-replayed' | 'invalidated'

/** Restart reconciliation output. */
export interface SupervisorMemoryReconciliation {
  readonly action: MemoryReconciliationAction
  readonly projection: SupervisorMemoryProjection
  readonly checkpoint: SupervisorMemoryCheckpoint
  readonly invalidatedProjectIds: readonly SupervisorProjectId[]
}

/** Prompt-specific bounded view; it never replaces the projection authority. */
export interface SupervisorQueryBrief {
  readonly question: string
  readonly generatedAt: string
  readonly summaries: readonly SupervisorRollingSummary[]
  readonly notifications: readonly string[]
  readonly sourceSeq: number
  readonly truncated: boolean
}

/** Configuration for deterministic memory bounds. */
export interface SupervisorMemoryConfig {
  /** Maximum characters retained in one rolling summary. */
  readonly maxSummaryChars: number
  /** Maximum project summaries included in a query brief. */
  readonly maxBriefSummaries: number
  /** Maximum notification lines included in a query brief. */
  readonly maxBriefNotifications: number
  /** Prompt pressure ratio that requests a compaction. */
  readonly compactionThreshold: number
}

/** Partial deployment input resolved against the package's explicit defaults. */
export type SupervisorMemoryConfigInput = Partial<SupervisorMemoryConfig>

/** Token observation used to decide whether the main conversation needs compaction. */
export interface MemoryPressure {
  readonly promptTokens: number
  readonly contextLimit: number
  readonly reservedTokens?: number
}
