import type { SupervisorExecutionResult, RawExecutionResult } from './types.ts'

/**
 * Normalize provider terminal vocabulary without hiding independent process facts.
 * @param result - provider result.
 * @returns stable orchestration result.
 */
export function normalizeExecutionResult(result: RawExecutionResult): SupervisorExecutionResult {
  const timedOut = result.timedOut === true
  const status = timedOut
    ? 'timeout'
    : result.stopReason === 'completed'
      ? 'completed'
      : result.stopReason === 'aborted'
        ? 'cancelled'
        : result.stopReason === 'max-tokens'
          ? 'max-tokens'
          : 'failed'
  return {
    status,
    output: result.output === undefined ? [] : [...result.output],
    ...(result.diagnostic === undefined ? {} : { diagnostic: result.diagnostic }),
    timedOut,
    ...(result.signal === undefined ? {} : { signal: result.signal }),
    ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
  }
}
