/**
 * Browser-safe Personal Supervisor API contract. The Host is the authority
 * for these snapshots; the client stores only the latest revision it has
 * received and never infers task state from titles or child transcripts.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Singleton Supervisor identity exposed to the client. */
export interface SupervisorIdentityView {
  /** Stable controller identifier. */
  id: string
  /** Session carrying the controller conversation. */
  sessionId: string
  /** Monotonic identity revision. */
  revision: number
  /** ISO-8601 creation timestamp. */
  createdAt: string
}

/** Registered project snapshot. */
export interface SupervisorProjectView {
  id: string
  revision: number
  displayName: string
  /** Real absolute path is returned only to the trusted local client. */
  realPath: string
  status: 'registered' | 'unavailable' | 'removed'
  registeredAt: string
}

/** Current task snapshot. */
export interface SupervisorTaskView {
  id: string
  revision: number
  projectId: string
  title: string
  description: string
  status: string
  nextAction: string
  blocker?: string
}

/** Task execution association. */
export interface SupervisorRunView {
  revision: number
  runId: string
  taskId: string
  projectId: string
  hostSessionId: string
  childSessionId: string
  executor: string
  model?: string
  writeAccess: boolean
}

/** Critical notification shown in the main Supervisor view. */
export interface SupervisorNotificationView {
  revision: number
  id: string
  taskId?: string
  projectId?: string
  kind: 'owner-decision' | 'blocked' | 'failed' | 'ready-for-review' | 'review-failed' | 'policy-gate'
  message: string
  unread: boolean
  createdAt: string
}

/** Read-only child session reference; transcript access remains a separate read API. */
export interface SupervisorChildSessionView {
  taskId: string
  runId: string
  sessionId: string
  parentSessionId: string
  readOnly: true
}

/** Supported user actions. Every action is compare-and-set against a task revision. */
export type SupervisorActionKind = 'approve' | 'reject' | 'rework' | 'pause' | 'continue'

/** A user-authorized task action. */
export interface SupervisorActionRequest {
  taskId: string
  action: SupervisorActionKind
  expectedRevision: number
  feedback?: string
}

/** Action acknowledgement carrying the new task revision. */
export interface SupervisorActionReceipt {
  taskId: string
  revision: number
  accepted: true
}

/** Supervisor API methods exposed through the existing `/api` carrier. */
export interface SupervisorApi {
  /** Get the singleton identity. */
  identity(request: RpcRequest<Record<never, never>>): Promise<RpcResponse<SupervisorIdentityView>>
  /** List registered projects, optionally filtered by lifecycle status. */
  projects(request: RpcRequest<{ status?: SupervisorProjectView['status'] }>): Promise<RpcResponse<{ projects: SupervisorProjectView[] }>>
  /** List current tasks, optionally filtered by project or status. */
  tasks(request: RpcRequest<{ projectId?: string; statuses?: string[] }>): Promise<RpcResponse<{ tasks: SupervisorTaskView[] }>>
  /** List task execution associations, optionally filtered by task. */
  runs(request: RpcRequest<{ taskId?: string }>): Promise<RpcResponse<{ runs: SupervisorRunView[] }>>
  /** List critical notifications, optionally restricted to unread entries. */
  notifications(request: RpcRequest<{ unreadOnly?: boolean; afterRevision?: number }>): Promise<
    RpcResponse<{ notifications: SupervisorNotificationView[] }>
  >
  /** Resolve the current run's child session as a read-only reference. */
  childSession(request: RpcRequest<{ taskId: string; runId?: string }>): Promise<RpcResponse<SupervisorChildSessionView>>
  /** Apply one user action under task revision compare-and-set. */
  action(request: RpcRequest<SupervisorActionRequest>): Promise<RpcResponse<SupervisorActionReceipt>>
}
