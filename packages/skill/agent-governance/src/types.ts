/** Public governance routing and audit contracts. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Stable identifier for a supported Agent harness. */
export type HarnessId = 'codex' | 'claude-code' | 'deepseek-harness'
/** Human confirmation state for a routed task. */
export type GovernanceDecision = 'pending' | 'approved' | 'rejected'
/** Acceptance state recorded after a child report. */
export type GovernanceAcceptance = 'accepted' | 'rejected' | 'needs-follow-up'

/** Capability and availability metadata for one harness provider. */
export interface HarnessDescriptor {
  readonly id: HarnessId
  readonly provider: string
  readonly capabilities: readonly string[]
  readonly strengths: readonly string[]
  readonly permission: 'read-only' | 'workspace-write' | 'full-access'
  readonly supportsFiles: boolean
  readonly supportsImages: boolean
  readonly supportsContinuable: boolean
  readonly available: boolean
  readonly diagnostic?: string
}

/** Deterministic routing result that still requires execution approval. */
export interface RouteRecommendation {
  readonly task: string
  readonly primary: HarnessId
  readonly alternatives: readonly HarnessId[]
  readonly reasons: readonly string[]
  readonly requiresApproval: boolean
}

/** Normalized child execution report with file and test evidence. */
export interface GovernanceReport {
  readonly taskId: string
  readonly harness: HarnessId
  readonly status: 'completed' | 'failed' | 'cancelled'
  readonly summary: string
  readonly changedFiles: readonly string[]
  readonly tests: readonly { command: string; exitCode: number }[]
}

/** Public service operations exposed to other governance consumers. */
export interface GovernanceServiceContract {
  listAgents(): readonly HarnessDescriptor[]
  route(task: string): RouteRecommendation
  approve(taskId: string): void
  reject(taskId: string, reason: string): void
  report(report: GovernanceReport): void
  accept(taskId: string, decision: GovernanceAcceptance, reason?: string): void
  events(session: Agent['session']): readonly SessionEvent[]
}

declare module '@deepseek-ai/dsh-session/types' {
  /** Records harness registration and observed provider availability. */
  interface SessionEventMap {
    /** Records a deterministic recommendation for a bounded task. */
    'governance/harness': { harness: HarnessDescriptor }
    /** Records human approval or rejection of a recommendation. */
    'governance/route': RouteRecommendation & { taskId: string }
    /** Records the provider decision for a recommendation. */
    'governance/decision': { taskId: string; decision: GovernanceDecision; reason?: string }
    /** Records the provider selected for an approved delegation. */
    'governance/delegate': { taskId: string; harness: HarnessId; provider: string }
    /** Records child completion status and evidence references. */
    'governance/report': GovernanceReport
    /** Records the independent acceptance decision after a report. */
    'governance/accept': { taskId: string; decision: GovernanceAcceptance; reason?: string }
  }
}
