/** Stable failures raised while loading or updating a routing policy. */
export class RoutingPolicyError extends Error {
  /** @param message - actionable validation or update diagnosis. */
  constructor(message: string) {
    super(message)
    this.name = 'RoutingPolicyError'
  }
}
