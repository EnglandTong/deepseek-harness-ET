/** Public host and admission records for project-bound Supervisor execution. */

import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  SupervisorProjectId,
  SupervisorRunId,
  SupervisorRunLink,
  SupervisorTaskId,
} from '@deepseek-ai/dsh-supervisor'

/** Stable metadata for one hidden project Session. */
export interface SupervisorProjectHostSnapshot {
  /** Registered project owning this host. */
  readonly projectId: SupervisorProjectId
  /** Hidden host Session identity. */
  readonly sessionId: SessionId
  /** Exact registered real path used as the host cwd. */
  readonly cwd: string
}

/** Admission request emitted before an executor starts a child. */
export interface SupervisorRunAdmissionRequest {
  /** Project containing the requested work. */
  readonly projectId: SupervisorProjectId
  /** Supervisor task represented by the run. */
  readonly taskId: SupervisorTaskId
  /** Globally unique run identity. */
  readonly runId: SupervisorRunId
  /** Child Session preallocated by the executor bridge. */
  readonly childSessionId: SessionId
  /** Registered executor name. */
  readonly executor: string
  /** Optional selected model label. */
  readonly model?: string
  /** True when the child can change files in the registered project. */
  readonly writeAccess: boolean
}

/** Exact child lifecycle owned by one accepted admission. */
export interface SupervisorChildLifecycle {
  /** Request cancellation of this exact child without affecting peer projects. */
  cancel(): void | Promise<void>
  /** Resolves only once this exact child has stopped. */
  readonly done: Promise<void>
}

/** Run lease held by an executor from admission through child settlement. */
export interface SupervisorRunLease {
  /** Durable projection link published when admission succeeds. */
  readonly link: SupervisorRunLink
  /** Attach the child after its creation succeeds; a lease accepts one child only. */
  attach(lifecycle: SupervisorChildLifecycle): void
  /** Cancel and await the attached child, then release its admission. */
  cancel(): Promise<void>
  /** Release a completed or failed child admission. Idempotent. */
  release(): Promise<void>
}

/** Recovery observation for a run link that was durable before restart. */
export interface SupervisorRunRecovery {
  /** Replayed run link needing an explicit live-child decision. */
  readonly link: SupervisorRunLink
  /** Whether another provider proved the child is still live. */
  readonly childIsLive: boolean
}
