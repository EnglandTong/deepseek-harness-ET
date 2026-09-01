/** Public request, result and notification types for bounded orchestration. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SupervisorRunId, SupervisorTaskId, SupervisorTaskSnapshot } from '@deepseek-ai/dsh-supervisor'
import type { SupervisorExecutionResult } from '@deepseek-ai/dsh-supervisor-executor-subagent'
import type { PermissionCeiling, ResolvedRouteDecision, RouteRequest } from '@deepseek-ai/dsh-supervisor-routing-policy'

/** Tunables controlling repair and automatic dispatch. */
export interface SupervisorOrchestratorConfig {
  /** Maximum automatic repair attempts for one task. */
  readonly maxRepairAttempts: number
  /** Whether policy-approved tasks start without a separate dispatch command. */
  readonly autoDispatch: boolean
  /** Whether failed runs may enter the bounded repair loop. */
  readonly retryOnFailure: boolean
}

/** A user request captured by the main assistant. */
export interface SupervisorCaptureRequest {
  readonly projectId: SupervisorTaskSnapshot['projectId']
  readonly title: string
  readonly description: string
  readonly nextAction: string
  readonly prompt: readonly ContentBlock[]
  readonly parent: Agent
  readonly route: Omit<RouteRequest, 'taskId' | 'projectId' | 'projectPath'>
  readonly permission: PermissionCeiling
  readonly background?: boolean
}

/** Result of capture and classification, including an approval batch key. */
export interface SupervisorCaptureResult {
  readonly task: SupervisorTaskSnapshot
  readonly route: ResolvedRouteDecision
  readonly approvalBatchId?: string
}

/** A group of owner confirmations presented together. */
export interface SupervisorApprovalBatch {
  readonly id: string
  readonly taskIds: readonly SupervisorTaskId[]
  readonly createdAt: string
}

/** Immediate result after a task enters execution. */
export interface SupervisorDispatchResult {
  readonly task: SupervisorTaskSnapshot
  readonly runId: SupervisorRunId
}

/** A terminal execution record retained for follow-up and audit. */
export interface SupervisorRunResult {
  readonly taskId: SupervisorTaskId
  readonly runId: SupervisorRunId
  readonly attempt: number
  readonly result: SupervisorExecutionResult
  readonly failureSignature?: string
}

/** A user-directed revision-safe follow-up. */
export interface SupervisorFollowUpRequest {
  readonly taskId: SupervisorTaskId
  readonly expectedRevision: number
  readonly prompt: readonly ContentBlock[]
  readonly nextAction: string
}

/** Critical notification delivered to the main assistant and listeners. */
export interface SupervisorOrchestratorNotification {
  readonly taskId: SupervisorTaskId
  readonly kind: 'owner-decision' | 'blocked' | 'failed' | 'ready-for-review' | 'policy-gate'
  readonly message: string
  readonly createdAt: string
}

/** Listener for deduplicated critical orchestration notifications. */
export type SupervisorNotificationListener = (notification: SupervisorOrchestratorNotification) => void
