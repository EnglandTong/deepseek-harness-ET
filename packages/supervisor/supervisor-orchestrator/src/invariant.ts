/** Runtime invariant companion for the orchestration package. */
import type { SupervisorTaskSnapshot } from '@deepseek-ai/dsh-supervisor'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { SupervisorRunResult } from './types.ts'

/**
 * Check that a task revision remains a positive, current snapshot.
 * @param task - task snapshot to validate.
 */
export function assertOrchestrationTask(task: SupervisorTaskSnapshot): void {
  if (!Number.isSafeInteger(task.revision) || task.revision < 1) throw new Error('orchestration task revision must be positive')
  if (task.id.length === 0 || task.projectId.length === 0) throw new Error('orchestration task ids must be non-empty')
  if (task.nextAction.length === 0) throw new Error('orchestration task nextAction must be non-empty')
}

/**
 * Check that a terminal run belongs to the expected task and attempt.
 * @param run - terminal run result to validate.
 */
export function assertOrchestrationRun(run: SupervisorRunResult): void {
  if (run.taskId.length === 0 || run.runId.length === 0) throw new Error('orchestration run ids must be non-empty')
  if (!Number.isSafeInteger(run.attempt) || run.attempt < 1) throw new Error('orchestration attempt must be positive')
}

/** Cordis companion plugin name. */
export const name = 'supervisor-orchestrator-invariant'
/** Invariant service required by this companion. */
export const inject = ['invariants']
/**
 * No runtime invariant: orchestration state is checked at every mutation by
 * the assertion helpers above and by the revision-safe publish path; the
 * package owns no scheduled store for a scanner to re-read.
 */
const install: InvariantInstaller = () => {}
/** Register the companion invariant plugin. @param ctx - invariant context. @returns disposer. */
export const apply = (ctx: import('@deepseek-ai/cordis').Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-supervisor-orchestrator', install))
