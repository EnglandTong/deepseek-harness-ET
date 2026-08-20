import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { describe, expect, it } from 'vitest'
import * as AgentGovernance from '../src/index.ts'

describe('dsh-agent-governance', () => {
  it('exposes both bundled skills through the shared registry and disposes them', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const fiber = await ctx.plugin(AgentGovernance, { includeDefaultRoots: false, watch: false })

    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual([
      'agent-loop-engineering',
      'cms-project-governance',
    ])
    expect((await ctx.skills.get('cms-project-governance'))?.content).toContain('CMS Project Governance')
    expect((await ctx.skills.get('agent-loop-engineering'))?.content).toContain('Agent Loop Engineering')

    await fiber.dispose()
    expect(await ctx.skills.list()).toEqual([])
  })

  it('can be isolated to the embedded root', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(AgentGovernance, { includeDefaultRoots: false, watch: false })

    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual([
      'agent-loop-engineering',
      'cms-project-governance',
    ])
  })
})
