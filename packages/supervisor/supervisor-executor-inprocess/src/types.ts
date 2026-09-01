/** In-process executor adapter contracts: plugin config and injected dependencies. */

import type { SupervisorProjectId } from '@deepseek-ai/dsh-supervisor'
import type { ResolvedSubagentStartRequest, SubagentRun } from '@deepseek-ai/dsh-subagent'
import type { InProcessRunOptions } from '@deepseek-ai/dsh-subagent-in-process-driver'
import type { PermissionCeiling } from '@deepseek-ai/dsh-supervisor-routing-policy'

/** Validated plugin configuration; every field is deployment-varying. */
export interface InProcessSpawnExecutorConfig {
  /** Executor registry name the routing policy selects. */
  readonly providerName: string
  /** Route provider allowlist. Empty keeps the adapter dormant (safe default). */
  readonly providers: string[]
  /** Permission ceiling the adapter reports to the executor bridge. */
  readonly permissions: PermissionCeiling[]
}

/** Injected collaboration points, replaceable for tests. */
export interface InProcessSpawnExecutorDeps {
  /** Resolve one registered project's real workspace path. */
  projectWorkspace(projectId: SupervisorProjectId): string | undefined
  /** Drive one in-process one-shot child. Defaults to the shared driver. */
  startRun(request: ResolvedSubagentStartRequest, options: InProcessRunOptions): Promise<SubagentRun>
}
