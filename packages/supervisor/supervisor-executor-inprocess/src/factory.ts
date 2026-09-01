/** In-process executor adapter: routed work becomes a driver-run child in the project workspace. */

import { randomUUID } from 'node:crypto'
import { SessionId } from '@deepseek-ai/dsh-session'
import { snapshotSubagentDescriptor, type SubagentResult } from '@deepseek-ai/dsh-subagent'
import type {
  PreparedSupervisorExecution,
  RawExecutionResult,
  SupervisorChildExecution,
  SupervisorExecutionRequest,
  SupervisorExecutorProvider,
} from '@deepseek-ai/dsh-supervisor-executor-subagent'
import type { InProcessSpawnExecutorConfig, InProcessSpawnExecutorDeps } from './types.ts'

export type { InProcessSpawnExecutorConfig, InProcessSpawnExecutorDeps } from './types.ts'

/** Map a subagent seam terminal outcome onto the executor bridge's raw result. */
function toRawResult(outcome: SubagentResult): RawExecutionResult {
  return {
    stopReason: outcome.stopReason,
    output: outcome.output,
    ...(outcome.diagnostic === undefined ? {} : { diagnostic: outcome.diagnostic }),
  }
}

/**
 * Create the in-process model executor adapter. `prepare()` reserves the child
 * identity only, so the executor bridge admits the host lease before any model
 * work; `start()` runs the shared driver with the reserved id and the routed
 * project's workspace. The routed provider/model become the child's agent
 * route; cancellation, timeout, and disposal ordering stay owned by the bridge.
 * @param deps - project workspace resolution and the child driver.
 * @param config - validated adapter identity, provider allowlist, and ceiling.
 * @returns a provider ready for `supervisorExecutors.register()`.
 */
export function createInProcessSpawnExecutor(
  deps: InProcessSpawnExecutorDeps,
  config: InProcessSpawnExecutorConfig,
): SupervisorExecutorProvider {
  const name = config.providerName.trim()
  if (name.length === 0) throw new Error('In-process supervisor executor name must not be empty')
  return {
    name,
    capabilities: {
      permissions: config.permissions,
      background: true,
      cancellation: true,
      providers: config.providers,
    },
    prepare(request: SupervisorExecutionRequest): Promise<PreparedSupervisorExecution> {
      const workspace = deps.projectWorkspace(request.projectId)
      if (workspace === undefined) {
        return Promise.reject(new Error(`in-process executor has no registered project '${String(request.projectId)}'`))
      }
      const childSessionId = SessionId(randomUUID())
      const descriptor = snapshotSubagentDescriptor({
        mode: 'one-shot',
        provider: name,
        label: `supervisor:${String(request.taskId)}`,
      })
      return Promise.resolve({
        childSessionId,
        async start(): Promise<SupervisorChildExecution> {
          const route = request.route.decision
          const run = await deps.startRun({
            prompt: [...request.prompt],
            parent: request.parent,
            signal: request.signal,
            descriptor,
            agentOptions: {
              provider: route.provider,
              ...(route.model === undefined ? {} : { model: route.model }),
            },
          }, { reservedChildId: childSessionId, cwd: workspace })
          return {
            childSessionId,
            result: run.result.then(toRawResult),
            dispose: () => run.dispose(),
          }
        },
      })
    },
  }
}
