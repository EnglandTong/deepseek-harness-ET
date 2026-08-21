import { Context } from '@deepseek-ai/cordis'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { describe, expect, it, vi } from 'vitest'
import { GovernanceService } from '../src/service.ts'
import { recommend } from '../src/routing.ts'
import type { HarnessDescriptor } from '../src/types.ts'

const agents: readonly HarnessDescriptor[] = [
  { id: 'codex', provider: 'codex', capabilities: ['code-editing'], strengths: ['focused changes'], permission: 'workspace-write', riskLevel: 'medium', supportsSubagent: true, supportsNativeSession: false, supportsStreaming: false, supportsCancellation: true, supportsFiles: true, supportsImages: false, supportsContinuable: false, available: true },
  { id: 'claude-code', provider: 'claude-code', capabilities: ['review'], strengths: ['architecture'], permission: 'workspace-write', riskLevel: 'medium', supportsSubagent: true, supportsNativeSession: false, supportsStreaming: false, supportsCancellation: true, supportsFiles: true, supportsImages: false, supportsContinuable: false, available: true },
  { id: 'deepseek-harness', provider: 'dsh-sdk', capabilities: ['planning'], strengths: ['governance'], permission: 'workspace-write', riskLevel: 'high', supportsSubagent: true, supportsNativeSession: true, supportsStreaming: false, supportsCancellation: true, supportsFiles: true, supportsImages: true, supportsContinuable: false, available: true },
]

describe('governance routing', () => {
  it('routes by deterministic task rules and always requires approval', () => {
    expect(recommend('修复导入测试并修改代码', agents)).toMatchObject({ primary: 'codex', requiresApproval: true })
    expect(recommend('review the architecture of this migration', agents)).toMatchObject({ primary: 'claude-code' })
    expect(recommend('整理项目边界和交接计划', agents)).toMatchObject({ primary: 'deepseek-harness' })
  })

  it('falls back to an available harness when the rule-selected provider is absent', () => {
    expect(recommend('修复导入测试并修改代码', agents.map(agent => agent.id === 'codex' ? { ...agent, available: false } : agent))).toMatchObject({
      primary: 'deepseek-harness',
      reasons: ['fallback because codex is unavailable'],
    })
  })

  it('records a route and rejects unknown approval ids', async () => {
    const ctx = new Context()
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(GovernanceService)
    const append = vi.fn()
    const result = ctx.governance.routeFor({ append } as never, 'write a focused test')
    expect(['codex', 'deepseek-harness']).toContain(result.recommendation.primary)
    expect(append).toHaveBeenCalledWith('governance/route', expect.objectContaining({ taskId: result.taskId, riskLevel: result.recommendation.riskLevel }))
    expect(() => ctx.governance.approve('missing')).toThrow('unknown governance task')
  })

  it('reports unloaded providers instead of claiming static availability', async () => {
    const ctx = new Context()
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(GovernanceService)

    expect(ctx.governance.listAgents()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'codex', provider: 'codex', available: false, diagnosticCode: 'provider-not-loaded' }),
      expect.objectContaining({ id: 'claude-code', provider: 'claude-code', available: false, diagnosticCode: 'provider-not-loaded' }),
      expect.objectContaining({ id: 'deepseek-harness', provider: 'dsh-sdk', available: false, diagnosticCode: 'provider-not-loaded' }),
    ]))
  })

  it('replays route, approval, report, and acceptance state from events', async () => {
    const ctx = new Context()
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(GovernanceService)
    const session = {
      events: [
        { type: 'governance/route', data: { taskId: 'task-1', task: 'write a test', primary: 'codex' } },
        { type: 'governance/approval', data: { taskId: 'task-1', decision: 'approved' } },
        { type: 'governance/report', data: { taskId: 'task-1', harness: 'codex', status: 'completed', summary: 'done', changedFiles: [], tests: [] } },
        { type: 'governance/acceptance', data: { taskId: 'task-1', decision: 'accepted' } },
      ],
    }

    expect(ctx.governance.replay(session as never)).toEqual([expect.objectContaining({
      taskId: 'task-1', status: 'completed', decision: 'approved', acceptance: 'accepted', harness: 'codex',
    })])
  })

  it('rejects handoff paths outside the session workspace', async () => {
    const ctx = new Context()
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(GovernanceService)
    const append = vi.fn()
    const session = { header: { cwd: 'D:/project' }, append, events: [] }
    const { taskId } = ctx.governance.routeFor(session as never, 'write a test')

    expect(() => ctx.governance.handoff(taskId, '../other/HANDOFF.md', 'outside', session as never)).toThrow('outside workspace')
    ctx.governance.handoff(taskId, '.agent-state/task/HANDOFF.md', 'inside', session as never)
    expect(append).toHaveBeenCalledWith('governance/handoff', expect.objectContaining({ path: expect.stringContaining('.agent-state') }))
  })

  it('rejects report files outside the session workspace and validates timeout configuration', async () => {
    const ctx = new Context()
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(GovernanceService)
    const append = vi.fn()
    const session = { header: { cwd: 'D:/project' }, append, events: [] }
    const { taskId } = ctx.governance.routeFor(session as never, 'write a test')

    expect(() => ctx.governance.report({ taskId, harness: 'codex', status: 'completed', summary: 'done', changedFiles: ['../other/file.ts'], tests: [] }, session as never)).toThrow('outside workspace')
    expect(() => ctx.governance.configure({ taskTimeoutMs: 0 })).toThrow('taskTimeoutMs')
  })
})
