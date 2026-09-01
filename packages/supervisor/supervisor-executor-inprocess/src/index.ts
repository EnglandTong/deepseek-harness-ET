/** Personal Supervisor in-process model executor: cordis plugin registration. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { startInProcessRun } from '@deepseek-ai/dsh-subagent-in-process-driver'
import { createInProcessSpawnExecutor } from './factory.ts'
import type { InProcessSpawnExecutorConfig } from './types.ts'

export { createInProcessSpawnExecutor } from './factory.ts'
export type { InProcessSpawnExecutorConfig, InProcessSpawnExecutorDeps } from './types.ts'

/** Cordis plugin name. */
export const name = 'supervisor-executor-inprocess'
/** Executor bridge and project registry dependencies. */
export const inject = ['supervisorExecutors', 'supervisor']

/** Config: identity, route provider allowlist, and permission ceiling. */
export const Config: z<InProcessSpawnExecutorConfig> = z.object({
  providerName: z.string().default('supervisor-spawn'),
  providers: z.array(z.string()).default([]),
  permissions: z.array(z.union(['none', 'read', 'write', 'execute', 'admin'] as const)).default(['none', 'read']),
})

/** Register the adapter on the executor bridge. @param ctx - cordis context. @param config - validated config. */
export function apply(ctx: Context, config: InProcessSpawnExecutorConfig): void {
  ctx.supervisorExecutors.register(createInProcessSpawnExecutor({
    projectWorkspace: projectId => ctx.supervisor.getProject(projectId)?.realPath,
    startRun: startInProcessRun,
  }, config))
}
