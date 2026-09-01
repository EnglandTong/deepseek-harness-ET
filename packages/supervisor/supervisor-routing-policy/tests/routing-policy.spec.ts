import { describe, expect, it } from 'vitest'
import { SupervisorTaskId } from '../../supervisor/src/types.ts'
import {
  RoutingPolicyError,
  RoutingPolicyStore,
  compileRoutingPolicy,
  parseRoutingPolicyYaml,
  resolveRoute,
  stablePolicyHash,
} from '../src/index.ts'

const taskId = SupervisorTaskId('task-a')

const source = `
version: 3
timezone: Asia/Shanghai
timeWindows:
  - { start: "22:00", end: "02:00" }
routes:
  - id: coding
    domain: software
    taskType: implementation
    language: typescript
    capabilities: [read, write]
    executor: codex
    provider: openai
    model: coding
    costTier: medium
    approval: auto
    permissionCeiling: write
    timeoutMs: 60000
    projectAllowlist: [project-a]
    fallback:
      - { executor: claude, provider: anthropic, model: coding, costTier: high }
    review:
      strategy: single
      condition: always
      reviewer: { executor: codex, provider: openai, model: review, costTier: medium }
`

describe('Personal Supervisor routing policy', () => {
  it('loads the documented YAML and creates a stable policy hash', () => {
    const first = compileRoutingPolicy(source)
    const second = compileRoutingPolicy(parseRoutingPolicyYaml(source))
    expect(first.hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(first.hash).toBe(second.hash)
    expect(stablePolicyHash(first)).toBe(first.hash)
    expect(Object.isFrozen(first)).toBe(true)
  })

  it('uses explicit selectors, risk gates, and cross-midnight windows', () => {
    const policy = compileRoutingPolicy(source)
    const result = resolveRoute(policy, {
      taskId,
      projectId: 'project-a' as never,
      domain: 'software',
      taskType: 'implementation',
      language: 'TypeScript',
      capabilities: ['read', 'write'],
      now: '2026-01-01T23:30:00+08:00',
    })
    expect(result.decision.provider).toBe('openai')
    expect(result.decision.requiresApproval).toBe(false)
    expect(result.dispatchable).toBe(true)
    expect(result.review?.reviewer?.provider).toBe('openai')

    const risky = resolveRoute(policy, {
      taskId,
      projectId: 'project-a' as never,
      domain: 'software',
      taskType: 'implementation',
      language: 'typescript',
      capabilities: ['read', 'write'],
      highRisk: true,
      now: '2026-01-01T23:30:00+08:00',
    })
    expect(risky.decision.requiresApproval).toBe(true)
    expect(risky.dispatchable).toBe(false)

    const closed = resolveRoute(policy, {
      taskId,
      projectId: 'project-a' as never,
      domain: 'software',
      taskType: 'implementation',
      language: 'typescript',
      capabilities: ['read', 'write'],
      now: '2026-01-01T12:00:00+08:00',
    })
    expect(closed.dispatchable).toBe(false)
    expect(closed.decision.reason).toContain('execution window')
  })

  it('selects explicit fallback when the primary provider is unavailable', () => {
    const policy = compileRoutingPolicy(source)
    const result = resolveRoute(policy, {
      taskId,
      projectId: 'project-a' as never,
      domain: 'software',
      taskType: 'implementation',
      language: 'typescript',
      capabilities: ['read', 'write'],
      now: '2026-01-01T23:30:00+08:00',
      availableProviders: ['anthropic'],
    })
    expect(result.fallbackUsed).toBe(true)
    expect(result.decision.provider).toBe('anthropic')
  })

  it('enforces allowlists, concurrency, deny, and conditional reviewers', () => {
    const policy = compileRoutingPolicy({
      routes: [
        {
          id: 'repair', taskType: ['repair'], executor: 'e', provider: 'p', costTier: 'low', approval: 'auto',
          projectAllowlist: ['project-a'], review: {
            strategy: 'single', condition: 'onFailure', reviewer: { executor: 'r', provider: 'rp', costTier: 'low' },
          },
        },
        {
          id: 'limited', taskType: ['limited'], executor: 'e', provider: 'p', costTier: 'low', approval: 'auto',
          concurrency: { maxConcurrent: 1 },
        },
        { id: 'blocked', taskType: ['blocked'], executor: 'e', provider: 'p', costTier: 'low', approval: 'deny' },
      ],
    })
    const outside = resolveRoute(policy, { taskId, taskType: 'repair', projectId: 'project-b' as never })
    expect(outside.matchedRuleId).toBeUndefined()
    const beforeFailure = resolveRoute(policy, { taskId, taskType: 'repair', projectId: 'project-a' as never })
    expect(beforeFailure.review).toBeUndefined()
    const afterFailure = resolveRoute(policy, { taskId, taskType: 'repair', projectId: 'project-a' as never, failed: true })
    expect(afterFailure.review?.reviewer?.provider).toBe('rp')

    const busy = resolveRoute(policy, { taskId, taskType: 'limited', usage: { activeConcurrent: 1 } })
    expect(busy.dispatchable).toBe(false)
    expect(busy.decision.reason).toContain('concurrency')
    const denied = resolveRoute(policy, { taskId, taskType: 'blocked' })
    expect(denied.approval).toBe('deny')
    expect(denied.dispatchable).toBe(false)
  })

  it('requires confirmation for unknown routes, exhausted budgets, and stale updates', () => {
    const policy = compileRoutingPolicy({ version: 1, budget: { maxCostUnits: 2 }, routes: [{ domain: ['software'], executor: 'e', provider: 'p', costTier: 'low', approval: 'auto' }] })
    const unknown = resolveRoute(policy, { taskId, domain: 'other' })
    expect(unknown.dispatchable).toBe(false)
    expect(unknown.decision.requiresApproval).toBe(true)

    const exhausted = resolveRoute(policy, { taskId, domain: 'software', usage: { spentCostUnits: 2 }, estimatedCostUnits: 1 })
    expect(exhausted.dispatchable).toBe(false)
    expect(exhausted.decision.reason).toContain('budget')

    const store = new RoutingPolicyStore(policy)
    const preview = store.preview({ version: 2, routes: [{ executor: 'e2', provider: 'p2', costTier: 'free' }] })
    expect(() => store.apply(preview, false)).toThrow(/confirmation/)
    expect(store.apply(preview, true).version).toBe('2')
    expect(() => store.apply({ ...preview, baseHash: policy.hash }, true)).toThrow(/stale/)
  })

  it('rejects unknown and credential fields before compilation', () => {
    expect(() => parseRoutingPolicyYaml('routes: []\nunknownField: nope')).toThrow(/unknown key/)
    expect(() => parseRoutingPolicyYaml('routes: []\n')).toThrow(/non-empty array/)
    expect(() => parseRoutingPolicyYaml('routes:\n  - executor: e\n    provider: p\n    apiKey: nope')).toThrow(RoutingPolicyError)
    expect(() => parseRoutingPolicyYaml('routes:\n  - executor: e\n    provider: p\n    fallback: [missing-route]')).toThrow(/unknown or self route/)
  })
})
