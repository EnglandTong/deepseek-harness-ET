/** Wire-safe, read-only views exposed to Supervisor clients. */
import type { SupervisorProjectSnapshot, SupervisorTaskSnapshot, SupervisorNotification, SupervisorRunLink } from '@deepseek-ai/dsh-supervisor'

/** A task view with linked execution evidence. */
export interface SupervisorApiTask extends SupervisorTaskSnapshot {
  readonly runs: readonly SupervisorRunLink[]
}

/** Host response for dashboard reads. */
export interface SupervisorStatusResponse {
  readonly identity: string
  readonly supervisorSessionId?: string
  readonly projects: readonly SupervisorProjectSnapshot[]
  readonly tasks: readonly SupervisorApiTask[]
  readonly notifications: readonly SupervisorNotification[]
}

/** Optimistic-concurrency failure returned for stale mutations. */
export class SupervisorApiRevisionConflictError extends Error {
  /** Stable error code for stale revision responses. */
  readonly code = 'SUPERVISOR_REVISION_CONFLICT'
  /** @param resource - resource name. @param expected - revision supplied by client. @param actual - authoritative revision. */
  constructor(readonly resource: string, readonly expected: number, readonly actual: number) {
    super(`${resource} revision ${String(actual)} does not match expected ${String(expected)}`)
    this.name = 'SupervisorApiRevisionConflictError'
  }
}

/** Read-only host contract consumed by browser clients. */
export interface SupervisorApiContract {
  /** @returns current dashboard projection. */
  status(): SupervisorStatusResponse
  /** @param taskId - exact task id. @returns linked task or undefined. */
  task(taskId: string): SupervisorApiTask | undefined
  /** @param taskId - task id. @param revision - client revision. @param outcome - owner review result. @returns updated task. */
  review(taskId: string, revision: number, outcome: 'accepted' | 'needs-fix'): Promise<SupervisorTaskSnapshot>
}
