/** Runtime invariants for Supervisor projections. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { SupervisorProjection } from './fold.ts'

/** Assert that a replay projection has unique, positive revisions and no duplicate map keys.
 * @param projection - projection to check.
 * @returns void or throws.
 */
export function assertSupervisorProjection(projection: SupervisorProjection): void {
  if (projection.identity !== undefined) { assertRevision('identity', projection.identity.revision); if (String(projection.identity.id).length === 0 || String(projection.identity.sessionId).length === 0) throw new Error('Supervisor identity must contain non-empty ids') }
  for (const [key, value] of projection.projects) { assertRevision(key, value.revision); if (String(value.id) !== key) throw new Error(`Supervisor project map key ${key} does not match snapshot id`); if (!['registered', 'unavailable', 'removed'].includes(value.status)) throw new Error(`Supervisor project ${key} has an invalid status`) }
  for (const [key, value] of projection.tasks) {
    assertRevision(key, value.revision)
    if (String(value.id) !== key) throw new Error(`Supervisor task map key ${key} does not match snapshot id`)
    if (!['Captured', 'Classified', 'AwaitingApproval', 'Ready', 'Dispatched', 'Running', 'NeedsOwnerDecision', 'NeedsFix', 'ReadyForReview', 'Failed', 'Cancelled', 'Accepted'].includes(value.status)) throw new Error(`Supervisor task ${key} has an invalid status`)
    if (typeof value.blocker !== 'undefined' && typeof value.blocker !== 'string') throw new Error(`Supervisor task ${key} blocker must be a string`)
    if (!projection.projects.has(value.projectId)) throw new Error(`Supervisor task ${key} references unknown project ${String(value.projectId)}`)
  }
  for (const [key, value] of projection.runs) {
    assertRevision(key, value.revision)
    if (String(value.runId) !== key) throw new Error(`Supervisor run map key ${key} does not match snapshot id`)
    const task = projection.tasks.get(value.taskId)
    if (task === undefined || task.projectId !== value.projectId) throw new Error(`Supervisor run ${key} references an inconsistent task/project`)
    if (String(value.hostSessionId).length === 0 || String(value.childSessionId).length === 0 || value.executor.trim().length === 0) throw new Error(`Supervisor run ${key} has incomplete link fields`)
  }
  for (const [key, value] of projection.policies) { assertRevision(key, value.revision); if (!projection.tasks.has(value.taskId)) throw new Error(`Supervisor policy ${key} references an unknown task`); if (typeof value.model !== 'undefined' && typeof value.model !== 'string') throw new Error(`Supervisor policy ${key} model must be a string`) }
  for (const [key, value] of projection.notifications) {
    assertRevision(key, value.revision)
    if (String(value.id) !== key) throw new Error(`Supervisor notification map key ${key} does not match snapshot id`)
    if (!['owner-decision', 'blocked', 'failed', 'ready-for-review', 'review-failed', 'policy-gate'].includes(value.kind)) throw new Error(`Supervisor notification ${key} has an invalid kind`)
    if (typeof value.taskId !== 'undefined' && typeof value.taskId !== 'string') throw new Error(`Supervisor notification ${key} taskId must be a string`)
    if (typeof value.projectId !== 'undefined' && typeof value.projectId !== 'string') throw new Error(`Supervisor notification ${key} projectId must be a string`)
    if (value.taskId !== undefined && !projection.tasks.has(value.taskId)) throw new Error(`Supervisor notification ${key} references an unknown task`)
    if (value.projectId !== undefined && !projection.projects.has(value.projectId)) throw new Error(`Supervisor notification ${key} references an unknown project`)
  }
}

function assertRevision(key: string, revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error(`Supervisor ${key} has an invalid revision`)
}

/** Cordis companion plugin name. */
export const name = 'supervisor-invariant'
/** Invariant service required to install the companion. */
export const inject = ['invariants']

/**
 * No runtime invariant: the projection checks above run exactly at the fold
 * and snapshot-apply boundaries where the data is assembled, and the public
 * service owns no scheduled background state for a scanner to re-read.
 */
const install: InvariantInstaller = () => {}

/** Register the package invariant companion. @param ctx - invariant context. @returns disposer. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-supervisor', install))
