/** Executor bridge contracts. Providers own model or CLI-specific details. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SupervisorProjectId, SupervisorRunId, SupervisorTaskId } from '@deepseek-ai/dsh-supervisor'
import type { SupervisorRunLease } from '@deepseek-ai/dsh-supervisor-project-host'
import type { PermissionCeiling, ResolvedRouteDecision } from '@deepseek-ai/dsh-supervisor-routing-policy'

/** Permission facts that an executor must enforce before creating a child. */
export interface ExecutorCapabilities {
  readonly permissions: readonly PermissionCeiling[]
  readonly background: boolean
  readonly cancellation: boolean
  readonly providers: readonly string[]
}

/** Work submitted after routing and before provider-specific preparation. */
export interface SupervisorExecutionRequest {
  readonly projectId: SupervisorProjectId
  readonly taskId: SupervisorTaskId
  readonly runId: SupervisorRunId
  readonly prompt: readonly ContentBlock[]
  readonly parent: Agent
  readonly route: ResolvedRouteDecision
  readonly permission: PermissionCeiling
  readonly background: boolean
  readonly signal: AbortSignal
}

/** Provider preparation reserves the child identity without starting model work. */
export interface PreparedSupervisorExecution {
  readonly childSessionId: SessionId
  readonly start: () => Promise<SupervisorChildExecution>
  /** Release provider preparation when host admission or startup fails. */
  readonly release?: () => Promise<void>
}

/** Provider-owned child handle. The bridge owns admission and disposal ordering. */
export interface SupervisorChildExecution {
  readonly childSessionId: SessionId
  readonly result: Promise<RawExecutionResult>
  dispose(): Promise<void>
}

/** Provider-neutral terminal result before normalization. */
export interface RawExecutionResult {
  readonly stopReason: 'completed' | 'aborted' | 'error' | 'max-tokens' | 'refusal' | (string & {})
  readonly output?: readonly ContentBlock[]
  readonly diagnostic?: string
  readonly timedOut?: boolean
  readonly signal?: string | null
  readonly exitCode?: number | null
}

/** Normalized terminal status exposed to the orchestrator. */
export type SupervisorExecutionStatus = 'completed' | 'failed' | 'cancelled' | 'timeout' | 'max-tokens'

/** Independent process facts are retained alongside the normalized status. */
export interface SupervisorExecutionResult {
  readonly status: SupervisorExecutionStatus
  readonly output: readonly ContentBlock[]
  readonly diagnostic?: string
  readonly timedOut: boolean
  readonly signal?: string | null
  readonly exitCode?: number | null
}

/** Returned handle for one admitted run. Cancellation targets this run only. */
export interface SupervisorExecutionHandle {
  readonly runId: SupervisorRunId
  readonly childSessionId: SessionId
  readonly lease: SupervisorRunLease
  readonly result: Promise<SupervisorExecutionResult>
  cancel(): Promise<void>
}

/** Registered executor that adapts one or more model or CLI providers. */
export interface SupervisorExecutorProvider {
  readonly name: string
  readonly capabilities: ExecutorCapabilities
  prepare(request: SupervisorExecutionRequest): Promise<PreparedSupervisorExecution>
}
