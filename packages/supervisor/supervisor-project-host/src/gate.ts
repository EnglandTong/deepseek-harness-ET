/** Per-project admission bookkeeping, independent from Session persistence. */

import type { SupervisorRunId } from '@deepseek-ai/dsh-supervisor'

/** Error raised when a second writer attempts to enter a project. */
export class SupervisorProjectWriteBusyError extends Error {
  /** @param projectId - project already owned by a writer. @param runId - owning run. */
  constructor(readonly projectId: string, readonly runId: SupervisorRunId) {
    super(`project '${projectId}' already has write run '${runId}'`)
    this.name = 'SupervisorProjectWriteBusyError'
  }
}

/** Serializes per-project writer admission while allowing concurrent reviewers. */
export class SupervisorProjectWriteGate {
  private readonly writers = new Map<string, SupervisorRunId>()

  /**
   * Admit one run, rejecting only a concurrent writer in the same project.
   * @param projectId - exact registered project identity.
   * @param runId - exact execution identity.
   * @param writeAccess - whether the run can mutate project files.
   */
  admit(projectId: string, runId: SupervisorRunId, writeAccess: boolean): void {
    if (!writeAccess) return
    const owner = this.writers.get(projectId)
    if (owner !== undefined) throw new SupervisorProjectWriteBusyError(projectId, owner)
    this.writers.set(projectId, runId)
  }

  /**
   * Release a writer only when the exact recorded owner finishes.
   * @param projectId - exact registered project identity.
   * @param runId - exact execution identity.
   * @param writeAccess - whether the run can mutate project files.
   */
  release(projectId: string, runId: SupervisorRunId, writeAccess: boolean): void {
    if (writeAccess && this.writers.get(projectId) === runId) this.writers.delete(projectId)
  }

  /**
   * Return the exact writer currently admitted for a project.
   * @param projectId - exact registered project identity.
   * @returns admitted writer, if any.
   */
  owner(projectId: string): SupervisorRunId | undefined { return this.writers.get(projectId) }
}
