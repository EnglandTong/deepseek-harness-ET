import { Context } from '@deepseek-ai/cordis'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { describe, expect, it } from 'vitest'
import { ClaudeCodeAdapter, CodexAdapter, DshSdkAdapter } from '../src/adapters.ts'

describe('governance harness adapters', () => {
  it('maps the three existing DSH providers without copying their protocols', async () => {
    const ctx = new Context()
    await ctx.plugin(SubagentRuntime)

    expect(new CodexAdapter(ctx).describe()).toMatchObject({ id: 'codex', provider: 'codex' })
    expect(new ClaudeCodeAdapter(ctx).describe()).toMatchObject({ id: 'claude-code', provider: 'claude-code' })
    expect(new DshSdkAdapter(ctx).describe()).toMatchObject({ id: 'deepseek-harness', provider: 'dsh-sdk' })
  })

  it('rejects unsafe preparation before a child Provider starts', async () => {
    const ctx = new Context()
    await ctx.plugin(SubagentRuntime)
    const adapter = new CodexAdapter(ctx)
    const request = {
      taskId: 'task-1', prompt: [], workspace: 'D:/project', permission: 'workspace-write' as const,
      nestedDepth: 2, maxNestedDepth: 1, signal: new AbortController().signal, parent: undefined as never,
    }

    expect(() => adapter.prepare(request)).toThrow('exceeds maximum')
  })
})
