import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SupervisorExecutionResult } from '@deepseek-ai/dsh-supervisor-executor-subagent'
import SupervisorService, { SupervisorProjectId, type SupervisorProjectSnapshot } from '@deepseek-ai/dsh-supervisor'
import type { ResolvedRouteDecision, RouteRequest } from '@deepseek-ai/dsh-supervisor-routing-policy'
import SupervisorOrchestratorService from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

function project(id: string): SupervisorProjectSnapshot {
  return { id: SupervisorProjectId(id), revision: 1, displayName: id, realPath: `C:/projects/${id}`, status: 'registered', registeredAt: new Date(0).toISOString() }
}

async function boot(
  route: (request: RouteRequest) => unknown,
  dispatch?: (request: unknown) => Promise<unknown>,
): Promise<SupervisorOrchestratorService> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SupervisorService)
  ctx.emit('supervisor/project', { type: 'supervisor/project', version: 1, snapshot: project('a') })
  ctx.supervisor.registerRouter({ name: 'test-router', resolve: (request: RouteRequest) => {
    const raw = route(request) as ResolvedRouteDecision & Record<string, unknown>
    if (raw.decision !== undefined) return raw
    const policyVersion = typeof raw.policyVersion === 'string' ? raw.policyVersion : 'test'
    const executor = typeof raw.executor === 'string' ? raw.executor : 'fake'
    const provider = typeof raw.provider === 'string' ? raw.provider : 'fake'
    const reason = typeof raw.reason === 'string' ? raw.reason : 'test'
    const decision = {
      taskId: request.taskId,
      policyVersion,
      executor,
      provider,
      model: raw.model as string | undefined,
      fallback: Array.isArray(raw.fallback) ? raw.fallback : [],
      reason,
    }
    return {
      decision,
      policyHash: raw.policyHash ?? 'sha256:test',
      approval: raw.approval ?? 'auto',
      dispatchable: raw.dispatchable,
      permissionCeiling: raw.permissionCeiling ?? 'read',
      timeoutMs: raw.timeoutMs ?? 1000,
      fallbackUsed: raw.fallbackUsed,
    }
  } } as never)
  Object.defineProperty(ctx, 'supervisorExecutors', { value: { dispatch } })
  return new SupervisorOrchestratorService(ctx, { maxRepairAttempts: 1, autoDispatch: false, retryOnFailure: true })
}

const captureRequest = {
  projectId: SupervisorProjectId('a'), title: 'Implement feature', description: 'Implement the feature safely', nextAction: 'Run review', prompt: [], parent: {} as Agent, route: { taskType: 'coding' }, permission: 'read' as const,
}

describe('SupervisorOrchestratorService', () => {
  it('captures a task and groups owner approval into one batch', async () => {
    const service = await boot(request => ({ taskId: request.taskId, policyVersion: '1', executor: 'fake', provider: 'fake', fallback: [], reason: 'high risk', costTier: 'free', requiresApproval: true, policyHash: 'sha256:x', approval: 'confirm', dispatchable: false, permissionCeiling: 'read', timeoutMs: 1000, fallbackUsed: false }))
    const result = await service.capture(captureRequest)
    expect(result.task.status).toBe('AwaitingApproval')
    expect(result.approvalBatchId).toMatch(/^approval:/)
    expect(service.listApprovalBatches()).toHaveLength(1)
    expect(service.listTasks()).toHaveLength(1)
  })

  it('rejects stale approval and does not dispatch an old revision', async () => {
    const service = await boot(request => ({ taskId: request.taskId, policyVersion: '1', executor: 'fake', provider: 'fake', fallback: [], reason: 'confirm', costTier: 'free', requiresApproval: true, policyHash: 'sha256:x', approval: 'confirm', dispatchable: false, permissionCeiling: 'read', timeoutMs: 1000, fallbackUsed: false }))
    const result = await service.capture(captureRequest)
    await expect(service.approve(result.approvalBatchId!, new Map([[result.task.id, 99]]))).rejects.toMatchObject({ code: 'STALE_REVISION' })
  })

  it('repairs once and stops a repeated failure signature', async () => {
    const result: SupervisorExecutionResult = { status: 'failed', output: [], timedOut: false, diagnostic: 'same failure', signal: null, exitCode: 1 }
    const dispatch = vi.fn(async () => ({
      childSessionId: 'child' as never,
      lease: { cancel: vi.fn(async () => undefined) },
      result: Promise.resolve(result),
      cancel: vi.fn(async () => undefined),
    }))
    const service = await boot(request => ({ taskId: request.taskId, policyVersion: '1', executor: 'fake', provider: 'fake', fallback: [], reason: 'safe', costTier: 'free', requiresApproval: false, policyHash: 'sha256:x', approval: 'auto', dispatchable: true, permissionCeiling: 'read', timeoutMs: 1000, fallbackUsed: false }), dispatch)
    const captured = await service.capture(captureRequest)
    const dispatchResult = await service.dispatch(captured.task.id)
    await service.wait(dispatchResult.runId)
    await vi.waitFor(() =>{  expect(dispatch).toHaveBeenCalledTimes(2) })
    await vi.waitFor(() =>{  expect(service.getTask(captured.task.id)?.status).toBe('Failed') })
    expect(service.getTask(captured.task.id)?.blocker).toMatch(/Failure signature/)
  })

  it('requires the viewed revision for follow-up', async () => {
    const service = await boot(request => ({ taskId: request.taskId, policyVersion: '1', executor: 'fake', provider: 'fake', fallback: [], reason: 'safe', costTier: 'free', requiresApproval: false, policyHash: 'sha256:x', approval: 'auto', dispatchable: true, permissionCeiling: 'read', timeoutMs: 1000, fallbackUsed: false }))
    const record = await service.capture(captureRequest)
    await expect(service.followUp({ taskId: record.task.id, expectedRevision: 1, prompt: [], nextAction: 'retry' })).rejects.toMatchObject({ code: 'STALE_REVISION' })
  })
})
