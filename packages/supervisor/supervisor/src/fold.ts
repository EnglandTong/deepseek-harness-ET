/** Deterministic Supervisor event replay and task transition invariants. */

import type {
  SupervisorNotification,
  SupervisorPolicyApplied,
  SupervisorProjectSnapshot,
  SupervisorRunLink,
  SupervisorTaskSnapshot,
  SupervisorTaskStatus,
} from './types.ts'
import { assertSupervisorEvent } from './events.ts'
import type { SupervisorEvent } from './events.ts'

/** Current replay projection. */
export interface SupervisorProjection {
  readonly identity: import('./types.ts').SupervisorIdentitySnapshot | undefined
  readonly projects: ReadonlyMap<string, SupervisorProjectSnapshot>
  readonly tasks: ReadonlyMap<string, SupervisorTaskSnapshot>
  readonly runs: ReadonlyMap<string, SupervisorRunLink>
  readonly policies: ReadonlyMap<string, SupervisorPolicyApplied>
  readonly notifications: ReadonlyMap<string, SupervisorNotification>
}

/** Legal task transition table. Restored tasks may always escalate to
 * NeedsOwnerDecision: replay cannot resume execution, so process-exit
 * reconciliation hands every interrupted task to the owner. */
const TRANSITIONS: Readonly<Record<SupervisorTaskStatus, readonly SupervisorTaskStatus[]>> = {
  Captured: ['Classified', 'NeedsOwnerDecision'],
  Classified: ['AwaitingApproval', 'Ready', 'NeedsOwnerDecision'],
  AwaitingApproval: ['Ready', 'Cancelled'],
  Ready: ['Dispatched', 'NeedsOwnerDecision'],
  Dispatched: ['Running', 'Failed', 'NeedsOwnerDecision'],
  Running: ['NeedsOwnerDecision', 'NeedsFix', 'ReadyForReview', 'Failed', 'Cancelled'],
  NeedsOwnerDecision: ['Ready', 'Cancelled'],
  NeedsFix: ['Dispatched', 'Cancelled', 'NeedsOwnerDecision'],
  ReadyForReview: ['Accepted', 'NeedsFix'],
  Failed: ['Ready', 'Cancelled'],
  Cancelled: [],
  Accepted: [],
}

/** Assert one legal task transition.
 * @param from - current status.
 * @param to - requested status.
 * @returns void or throws.
 */
export function assertTaskTransition(from: SupervisorTaskStatus, to: SupervisorTaskStatus): void {
  if (!TRANSITIONS[from].includes(to)) throw new Error(`illegal Supervisor task transition ${from} -> ${to}`)
}

/** Fold a complete event sequence into a detached projection.
 * @param events - ordered events.
 * @returns replay projection.
 */
export function foldSupervisor(events: readonly SupervisorEvent[]): SupervisorProjection {
  let identity: SupervisorProjection['identity']
  const projects = new Map<string, SupervisorProjectSnapshot>()
  const tasks = new Map<string, SupervisorTaskSnapshot>()
  const runs = new Map<string, SupervisorRunLink>()
  const policies = new Map<string, SupervisorPolicyApplied>()
  const notifications = new Map<string, SupervisorNotification>()
  for (const event of events) {
    assertSupervisorEvent(event)
    switch (event.type) {
      case 'supervisor/identity':
        if (identity !== undefined) throw new Error('Supervisor identity event may be recorded only once')
        if (event.snapshot.revision !== 1) throw new Error('Supervisor identity first revision must be 1')
        identity = event.snapshot
        break
      case 'supervisor/project': foldRevision(projects, event.snapshot.id, event.snapshot); break
      case 'supervisor/task': {
        const previous = tasks.get(event.snapshot.id)
        if (previous !== undefined) assertTaskTransition(previous.status, event.snapshot.status)
        foldRevision(tasks, event.snapshot.id, event.snapshot)
        break
      }
      case 'supervisor/run-linked': foldRevision(runs, event.snapshot.runId, event.snapshot); break
      case 'supervisor/policy-applied': foldRevision(policies, event.snapshot.taskId, event.snapshot); break
      case 'supervisor/notification': foldRevision(notifications, event.snapshot.id, event.snapshot); break
      default: assertNever(event)
    }
  }
  return { identity, projects, tasks, runs, policies, notifications }
}

function foldRevision<T extends { readonly revision: number }>(map: Map<string, T>, key: string, next: T): void {
  const previous = map.get(key)
  if (previous !== undefined && next.revision !== previous.revision + 1) {
    throw new Error(`Supervisor revision for ${key} must increment from ${previous.revision} to ${previous.revision + 1}`)
  }
  if (previous === undefined && next.revision !== 1) throw new Error(`Supervisor first revision for ${key} must be 1`)
  map.set(key, next)
}

function assertNever(value: never): never { throw new Error(`unknown Supervisor event ${(value as { type?: unknown }).type as string}`) }
