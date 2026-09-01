import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SupervisorProjectId, SupervisorRunId, SupervisorTaskId } from '@deepseek-ai/dsh-supervisor'
import { SupervisorExecutorService, normalizeExecutionResult, type SupervisorExecutionRequest } from '../src/index.ts'

function request(overrides: Partial<SupervisorExecutionRequest> = {}): SupervisorExecutionRequest {
  return {
    projectId: SupervisorProjectId('project-a'), taskId: SupervisorTaskId('task-a'), runId: SupervisorRunId('run-a'),
    prompt: [{ type: 'text', text: 'inspect' }], parent: {} as SupervisorExecutionRequest['parent'],
    route: {
      decision: { taskId: SupervisorTaskId('task-a'), policyVersion: '1', executor: 'mock', provider: 'test', fallback: [], reason: 'matched', costTier: 'free', requiresApproval: false },
      policyHash: 'sha256:test', matchedRuleId: 'test', approval: 'auto', dispatchable: true, permissionCeiling: 'read', timeoutMs: 1000, fallbackUsed: false,
    },
    permission: 'read', background: false, signal: new AbortController().signal,
    ...overrides,
  }
}

function serviceWithHost(host: { admit: ReturnType<typeof vi.fn> }): SupervisorExecutorService {
  const ctx = new Context()
  Object.defineProperty(ctx, 'supervisorProjectHost', { value: host })
  return new SupervisorExecutorService(ctx)
}

