import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it } from 'vitest'
import * as AgentGovernance from '../src/index.ts'

describe('dsh-agent-governance', () => {
  it('exposes both bundled skills through the shared registry and disposes them', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SystemPrompt)
    const fiber = await ctx.plugin(AgentGovernance, { includeDefaultRoots: false, watch: false })

    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual([
      'agent-governance-acceptance',
      'agent-governance-handoff',
      'agent-governance-routing',
      'agent-governance-runtime',
      'agent-loop-engineering',
      'cms-project-governance',
    ])
    expect((await ctx.skills.get('cms-project-governance'))?.content).toContain('CMS Project Governance')
    expect((await ctx.skills.get('agent-loop-engineering'))?.content).toContain('Agent Loop Engineering')
    expect(['governance_list_agents', 'governance_check_agents', 'governance_route_task', 'governance_approve', 'governance_delegate', 'governance_cancel', 'governance_accept', 'governance_handoff'].map(name => ctx.tools.get(name)?.name)).toEqual([
      'governance_list_agents',
      'governance_check_agents',
      'governance_route_task',
      'governance_approve',
      'governance_delegate',
      'governance_cancel',
      'governance_accept',
      'governance_handoff',
    ])

    await fiber.dispose()
    expect(await ctx.skills.list()).toEqual([])
    expect(ctx.tools.get('governance_route_task')).toBeUndefined()
  })

  it('can be isolated to the embedded root', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(AgentGovernance, { includeDefaultRoots: false, watch: false })

    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual([
      'agent-governance-acceptance',
      'agent-governance-handoff',
      'agent-governance-routing',
      'agent-governance-runtime',
      'agent-loop-engineering',
      'cms-project-governance',
    ])
  })
})
