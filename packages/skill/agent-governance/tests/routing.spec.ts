import { Context } from '@deepseek-ai/cordis'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { describe, expect, it, vi } from 'vitest'
import { GovernanceService } from '../src/service.ts'
import { recommend } from '../src/routing.ts'
import type { HarnessDescriptor } from '../src/types.ts'

const agents: readonly HarnessDescriptor[] = [
  { id: 'codex', provider: 'codex', capabilities: ['code-editing'], strengths: ['focused changes'], permission: 'workspace-write', supportsFiles: true, supportsImages: false, supportsContinuable: false, available: true },
  { id: 'claude-code', provider: 'claude', capabilities: ['review'], strengths: ['architecture'], permission: 'workspace-write', supportsFiles: true, supportsImages: false, supportsContinuable: false, available: true },
  { id: 'deepseek-harness', provider: 'dsh', capabilities: ['planning'], strengths: ['governance'], permission: 'workspace-write', supportsFiles: true, supportsImages: true, supportsContinuable: false, available: true },
]

describe('governance routing', () => {
  it('routes by deterministic task rules and always requires approval', () => {
    expect(recommend('修复导入测试并修改代码', agents)).toMatchObject({ primary: 'codex', requiresApproval: true })
    expect(recommend('review the architecture of this migration', agents)).toMatchObject({ primary: 'claude-code' })
    expect(recommend('整理项目边界和交接计划', agents)).toMatchObject({ primary: 'deepseek-harness' })
  })

  it('records a route and rejects unknown approval ids', async () => {
    const ctx = new Context()
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(GovernanceService)
    const append = vi.fn()
    const result = ctx.governance.routeFor({ append } as never, 'write a focused test')
    expect(result.recommendation.primary).toBe('deepseek-harness')
    expect(append).toHaveBeenCalledWith('governance/route', expect.objectContaining({ taskId: result.taskId }))
    expect(() => ctx.governance.approve('missing')).toThrow('unknown governance task')
  })
})
