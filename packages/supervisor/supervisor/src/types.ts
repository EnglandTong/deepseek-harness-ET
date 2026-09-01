/** Public Personal Supervisor identifiers, snapshots, and event payload values. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Opaque identity of the singleton controller Session. */
export type SupervisorId = Branded<'SupervisorId'>
/** Brand a validated controller identity.
 * @param id - raw identity.
 * @returns branded identity.
 */
export const SupervisorId = (id: string): SupervisorId => id as SupervisorId

/** Opaque identity of a registered project. */
export type SupervisorProjectId = Branded<'SupervisorProjectId'>
/** Brand a project identity.
 * @param id - raw identity.
 * @returns branded identity.
 */
export const SupervisorProjectId = (id: string): SupervisorProjectId => id as SupervisorProjectId

/** Opaque identity of a cross-project task. */
export type SupervisorTaskId = Branded<'SupervisorTaskId'>
/** Brand a task identity.
 * @param id - raw identity.
 * @returns branded identity.
 */
export const SupervisorTaskId = (id: string): SupervisorTaskId => id as SupervisorTaskId

/** Opaque identity of one dispatched execution. */
export type SupervisorRunId = Branded<'SupervisorRunId'>
/** Brand a run identity.
 * @param id - raw identity.
 * @returns branded identity.
 */
export const SupervisorRunId = (id: string): SupervisorRunId => id as SupervisorRunId

/** Opaque identity of one user-facing notification. */
export type SupervisorNotificationId = Branded<'SupervisorNotificationId'>
/** Brand a notification identity.
 * @param id - raw identity.
 * @returns branded identity.
 */
export const SupervisorNotificationId = (id: string): SupervisorNotificationId => id as SupervisorNotificationId

/** Durable task lifecycle. */
export type SupervisorTaskStatus =
  | 'Captured' | 'Classified' | 'AwaitingApproval' | 'Ready' | 'Dispatched' | 'Running'
  | 'NeedsOwnerDecision' | 'NeedsFix' | 'ReadyForReview' | 'Failed' | 'Cancelled' | 'Accepted'

/** Registered project lifecycle. */
export type SupervisorProjectStatus = 'registered' | 'unavailable' | 'removed'

/** Complete project state written on each project revision. */
export interface SupervisorProjectSnapshot {
  readonly id: SupervisorProjectId
  readonly revision: number
  readonly displayName: string
  readonly realPath: string
  readonly status: SupervisorProjectStatus
  readonly registeredAt: string
}

/** Complete task state written on each task revision. */
export interface SupervisorTaskSnapshot {
  readonly id: SupervisorTaskId
  readonly revision: number
  readonly projectId: SupervisorProjectId
  readonly title: string
  readonly description: string
  readonly status: SupervisorTaskStatus
  readonly nextAction: string
  readonly blocker?: string
}

/** Association between one task, project host, and child execution Session. */
export interface SupervisorRunLink {
  readonly revision: number
  readonly runId: SupervisorRunId
  readonly taskId: SupervisorTaskId
  readonly projectId: SupervisorProjectId
  readonly hostSessionId: SessionId
  readonly childSessionId: SessionId
  readonly executor: string
  readonly model?: string
  readonly writeAccess: boolean
}

/** User-facing critical notification. */
export interface SupervisorNotification {
  readonly revision: number
  readonly id: SupervisorNotificationId
  readonly taskId?: SupervisorTaskId
  readonly projectId?: SupervisorProjectId
  readonly kind: 'owner-decision' | 'blocked' | 'failed' | 'ready-for-review' | 'review-failed' | 'policy-gate'
  readonly message: string
  readonly unread: boolean
  readonly createdAt: string
}

/** Applied routing policy evidence. */
export interface SupervisorPolicyApplied {
  readonly revision: number
  readonly taskId: SupervisorTaskId
  readonly policyVersion: string
  readonly executor: string
  readonly model?: string
  readonly requiresApproval: boolean
  readonly reason: string
}

/** Explainable result returned by a routing provider before dispatch. */
export interface RouteDecision {
  readonly taskId: SupervisorTaskId
  readonly policyVersion: string
  readonly executor: string
  readonly provider: string
  readonly model?: string
  readonly fallback: readonly string[]
  readonly reason: string
  readonly costTier: 'free' | 'low' | 'medium' | 'high' | 'unknown'
  readonly requiresApproval: boolean
}

/** Controller identity snapshot. */
export interface SupervisorIdentitySnapshot {
  readonly revision: number
  readonly id: SupervisorId
  readonly sessionId: SessionId
  readonly createdAt: string
}

/** Deployment configuration for the public service definition. */
export interface SupervisorConfig {
  /** Optional durable identity supplied by the singleton-session provider. */
  readonly id?: string
}
