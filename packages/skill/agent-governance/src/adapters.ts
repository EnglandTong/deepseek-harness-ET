import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentRun } from '@deepseek-ai/dsh-subagent'
import type {
  GovernancePermissionMode,
  HarnessAdapter,
  HarnessDescriptor,
  HarnessExecutionRequest,
  HarnessExecutionResult,
  HarnessId,
  PreparedHarnessRequest,
} from './types.ts'

const PROVIDERS: Record<HarnessId, string> = {
  codex: 'codex',
  'claude-code': 'claude-code',
  'deepseek-harness': 'dsh-sdk',
}

const BASE_DESCRIPTORS: Record<HarnessId, Omit<HarnessDescriptor, 'available' | 'diagnostic' | 'diagnosticCode' | 'lastCheckedAt'>> = {
  codex: {
    id: 'codex', provider: PROVIDERS.codex, capabilities: ['code-editing', 'tests'], strengths: ['focused code changes'], permission: 'workspace-write', riskLevel: 'medium', supportsSubagent: true, supportsNativeSession: false, supportsStreaming: false, supportsCancellation: true, supportsFiles: true, supportsImages: false, supportsContinuable: false,
  },
  'claude-code': {
    id: 'claude-code', provider: PROVIDERS['claude-code'], capabilities: ['analysis', 'refactoring', 'review'], strengths: ['broad codebase reasoning'], permission: 'workspace-write', riskLevel: 'medium', supportsSubagent: true, supportsNativeSession: false, supportsStreaming: false, supportsCancellation: true, supportsFiles: true, supportsImages: false, supportsContinuable: false,
  },
  'deepseek-harness': {
    id: 'deepseek-harness', provider: PROVIDERS['deepseek-harness'], capabilities: ['planning', 'governance', 'delegation'], strengths: ['task decomposition and coordination'], permission: 'workspace-write', riskLevel: 'high', supportsSubagent: true, supportsNativeSession: true, supportsStreaming: false, supportsCancellation: true, supportsFiles: true, supportsImages: true, supportsContinuable: false,
  },
}

/** Adapter that delegates to an existing DSH Subagent Provider. */
export class SubagentHarnessAdapter implements HarnessAdapter {
  private readonly runs = new Map<string, SubagentRun>()

  constructor(
    private readonly ctx: Context,
    readonly id: HarnessId,
  ) {}

  get provider(): string { return PROVIDERS[this.id] }

  describe(): HarnessDescriptor {
    return { ...BASE_DESCRIPTORS[this.id], available: this.ctx.subagents.getProvider(this.provider) !== undefined }
  }

  checkAvailability(workspace?: string): HarnessDescriptor {
    const timestamp = new Date().toISOString()
    if (workspace !== undefined && workspace.trim() === '') return { ...this.describe(), available: false, diagnosticCode: 'workspace-invalid', diagnostic: 'workspace must not be empty', lastCheckedAt: timestamp }
    if (this.ctx.subagents.getProvider(this.provider) === undefined) return { ...this.describe(), available: false, diagnosticCode: 'provider-not-loaded', diagnostic: `provider ${this.provider} is not loaded`, lastCheckedAt: timestamp }
    return { ...this.describe(), available: true, lastCheckedAt: timestamp }
  }

  prepare(request: HarnessExecutionRequest): PreparedHarnessRequest {
    if (request.nestedDepth > request.maxNestedDepth) throw new Error(`governance nested depth ${request.nestedDepth} exceeds maximum ${request.maxNestedDepth}`)
    if (request.workspace.trim() === '') throw new Error('governance delegation requires a workspace')
    if (request.permission === 'full-access' && this.id !== 'deepseek-harness') throw new Error(`${this.id} does not accept full-access governance tasks`)
    if (this.ctx.subagents.getProvider(this.provider) === undefined) throw new Error(`provider ${this.provider} is not loaded`)
    return { harness: this.id, provider: this.provider, request }
  }

  async execute(prepared: PreparedHarnessRequest): Promise<HarnessExecutionResult> {
    const { request } = prepared
    const run = await this.ctx.subagents.start(this.provider, {
      prompt: request.prompt as ContentBlock[],
      parent: request.parent,
      signal: request.signal,
    })
    this.runs.set(request.taskId, run)
    try {
      const result = await run.result
      const summary = result.output.filter(block => block.type === 'text').map(block => block.text).join('')
      return { status: result.stopReason === 'completed' ? 'completed' : request.signal.aborted ? 'cancelled' : 'failed', summary, changedFiles: [], tests: [] }
    } finally {
      this.runs.delete(request.taskId)
      await run.dispose()
    }
  }

  async cancel(taskId: string): Promise<void> {
    const run = this.runs.get(taskId)
    if (run !== undefined) await run.dispose()
  }

  dispose(): void {
    for (const run of this.runs.values()) void run.dispose()
    this.runs.clear()
  }
}

/** Governance adapter for the existing Codex Provider. */
export class CodexAdapter extends SubagentHarnessAdapter {
  constructor(ctx: Context) { super(ctx, 'codex') }
}

/** Governance adapter for the existing Claude Code Provider. */
export class ClaudeCodeAdapter extends SubagentHarnessAdapter {
  constructor(ctx: Context) { super(ctx, 'claude-code') }
}

/** Governance adapter for the existing DeepSeek Harness SDK Provider. */
export class DshSdkAdapter extends SubagentHarnessAdapter {
  constructor(ctx: Context) { super(ctx, 'deepseek-harness') }
}

/** Create the three supported adapters without copying provider protocols. */
export function createHarnessAdapters(ctx: Context): readonly HarnessAdapter[] {
  return [new CodexAdapter(ctx), new ClaudeCodeAdapter(ctx), new DshSdkAdapter(ctx)]
}

/** Returns the most restrictive permission supported by a harness and request. */
export function resolvePermission(id: HarnessId, requested: GovernancePermissionMode): GovernancePermissionMode {
  if (requested === 'full-access' && id !== 'deepseek-harness') return 'workspace-write'
  return requested
}

/** Keeps the adapter module's Agent import part of the public type contract. */
export type GovernanceParentAgent = Agent
