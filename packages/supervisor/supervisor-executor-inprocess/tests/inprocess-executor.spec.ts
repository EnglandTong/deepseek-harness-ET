import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SupervisorProjectId, SupervisorRunId, SupervisorTaskId } from '@deepseek-ai/dsh-supervisor'
import type { SupervisorExecutionRequest } from '@deepseek-ai/dsh-supervisor-executor-subagent'
import type { SubagentRun } from '@deepseek-ai/dsh-subagent'
import { createInProcessSpawnExecutor } from '../src/factory.ts'
import { apply, Config } from '../src/index.ts'
import type { InProcessSpawnExecutorDeps } from '../src/types.ts'

interface DriverStartRequest {
  prompt: readonly { type: string; text: string }[]
  descriptor: { mode: string; provider: string; label: string }
  agentOptions: Record<string, string>
}
interface DriverStartOptions {
  reservedChildId: unknown
  cwd: string
}

function request(overrides: Partial<SupervisorExecutionRequest> = {}): SupervisorExecutionRequest {
  return {
    projectId: SupervisorProjectId('project-a'),
    taskId: SupervisorTaskId('task-a'),
    runId: SupervisorRunId('run-a'),
    prompt: [{ type: 'text', text: 'inspect the module' }],
    parent: {} as SupervisorExecutionRequest['parent'],
    route: {
      decision: {
        taskId: SupervisorTaskId('task-a'), policyVersion: '1', executor: 'supervisor-spawn', provider: 'deepseek',
        model: 'deepseek-chat', fallback: [], reason: 'matched', costTier: 'free', requiresApproval: false,
      },
      policyHash: 'sha256:test', matchedRuleId: 'test', approval: 'auto', dispatchable: true,
      permissionCeiling: 'read', timeoutMs: 30000, fallbackUsed: false,
    },
    permission: 'read',
    background: true,
    signal: new AbortController().signal,
    ...overrides,
  }
}

function depsWith(run: Partial<SubagentRun>): { deps: InProcessSpawnExecutorDeps; startRun: InProcessSpawnExecutorDeps['startRun'] } {
  const startRun = vi.fn(async () => ({
    id: SessionId('child'),
    localAgent: undefined,
    result: Promise.resolve({ output: [{ type: 'text' as const, text: 'done' }], stopReason: 'completed' as const, diagnostic: 'note' }),
    dispose: vi.fn(() => Promise.resolve()),
    ...run,
  })) as unknown as InProcessSpawnExecutorDeps['startRun']
  return {
    startRun,
    deps: {
      projectWorkspace: projectId => (projectId === SupervisorProjectId('project-a') ? '/repo/project-a' : undefined),
      startRun,
    },
  }
}

function firstStartCall(startRun: InProcessSpawnExecutorDeps['startRun']): [DriverStartRequest, DriverStartOptions] {
  return (startRun as ReturnType<typeof vi.fn>).mock.calls[0] as unknown as [DriverStartRequest, DriverStartOptions]
}

describe('createInProcessSpawnExecutor', () => {
  it('reports conservative capabilities from its validated config', () => {
    const { deps } = depsWith({})
    const provider = createInProcessSpawnExecutor(deps, { providerName: 'supervisor-spawn', providers: ['deepseek'], permissions: ['none', 'read'] })
    expect(provider.name).toBe('supervisor-spawn')
    expect(provider.capabilities).toEqual({
      permissions: ['none', 'read'], background: true, cancellation: true, providers: ['deepseek'],
    })
  })

  it('rejects a blank executor name', () => {
    const { deps } = depsWith({})
    expect(() => createInProcessSpawnExecutor(deps, { providerName: '  ', providers: [], permissions: ['none'] }))
      .toThrow('name must not be empty')
  })

  it('fails loud when the routed project is not registered', async () => {
    const { deps, startRun } = depsWith({})
    const provider = createInProcessSpawnExecutor(deps, { providerName: 'supervisor-spawn', providers: ['deepseek'], permissions: ['none', 'read'] })
    await expect(provider.prepare(request({ projectId: SupervisorProjectId('ghost') })))
      .rejects.toThrow("no registered project 'ghost'")
    expect(startRun).not.toHaveBeenCalled()
  })

  it('hands the reserved identity and project workspace to the driver', async () => {
    const { deps, startRun } = depsWith({})
    const provider = createInProcessSpawnExecutor(deps, { providerName: 'supervisor-spawn', providers: ['deepseek'], permissions: ['none', 'read'] })
    const prepared = await provider.prepare(request())
    expect(prepared.release).toBeUndefined()
    const child = await prepared.start()
    expect(child.childSessionId).toBe(prepared.childSessionId)
    expect(startRun).toHaveBeenCalledOnce()
    const [runRequest, runOptions] = firstStartCall(startRun)
    expect(runOptions).toEqual({ reservedChildId: prepared.childSessionId, cwd: '/repo/project-a' })
    expect(runRequest.prompt).toEqual([{ type: 'text', text: 'inspect the module' }])
    expect(runRequest.descriptor).toMatchObject({ mode: 'one-shot', provider: 'supervisor-spawn', label: 'supervisor:task-a' })
    expect(runRequest.agentOptions).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
    await expect(child.result).resolves.toEqual({
      stopReason: 'completed',
      output: [{ type: 'text', text: 'done' }],
      diagnostic: 'note',
    })
  })

  it('omits the child model when the route declares none and disposes through the run', async () => {
    const decision = request().route.decision
    const routed = request({
      route: {
        ...request().route,
        decision: {
          taskId: decision.taskId, policyVersion: decision.policyVersion, executor: decision.executor,
          provider: decision.provider, fallback: decision.fallback, reason: decision.reason,
          costTier: decision.costTier, requiresApproval: decision.requiresApproval,
        },
      },
    })
    const dispose = vi.fn(() => Promise.resolve())
    const { deps, startRun } = depsWith({ dispose })
    const provider = createInProcessSpawnExecutor(deps, { providerName: 'supervisor-spawn', providers: ['deepseek'], permissions: ['none', 'read'] })
    const prepared = await provider.prepare(routed)
    const child = await prepared.start()
    const [driverRequest] = firstStartCall(startRun)
    expect(driverRequest.agentOptions).toEqual({ provider: 'deepseek' })
    await child.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })
})

describe('supervisor-executor-inprocess plugin', () => {
  it('registers the adapter under the validated configuration', () => {
    const register = vi.fn()
    const ctx = new Context()
    Object.defineProperty(ctx, 'supervisorExecutors', { value: { register } })
    Object.defineProperty(ctx, 'supervisor', { value: { getProject: () => undefined } })
    apply(ctx, Config({ providerName: 'supervisor-spawn', providers: ['deepseek'], permissions: ['none', 'read'] }))
    expect(register).toHaveBeenCalledOnce()
    interface RegisteredProvider {
      name: string
      capabilities: { providers: readonly string[]; permissions: readonly string[] }
    }
    const [provider] = register.mock.calls[0] as unknown as [RegisteredProvider]
    expect(provider.name).toBe('supervisor-spawn')
    expect(provider.capabilities.providers).toEqual(['deepseek'])
    expect(provider.capabilities.permissions).toEqual(['none', 'read'])
  })
})
