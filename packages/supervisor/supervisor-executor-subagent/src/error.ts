/** Typed failures raised before a child execution is published. */
export class SupervisorExecutorError extends Error {
  /** @param code - stable classification. @param message - safe diagnostic. */
  constructor(readonly code: SupervisorExecutorErrorCode, message: string) {
    super(message)
    this.name = 'SupervisorExecutorError'
  }
}

/** Pre-dispatch failure classifications. */
export type SupervisorExecutorErrorCode =
  | 'NO_EXECUTOR'
  | 'ROUTE_NOT_DISPATCHABLE'
  | 'PROVIDER_UNSUPPORTED'
  | 'PERMISSION_EXCEEDED'
  | 'BACKGROUND_UNSUPPORTED'
  | 'CANCELLATION_UNSUPPORTED'
  | 'CHILD_ID_MISMATCH'
