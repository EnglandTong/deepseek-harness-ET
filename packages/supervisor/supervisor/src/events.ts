/** Versioned Supervisor event vocabulary and runtime validation. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  SupervisorIdentitySnapshot,
  SupervisorIdBinding,
  SupervisorNotification,
  SupervisorPolicyApplied,
  SupervisorProjectSnapshot,
  SupervisorRunLink,
  SupervisorTaskSnapshot,
} from './types.ts'

/** Version carried by every current Supervisor event payload. */
export const SUPERVISOR_EVENT_VERSION = 1 as const

/** Union used by the pure replay fold. */
export type SupervisorEvent =
  | { readonly type: 'supervisor/identity'; readonly version: typeof SUPERVISOR_EVENT_VERSION; readonly snapshot: SupervisorIdentitySnapshot }
  | { readonly type: 'supervisor/project'; readonly version: typeof SUPERVISOR_EVENT_VERSION; readonly snapshot: SupervisorProjectSnapshot }
  | { readonly type: 'supervisor/task'; readonly version: typeof SUPERVISOR_EVENT_VERSION; readonly snapshot: SupervisorTaskSnapshot }
  | { readonly type: 'supervisor/run-linked'; readonly version: typeof SUPERVISOR_EVENT_VERSION; readonly snapshot: SupervisorRunLink }
  | { readonly type: 'supervisor/id-binding'; readonly version: typeof SUPERVISOR_EVENT_VERSION; readonly snapshot: SupervisorIdBinding }
  | { readonly type: 'supervisor/policy-applied'; readonly version: typeof SUPERVISOR_EVENT_VERSION; readonly snapshot: SupervisorPolicyApplied }
  | { readonly type: 'supervisor/notification'; readonly version: typeof SUPERVISOR_EVENT_VERSION; readonly snapshot: SupervisorNotification }

/** Event envelope narrowed to one Cordis event name. */
export type SupervisorIdentityEvent = Extract<SupervisorEvent, { readonly type: 'supervisor/identity' }>
/** Event envelope narrowed to one Cordis event name. */
export type SupervisorProjectEvent = Extract<SupervisorEvent, { readonly type: 'supervisor/project' }>
/** Event envelope narrowed to one Cordis event name. */
export type SupervisorTaskEvent = Extract<SupervisorEvent, { readonly type: 'supervisor/task' }>
/** Event envelope narrowed to one Cordis event name. */
export type SupervisorRunLinkedEvent = Extract<SupervisorEvent, { readonly type: 'supervisor/run-linked' }>
/** Event envelope narrowed to one Cordis event name. */
export type SupervisorIdBindingEvent = Extract<SupervisorEvent, { readonly type: 'supervisor/id-binding' }>
/** Event envelope narrowed to one Cordis event name. */
export type SupervisorPolicyAppliedEvent = Extract<SupervisorEvent, { readonly type: 'supervisor/policy-applied' }>
/** Event envelope narrowed to one Cordis event name. */
export type SupervisorNotificationEvent = Extract<SupervisorEvent, { readonly type: 'supervisor/notification' }>

/** Validate model/storage-facing event data before replay.
 * @param event - event to validate.
 * @returns void or throws.
 */
