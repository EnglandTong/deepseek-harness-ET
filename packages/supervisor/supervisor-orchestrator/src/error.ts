/** Stable errors raised by the Supervisor orchestration control loop. */
export class SupervisorOrchestratorError extends Error {
  /** @param code - machine-readable classification. @param message - safe diagnostic. */
  constructor(readonly code: SupervisorOrchestratorErrorCode, message: string) {
    super(message)
    this.name = 'SupervisorOrchestratorError'
  }
}

/** Orchestration rejection categories. */
export type SupervisorOrchestratorErrorCode =
  | 'PROJECT_UNAVAILABLE'
  | 'ROUTER_UNAVAILABLE'
  | 'TASK_NOT_FOUND'
  | 'TASK_NOT_RESUMABLE'
  | 'STALE_REVISION'
  | 'INVALID_STATUS'
  | 'APPROVAL_REQUIRED'
  | 'DISPATCH_FAILED'
  | 'ORCHESTRATOR_STOPPING'
