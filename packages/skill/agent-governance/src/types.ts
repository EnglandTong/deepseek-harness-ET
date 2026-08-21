/** Public governance routing and audit contracts. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/** Stable identifier for a supported Agent harness. */
export type HarnessId = 'codex' | 'claude-code' | 'deepseek-harness'
/** Human confirmation state for a routed task. */
export type GovernanceDecision = 'pending' | 'approved' | 'rejected'
/** Acceptance state recorded after a child report. */
export type GovernanceAcceptance = 'accepted' | 'rejected' | 'needs-follow-up'
/** Risk level used to decide whether a route can be approved automatically. */
export type GovernanceRiskLevel = 'low' | 'medium' | 'high'
/** Permission mode requested for a delegated task. */
export type GovernancePermissionMode = 'read-only' | 'workspace-write' | 'full-access'
/** Lifecycle state of a delegated task. */
export type GovernanceTaskStatus = 'routed' | 'approved' | 'running' | 'completed' | 'failed' | 'cancelled'

/** Lifecycle phases exposed to a future native Governance extension bridge. */
export type GovernanceLifecyclePhase = 'thread-start' | 'turn-start' | 'route' | 'approval' | 'delegation' | 'tool-execution' | 'turn-stop' | 'report' | 'acceptance'

/** Capability and availability metadata for one harness provider. */
export interface HarnessDescriptor {
  readonly id: HarnessId
  readonly provider: string
  readonly capabilities: readonly string[]
  readonly strengths: readonly string[]
  readonly permission: GovernancePermissionMode
  readonly riskLevel: GovernanceRiskLevel
  readonly supportsSubagent: boolean
  readonly supportsNativeSession: boolean
  readonly supportsStreaming: boolean
  readonly supportsCancellation: boolean
  readonly supportsFiles: boolean
  readonly supportsImages: boolean
  readonly supportsContinuable: boolean
  readonly available: boolean
  readonly diagnosticCode?: 'provider-not-loaded' | 'cli-not-found' | 'sdk-not-configured' | 'workspace-invalid'
  readonly diagnostic?: string
  readonly lastCheckedAt?: string
}

/** Deterministic routing result that still requires execution approval. */
export interface RouteRecommendation {
  readonly task: string
  readonly primary: HarnessId
  readonly alternatives: readonly HarnessId[]
  readonly reasons: readonly string[]
  readonly riskLevel: GovernanceRiskLevel
  readonly permission: GovernancePermissionMode
  readonly requiresApproval: boolean
}

/** Input passed to one harness adapter after governance checks succeed. */
export interface HarnessExecutionRequest {
  readonly taskId: string
  readonly prompt: readonly ContentBlock[]
  readonly workspace: string
  readonly permission: GovernancePermissionMode
  readonly nestedDepth: number
  readonly maxNestedDepth: number
  readonly signal: AbortSignal
  readonly parent: Agent
}

/** Prepared execution request returned by an adapter before starting work. */
export interface PreparedHarnessRequest {
  readonly harness: HarnessId
  readonly provider: string
  readonly request: HarnessExecutionRequest
}

/** Normalized adapter result used by GovernanceService. */
export interface HarnessExecutionResult {
  readonly status: Exclude<GovernanceTaskStatus, 'routed' | 'approved' | 'running'>
  readonly summary: string
  readonly changedFiles: readonly string[]
  readonly tests: readonly { command: string; exitCode: number }[]
  readonly stdout?: string
  readonly stderr?: string
  readonly exitCode?: number
}

/** Provider adapter owned by Governance, without reimplementing provider protocols. */
export interface HarnessAdapter {
  readonly id: HarnessId
  readonly provider: string
  describe(): HarnessDescriptor
  checkAvailability(workspace?: string): HarnessDescriptor
  prepare(request: HarnessExecutionRequest): PreparedHarnessRequest
  execute(prepared: PreparedHarnessRequest): Promise<HarnessExecutionResult>
  cancel(taskId: string): Promise<void>
  dispose(): void
}

/** Normalized child execution report with file and test evidence. */
export interface GovernanceReport {
  readonly taskId: string
  readonly harness: HarnessId
  readonly status: 'completed' | 'failed' | 'cancelled'
  readonly summary: string
  readonly changedFiles: readonly string[]
  readonly tests: readonly { command: string; exitCode: number }[]
  readonly workspace?: string
  readonly permission?: GovernancePermissionMode
  readonly statusDetail?: string
  readonly evidence?: readonly GovernanceEvidence[]
}