describe('Supervisor executor result normalization', () => {
  it('preserves independent process facts for a completed result', () => {
    expect(normalizeExecutionResult({ stopReason: 'completed', timedOut: false, signal: null, exitCode: 0 }))
      .toEqual({ status: 'completed', output: [], timedOut: false, signal: null, exitCode: 0 })
  })

  it('maps aborted and max-token outcomes without dropping diagnostics', () => {
    expect(normalizeExecutionResult({ stopReason: 'aborted', diagnostic: 'cancelled by owner', timedOut: false }))
      .toMatchObject({ status: 'cancelled', diagnostic: 'cancelled by owner', timedOut: false })
    expect(normalizeExecutionResult({ stopReason: 'max-tokens', timedOut: true, signal: 'SIGTERM', exitCode: null }))
      .toMatchObject({ status: 'timeout', timedOut: true, signal: 'SIGTERM', exitCode: null })
  })

  it('classifies provider and refusal failures as failed', () => {
    expect(normalizeExecutionResult({ stopReason: 'error', diagnostic: 'transport failed' }))
      .toMatchObject({ status: 'failed', diagnostic: 'transport failed', timedOut: false })
    expect(normalizeExecutionResult({ stopReason: 'refusal' })).toMatchObject({ status: 'failed', timedOut: false })
    expect(normalizeExecutionResult({ stopReason: 'future-provider-reason' })).toMatchObject({ status: 'failed', timedOut: false })
  })

  it('rejects a route gate before invoking an executor', async () => {
    const host = { admit: vi.fn() }
    const service = serviceWithHost(host)
    service.register({ name: 'mock', capabilities: { permissions: ['read'], background: false, cancellation: true, providers: ['test'] }, prepare: vi.fn() })
    await expect(service.dispatch(request({ route: { ...request().route, dispatchable: false } })))
      .rejects.toMatchObject({ code: 'ROUTE_NOT_DISPATCHABLE' })
    expect(host.admit).not.toHaveBeenCalled()
  })

  it('rejects a permission above the executor capability ceiling', async () => {
    const host = { admit: vi.fn() }
    const service = serviceWithHost(host)
    service.register({ name: 'mock', capabilities: { permissions: ['read'], background: false, cancellation: true, providers: ['test'] }, prepare: vi.fn() })
    await expect(service.dispatch(request({ permission: 'write' }))).rejects.toMatchObject({ code: 'PERMISSION_EXCEEDED' })
    expect(host.admit).not.toHaveBeenCalled()
  })

  it('checks the route ceiling before provider preparation', async () => {
    const host = { admit: vi.fn() }
    const prepare = vi.fn()
    const service = serviceWithHost(host)
    service.register({ name: 'mock', capabilities: { permissions: ['write'], background: false, cancellation: true, providers: ['test'] }, prepare })
    const routed = { ...request().route, permissionCeiling: 'read' as const }
    await expect(service.dispatch(request({ permission: 'write', route: routed }))).rejects.toMatchObject({ code: 'PERMISSION_EXCEEDED' })
    expect(prepare).not.toHaveBeenCalled()
  })

  it('keeps the host lease through settlement and targets cancellation exactly', async () => {
    const release = vi.fn(() => Promise.resolve())
    const cancel = vi.fn(() => Promise.resolve())
    const attach = vi.fn()
    const host = { admit: vi.fn(async () => ({
      link: {}, attach, cancel, release,
    })) }
    const service = serviceWithHost(host)
    const dispose = vi.fn(() => Promise.resolve())
    service.register({
      name: 'mock', capabilities: { permissions: ['read'], background: true, cancellation: true, providers: ['test'] },
      prepare: async () => ({ childSessionId: SessionId('child-a'), start: async () => ({ childSessionId: SessionId('child-a'), result: Promise.resolve({ stopReason: 'completed' as const }), dispose }) }),
    })
    const handle = await service.dispatch(request({ background: true }))
    await expect(handle.result).resolves.toMatchObject({ status: 'completed' })
    expect(attach).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalled()
    await handle.cancel()
    await handle.cancel()
    expect(cancel).not.toHaveBeenCalled()
  })

  it('releases provider preparation when admission or startup fails', async () => {
    const preparedRelease = vi.fn(() => Promise.resolve())
    const host = { admit: vi.fn().mockRejectedValue(new Error('writer busy')) }
    const service = serviceWithHost(host)
    service.register({ name: 'mock', capabilities: { permissions: ['read'], background: false, cancellation: true, providers: ['test'] }, prepare: async () => ({ childSessionId: SessionId('child-a'), start: vi.fn(), release: preparedRelease }) })
    await expect(service.dispatch(request())).rejects.toThrow('writer busy')
    expect(preparedRelease).toHaveBeenCalledOnce()

    const release = vi.fn(() => Promise.resolve())
    const startRelease = vi.fn(() => Promise.resolve())
    const service2 = serviceWithHost({ admit: vi.fn().mockResolvedValue({ link: {}, attach: vi.fn(), cancel: vi.fn(), release }) })
    service2.register({ name: 'mock', capabilities: { permissions: ['read'], background: false, cancellation: true, providers: ['test'] }, prepare: async () => ({ childSessionId: SessionId('child-a'), start: vi.fn().mockRejectedValue(new Error('startup failed')), release: startRelease }) })
    await expect(service2.dispatch(request())).rejects.toThrow('startup failed')
    expect(release).toHaveBeenCalledOnce()
    expect(startRelease).toHaveBeenCalledOnce()
  })

  it('rejects an adapter that returns a different child identity', async () => {
    const release = vi.fn(() => Promise.resolve())
    const dispose = vi.fn(() => Promise.resolve())
    const service = serviceWithHost({ admit: vi.fn().mockResolvedValue({ link: {}, attach: vi.fn(), cancel: vi.fn(), release }) })
    service.register({ name: 'mock', capabilities: { permissions: ['read'], background: false, cancellation: true, providers: ['test'] }, prepare: async () => ({ childSessionId: SessionId('reserved'), start: async () => ({ childSessionId: SessionId('actual'), result: Promise.resolve({ stopReason: 'completed' as const }), dispose }) }) })
    await expect(service.dispatch(request())).rejects.toMatchObject({ code: 'CHILD_ID_MISMATCH' })
    expect(dispose).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
  })

  it('flattens a provider result rejection and still disposes the child', async () => {
    const release = vi.fn(() => Promise.resolve())
    const dispose = vi.fn(() => Promise.resolve())
    const service = serviceWithHost({ admit: vi.fn().mockResolvedValue({ link: {}, attach: vi.fn(), cancel: vi.fn(), release }) })
    service.register({ name: 'mock', capabilities: { permissions: ['read'], background: false, cancellation: true, providers: ['test'] }, prepare: async () => ({ childSessionId: SessionId('child-a'), start: async () => ({ childSessionId: SessionId('child-a'), result: Promise.reject(new Error('raw provider error')), dispose }) }) })
    const handle = await service.dispatch(request())
    await expect(handle.result).resolves.toMatchObject({ status: 'failed', diagnostic: expect.stringContaining('provider result rejected') as string })
    expect(dispose).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
  })

  it('turns route timeout into a terminal timeout and cancels the child once', async () => {
    const done = Promise.withResolvers<{ stopReason: 'completed' }>()
    const dispose = vi.fn(() => { done.resolve({ stopReason: 'completed' }); return Promise.resolve() })
    const release = vi.fn(() => Promise.resolve())
    const service = serviceWithHost({ admit: vi.fn().mockResolvedValue({ link: {}, attach: vi.fn(), cancel: vi.fn(), release }) })
    service.register({ name: 'mock', capabilities: { permissions: ['read'], background: false, cancellation: true, providers: ['test'] }, prepare: async () => ({ childSessionId: SessionId('child-a'), start: async () => ({ childSessionId: SessionId('child-a'), result: done.promise, dispose }) }) })
    const handle = await service.dispatch(request({ route: { ...request().route, timeoutMs: 1 } }))
    await expect(handle.result).resolves.toMatchObject({ status: 'timeout', timedOut: true })
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('removes an executor through its effect disposer', () => {
    const service = serviceWithHost({ admit: vi.fn() })
    const dispose = service.register({ name: 'mock', capabilities: { permissions: ['read'], background: false, cancellation: true, providers: ['test'] }, prepare: vi.fn() })
    expect(service.list()).toEqual(['mock'])
    dispose()
    expect(service.list()).toEqual([])
  })
})
