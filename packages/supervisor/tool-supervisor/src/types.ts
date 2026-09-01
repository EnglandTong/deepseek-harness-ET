/** Public interaction, intake, and notification records for the Personal Supervisor. */

import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SupervisorNotification, SupervisorProjectId, SupervisorTaskId, SupervisorTaskSnapshot } from '@deepseek-ai/dsh-supervisor'
import type { SupervisorCaptureRequest, SupervisorCaptureResult } from '@deepseek-ai/dsh-supervisor-orchestrator'

/** Message accepted from another conversation through `@总控`. */
export interface SupervisorIntakeRequest {
  /** Stable caller-provided message id used for delivery deduplication. */
  readonly messageId: string
  /** Session that mentioned the controller. */
  readonly sourceSessionId: SessionId
  /** Text addressed to the controller. */
  readonly text: string
  /** Whether an idle controller Agent should be woken immediately. */
  readonly wakeup?: boolean
}

/** Result of one deduplicated intake attempt. */
export interface SupervisorIntakeResult {
  /** `duplicate` means the message was already accepted and was not delivered again. */
  readonly status: 'accepted' | 'queued' | 'duplicate'
  /** Stable message id supplied by the caller. */
  readonly messageId: string
  /** Singleton controller Session receiving the message. */
  readonly supervisorSessionId: SessionId
}

/** Immutable notification exposed to UI consumers after coalescing. */
export interface SupervisorInteractionNotification extends SupervisorNotification {
  /** Number of equivalent notifications represented by this row. */
  readonly count: number
}

/** Read-only command-facing status summary. */
export interface SupervisorStatusView {
  /** Controller identity. */
  readonly identity: string
  /** Durable singleton Session id when initialized. */
  readonly supervisorSessionId?: string
  /** Number of registered projects. */
  readonly projects: number
  /** Number of captured tasks. */
  readonly tasks: number
  /** Number of unacknowledged critical notifications. */
  readonly unreadNotifications: number
  /** Counts by Supervisor task status. */
  readonly taskStates: Readonly<Record<string, number>>
}

/** Orchestrator subset consumed by this interaction adapter. */
export interface SupervisorInteractionOrchestrator {
  listTasks(): readonly SupervisorTaskSnapshot[]
  getTask(taskId: SupervisorTaskId): SupervisorTaskSnapshot | undefined
  listApprovalBatches(): readonly { readonly id: string; readonly taskIds: readonly SupervisorTaskId[]; readonly createdAt: string }[]
  approve(
    batchId: string,
    expectedRevisions?: ReadonlyMap<SupervisorTaskId, number>,
  ): Promise<readonly { readonly task: SupervisorTaskSnapshot; readonly runId: string }[]>
  reject(batchId: string, expectedRevisions?: ReadonlyMap<SupervisorTaskId, number>): void
  dispatch(taskId: SupervisorTaskId, expectedRevision?: number): Promise<{ readonly task: SupervisorTaskSnapshot; readonly runId: string }>
  followUp(request: { readonly taskId: SupervisorTaskId; readonly expectedRevision: number; readonly prompt: readonly import('@deepseek-ai/dsh-llm').ContentBlock[]; readonly nextAction: string }): Promise<{ readonly task: SupervisorTaskSnapshot; readonly runId: string }>
  interrupt(taskId: SupervisorTaskId): Promise<void>
  capture?(request: SupervisorCaptureRequest): Promise<SupervisorCaptureResult>
  review?(taskId: SupervisorTaskId, expectedRevision: number, outcome: 'accepted' | 'needs-fix'): Promise<SupervisorTaskSnapshot> | SupervisorTaskSnapshot
}

/** Registry subset used by project commands. */
export interface SupervisorProjectRegistryLike {
  /** Return enrolled projects in registry order. */
  list(): readonly { readonly id: SupervisorProjectId; readonly displayName: string; readonly realPath: string; readonly status: string }[]
  /** Enroll one explicitly confirmed project path. */
  registerProject(
    path: string,
    displayName?: string,
  ): Promise<{ readonly id: SupervisorProjectId; readonly displayName: string; readonly realPath: string; readonly status: string }>
}
