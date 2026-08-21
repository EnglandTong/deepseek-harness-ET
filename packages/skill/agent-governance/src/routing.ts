import type { GovernancePermissionMode, HarnessDescriptor, HarnessId, RouteRecommendation } from './types.ts'

const DEFAULT_RULES: readonly { match: RegExp; primary: HarnessId; reason: string }[] = [
  { match: /需求|规划|治理|边界|交接|计划|requirements|governance|handoff|planning/i, primary: 'deepseek-harness', reason: 'task planning and governance' },
  { match: /测试|修复|实现|修改|代码|bug|test|fix|implement|patch/i, primary: 'codex', reason: 'focused code changes and test execution' },
  { match: /架构|审查|重构|大型|architecture|review|refactor|large/i, primary: 'claude-code', reason: 'broad codebase analysis' },
]

/** Recommend an Agent from deterministic task rules without executing it. */
export function recommend(task: string, agents: readonly HarnessDescriptor[], defaultPermission: GovernancePermissionMode = 'workspace-write'): RouteRecommendation {
  if (task.trim().length === 0) throw new Error('governance route requires a non-empty task')
  const selected = DEFAULT_RULES.find(rule => rule.match.test(task))?.primary ?? 'deepseek-harness'
  const available = new Set(agents.filter(agent => agent.available).map(agent => agent.id))
  const fallbackOrder: readonly HarnessId[] = ['deepseek-harness', 'codex', 'claude-code']
  const primary = available.has(selected) ? selected : fallbackOrder.find(id => available.has(id)) ?? selected
  const alternatives = agents.filter(agent => agent.available && agent.id !== primary).map(agent => agent.id)
  const selectedDescriptor = agents.find(agent => agent.id === primary)
  const selectedRule = DEFAULT_RULES.find(rule => rule.primary === selected)
  const fallbackReason = primary === selected ? selectedRule?.reason : `fallback because ${selected} is unavailable`
  return {
    task,
    primary,
    alternatives,
    reasons: [fallbackReason ?? 'general task decomposition'],
    riskLevel: selectedDescriptor?.riskLevel ?? 'high',
    permission: selectedDescriptor?.permission ?? defaultPermission,
    requiresApproval: true,
  }
}
