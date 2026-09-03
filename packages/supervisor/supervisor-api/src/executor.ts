/** Types-only re-export of the Supervisor executor provider seam.
 *
 * Foreign plugins (for example the governance bridge) implement
 * {@link SupervisorExecutorProvider} by importing from this module without
 * taking a runtime dependency on the executor registry service. Values still
 * resolve through `@deepseek-ai/dsh-supervisor-executor-subagent` at compile
 * time; this package adds no runtime symbols here.
 */

export type {
  ExecutorCapabilities,
  PreparedSupervisorExecution,
  RawExecutionResult,
  SupervisorChildExecution,
  SupervisorExecutionHandle,
  SupervisorExecutionRequest,
  SupervisorExecutionResult,
  SupervisorExecutionStatus,
  SupervisorExecutorProvider,
} from '@deepseek-ai/dsh-supervisor-executor-subagent'
