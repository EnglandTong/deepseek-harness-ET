/** Session log extension used to persist the controller identity. */

import type {
  SupervisorIdentityEvent,
  SupervisorIdBindingEvent,
  SupervisorNotificationEvent,
  SupervisorPolicyAppliedEvent,
  SupervisorProjectEvent,
  SupervisorRunLinkedEvent,
  SupervisorTaskEvent,
} from '@deepseek-ai/dsh-supervisor'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** One immutable identity envelope written by the singleton provider. */
    'supervisor/identity': Omit<SupervisorIdentityEvent, 'type'>
    /** Versioned project snapshot emitted by the project registry. */
    'supervisor/project': Omit<SupervisorProjectEvent, 'type'>
    /** Versioned task snapshot emitted by the orchestrator. */
    'supervisor/task': Omit<SupervisorTaskEvent, 'type'>
    /** Task/run/child-session association emitted by the project host. */
    'supervisor/run-linked': Omit<SupervisorRunLinkedEvent, 'type'>
    /** Cross-plugin id chain emitted by the governance executor bridge. */
    'supervisor/id-binding': Omit<SupervisorIdBindingEvent, 'type'>
    /** Applied routing policy evidence emitted by the orchestrator. */
    'supervisor/policy-applied': Omit<SupervisorPolicyAppliedEvent, 'type'>
    /** User-facing notification emitted by the orchestrator. */
    'supervisor/notification': Omit<SupervisorNotificationEvent, 'type'>
  }
}

/** Payload stored for the singleton Supervisor identity event. */
export type SupervisorIdentityData = Omit<SupervisorIdentityEvent, 'type'>