export function assertSupervisorEvent(event: unknown): asserts event is SupervisorEvent {
  if (typeof event !== 'object' || event === null) throw new Error('Supervisor event must be an object')
  const value = event as Record<string, unknown>
  if (value.version !== SUPERVISOR_EVENT_VERSION) throw new Error(`unsupported Supervisor event version ${String(value.version)}`)
  const type = value.type
  const snapshot = value.snapshot
  if (typeof type !== 'string' || !['supervisor/identity', 'supervisor/project', 'supervisor/task', 'supervisor/run-linked', 'supervisor/id-binding', 'supervisor/policy-applied', 'supervisor/notification'].includes(type)) {
    throw new Error(`unknown Supervisor event type ${String(type)}`)
  }
  if (typeof snapshot !== 'object' || snapshot === null) throw new Error(`Supervisor event ${type} requires an object snapshot`)
  const data = snapshot as Record<string, unknown>
  if (!Number.isSafeInteger(data.revision) || (data.revision as number) < 1) throw new Error(`Supervisor event ${type} requires a positive revision`)
  const requireString = (field: string): void => { if (typeof data[field] !== 'string' || (data[field] as string).length === 0) throw new Error(`Supervisor event ${type} requires non-empty ${field}`) }
  const optionalString = (field: string): void => { if (data[field] !== undefined && typeof data[field] !== 'string') throw new Error(`Supervisor event ${type} optional ${field} must be a string`) }
  if (type === 'supervisor/identity') { requireString('id'); requireString('sessionId'); requireString('createdAt') }
  if (type === 'supervisor/project') { requireString('id'); requireString('displayName'); requireString('realPath'); requireString('registeredAt'); if (!['registered', 'unavailable', 'removed'].includes(String(data.status))) throw new Error('invalid Supervisor project status') }
  if (type === 'supervisor/task') { requireString('id'); requireString('projectId'); requireString('title'); if (typeof data.description !== 'string') throw new Error('Supervisor task description must be a string'); requireString('nextAction'); optionalString('blocker'); if (!['Captured', 'Classified', 'AwaitingApproval', 'Ready', 'Dispatched', 'Running', 'NeedsOwnerDecision', 'NeedsFix', 'ReadyForReview', 'Failed', 'Cancelled', 'Accepted'].includes(String(data.status))) throw new Error('invalid Supervisor task status') }
  if (type === 'supervisor/run-linked') { for (const field of ['runId', 'taskId', 'projectId', 'hostSessionId', 'childSessionId', 'executor']) requireString(field); if (typeof data.writeAccess !== 'boolean') throw new Error('Supervisor run link writeAccess must be boolean') }
  if (type === 'supervisor/id-binding') { for (const field of ['supervisorTaskId', 'governanceTaskId', 'childSessionId']) requireString(field); optionalString('runId') }
  if (type === 'supervisor/policy-applied') { requireString('taskId'); requireString('policyVersion'); requireString('executor'); requireString('reason'); optionalString('model'); if (typeof data.requiresApproval !== 'boolean') throw new Error('Supervisor policy requiresApproval must be boolean') }
  if (type === 'supervisor/notification') { requireString('id'); requireString('message'); requireString('createdAt'); optionalString('taskId'); optionalString('projectId'); if (typeof data.unread !== 'boolean') throw new Error('Supervisor notification unread must be boolean'); if (!['owner-decision', 'blocked', 'failed', 'ready-for-review', 'review-failed', 'policy-gate'].includes(String(data.kind))) throw new Error('invalid Supervisor notification kind') }
}

/** Recover one Supervisor event from a controller Session event for ledger replay.
 * @param event - Session event, which may carry ordinary conversation instead.
 * @returns the versioned Supervisor event, or undefined when the Session event is not controller state.
 */
export function supervisorEventFromSessionEvent(event: SessionEvent): SupervisorEvent | undefined {
  const type: string = event.type
  if (!isSupervisorEventType(type)) return undefined
  const data: unknown = event.data
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error(`Supervisor session event ${type} requires an object payload`)
  const recovered: unknown = { type, ...(data as Record<string, unknown>) }
  assertSupervisorEvent(recovered)
  return recovered
}

function isSupervisorEventType(value: string): value is SupervisorEvent['type'] {
  return value === 'supervisor/identity' || value === 'supervisor/project' || value === 'supervisor/task'
    || value === 'supervisor/run-linked' || value === 'supervisor/id-binding'
    || value === 'supervisor/policy-applied' || value === 'supervisor/notification'
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Emitted when the singleton controller identity is created or restored.
     * @mode emit
     * @param event - versioned controller identity event.
     */
    'supervisor/identity'(event: SupervisorIdentityEvent): void
    /** Emitted when a registered project snapshot changes.
     * @mode emit
     * @param event - versioned project event.
     */
    'supervisor/project'(event: SupervisorProjectEvent): void
    /** Emitted when a supervised task snapshot changes.
     * @mode emit
     * @param event - versioned task event.
     */
    'supervisor/task'(event: SupervisorTaskEvent): void
    /** Emitted when a task is linked to its host and child execution sessions.
     * @mode emit
     * @param event - versioned task execution association.
     */
    'supervisor/run-linked'(event: SupervisorRunLinkedEvent): void
    /** Emitted when a supervisor ↔ governance ↔ child id chain is recorded.
     * @mode emit
     * @param event - versioned cross-plugin id binding.
     */
    'supervisor/id-binding'(event: SupervisorIdBindingEvent): void
    /** Emitted when a routing policy decision is recorded for a task.
     * @mode emit
     * @param event - versioned applied routing policy evidence.
     */
    'supervisor/policy-applied'(event: SupervisorPolicyAppliedEvent): void
    /** Emitted when a user-facing Supervisor notification is created or updated.
     * @mode emit
     * @param event - versioned user-facing notification.
     */
    'supervisor/notification'(event: SupervisorNotificationEvent): void
  }
}
