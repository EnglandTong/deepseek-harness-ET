/** Runtime checks for memory checkpoints and prompt-facing summaries. */

import type { SupervisorMemoryCheckpoint, SupervisorMemoryProjection, SupervisorRollingSummary } from './types.ts'

/** Checkpoint value as read from persistence, before the format version is validated. */
type PersistedSupervisorMemoryCheckpoint = Omit<SupervisorMemoryCheckpoint, 'version'> & { readonly version: unknown }

/** Assert that a memory projection contains only bounded, internally linked data.
 * @param projection - projection to validate.
 * @returns void or throws.
 */
export function assertSupervisorMemoryProjection(projection: SupervisorMemoryProjection): void {
  if (!Number.isSafeInteger(projection.sourceSeq) || projection.sourceSeq < 0) throw new Error('Supervisor memory sourceSeq must be a non-negative safe integer')
  for (const [id, state] of projection.governance) {
    if (state.workspacePath.length === 0) throw new Error(`Supervisor governance ${id} has an empty workspace path`)
    if (state.status.length === 0) throw new Error(`Supervisor governance ${id} has no status`)
  }
}

/** Assert one summary has provenance and a single next-step vocabulary.
 * @param summary - summary to validate.
 * @returns void or throws.
 */
export function assertSupervisorRollingSummary(summary: SupervisorRollingSummary): void {
  if (String(summary.projectId).length === 0) throw new Error('Supervisor summary requires a project id')
  if (!Number.isSafeInteger(summary.projectRevision) || summary.projectRevision < 1) throw new Error('Supervisor summary requires a positive project revision')
  if (summary.sourceRange.start < 1 || summary.sourceRange.end < summary.sourceRange.start) throw new Error('Supervisor summary source range is invalid')
  for (const id of summary.taskIds) if (String(id).length === 0) throw new Error('Supervisor summary contains an empty task id')
  for (const step of summary.uniqueNextSteps) if (step.length === 0) throw new Error('Supervisor summary contains an empty next step')
  for (const reference of summary.evidence) if (reference.value.length === 0) throw new Error('Supervisor summary contains an empty evidence reference')
}

/** Assert a checkpoint can be safely considered during restart recovery.
 * @param checkpoint - persisted checkpoint to validate.
 * @returns void or throws.
 */
export function assertSupervisorMemoryCheckpoint(checkpoint: PersistedSupervisorMemoryCheckpoint): void {
  if (checkpoint.version !== 1) {
    const version = (typeof checkpoint.version === 'number' || typeof checkpoint.version === 'string') ? checkpoint.version : 'unknown'
    throw new Error(`unsupported Supervisor memory checkpoint version ${version}`)
  }
  if (!Number.isSafeInteger(checkpoint.sourceSeq) || checkpoint.sourceSeq < 0) throw new Error('Supervisor memory checkpoint sourceSeq must be non-negative')
  if (!/^[a-f0-9]{64}$/.test(checkpoint.sourceDigest)) throw new Error('Supervisor memory checkpoint sourceDigest must be a sha256 hex digest')
  const seen = new Set<string>()
  for (const summary of checkpoint.summaries) {
    assertSupervisorRollingSummary(summary)
    const id = String(summary.projectId)
    if (seen.has(id)) throw new Error(`Supervisor memory checkpoint duplicates project ${id}`)
    seen.add(id)
  }
}