/** Small durable reference to a file or command result kept outside model context. */
export interface GovernanceEvidence {
  readonly kind: 'file' | 'test' | 'summary'
  readonly path?: string
  readonly command?: string
  readonly exitCode?: number
  readonly sha256?: string
  readonly summary: string
}

/** Contribution point for model-visible Governance tools. */
export interface GovernanceToolContributor {
  readonly contributeTools: (phase: GovernanceLifecyclePhase) => readonly string[]
}

/** Contribution point for Governance prompt sections. */
export interface GovernancePromptContributor {
  readonly contributePrompt: (phase: GovernanceLifecyclePhase) => string | undefined
}

/** Contribution point for durable context references. */
export interface GovernanceContextContributor {
  readonly contributeContext: (phase: GovernanceLifecyclePhase) => readonly GovernanceEvidence[]
}

/** Contribution point for turn lifecycle observations. */
export interface GovernanceTurnLifecycleContributor {
  readonly onLifecycle: (phase: GovernanceLifecyclePhase, taskId?: string) => void
}

/** Contribution point for future native child spawning. */
export interface GovernanceSubagentSpawner {
  readonly spawn: (taskId: string) => Promise<void>
}

/** Contribution point for future native approval UI integration. */
export interface GovernanceApprovalContributor {
  readonly requestApproval: (taskId: string) => Promise<GovernanceDecision>
}

/** Contribution point for future native Session Event projection. */
export interface GovernanceSessionEventContributor {
  readonly eventTypes: readonly string[]
}

/** State reconstructed from governance Session Events. */
export interface GovernanceTaskState {
  readonly taskId: string
  readonly task: string
  readonly status: GovernanceTaskStatus
  readonly harness?: HarnessId
  readonly provider?: string
  readonly decision?: GovernanceDecision
  readonly acceptance?: GovernanceAcceptance
  readonly report?: GovernanceReport
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
  replay(session: Agent['session']): readonly GovernanceTaskState[]
}

declare module '@deepseek-ai/dsh-session/types' {
  /** Records harness registration and observed provider availability. */
  interface SessionEventMap {
    /** Records a deterministic recommendation for a bounded task. */
    'governance/harness-registered': { harness: HarnessDescriptor; timestamp: string }
    /** Records a provider availability check. */
    'governance/harness-check': { harness: HarnessDescriptor; timestamp: string }
    /** Records human approval or rejection of a recommendation. */
    'governance/route': RouteRecommendation & { taskId: string; timestamp: string }
    /** Records the provider decision for a recommendation. */
    'governance/approval': { taskId: string; decision: GovernanceDecision; reason?: string; timestamp: string }
    /** Records the provider selected for an approved delegation. */
    'governance/delegation-start': { taskId: string; harness: HarnessId; provider: string; workspace: string; permission: GovernancePermissionMode; nestedDepth: number; timestamp: string }
    /** Records a child progress update without embedding its full output. */
    'governance/delegation-progress': { taskId: string; status: GovernanceTaskStatus; summary: string; timestamp: string }
    /** Records child completion status and evidence references. */
    'governance/report': GovernanceReport & { timestamp: string }
    /** Records a bounded file-change or test-evidence summary. */
    'governance/file-change-summary': { taskId: string; evidence: readonly GovernanceEvidence[]; timestamp: string }
    /** Records test evidence separately from the child narrative. */
    'governance/test-evidence': { taskId: string; evidence: readonly GovernanceEvidence[]; timestamp: string }
    /** Records the next file-based handoff location. */
    'governance/handoff': { taskId: string; path: string; sha256?: string; summary: string; timestamp: string }
    /** Records the independent acceptance decision after a report. */
    'governance/acceptance': { taskId: string; decision: GovernanceAcceptance; reason?: string; timestamp: string }
    /** Records cancellation before or during child execution. */
    'governance/delegation-cancelled': { taskId: string; reason?: string; timestamp: string }
    /** Records a child adapter failure. */
    'governance/delegation-failed': { taskId: string; provider: string; summary: string; timestamp: string }
    /** Legacy harness observation retained so existing session logs remain readable. */
    'governance/harness': { harness: HarnessDescriptor }
    /** Legacy approval event retained for pre-2.0 session logs. */
    'governance/decision': { taskId: string; decision: GovernanceDecision; reason?: string }
    /** Legacy delegation event retained for pre-2.0 session logs. */
    'governance/delegate': { taskId: string; harness: HarnessId; provider: string }
    /** Legacy acceptance event retained for pre-2.0 session logs. */
    'governance/accept': { taskId: string; decision: GovernanceAcceptance; reason?: string }
  }
}
