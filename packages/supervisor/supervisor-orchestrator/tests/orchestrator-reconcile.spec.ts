/** WO-E restart reconciliation tests: recovery feed, escalation, notifications. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SupervisorExecutionResult } from '@deepseek-ai/dsh-supervisor-executor-subagent'
import SupervisorService, {
  SupervisorProjectId,
  SupervisorRunId,
  SupervisorTaskId,
  supervisorEventFromSessionEvent,
  type SupervisorNotificationEvent,
  type SupervisorProjectSnapshot,
  type SupervisorRunLink,
} from '@deepseek-ai/dsh-supervisor'
import type { ResolvedRouteDecision, RouteRequest } from '@deepseek-ai/dsh-supervisor-routing-policy'
import SupervisorOrchestratorService from '../src/index.ts'

const contexts: Context[] = []
/** Subscription sink for durable notifications emitted by the service under test. */
const notificationEvents: SupervisorNotificationEvent[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  notificationEvents.splice(0)
})

function project(id: string): SupervisorProjectSnapshot {
  return { id: SupervisorProjectId(id), revision: 1, displayName: id, realPath: `C:/projects/${id}`, status: 'registered', registeredAt: new Date(0).toISOString() }
}

function autoRoute(): (request: RouteRequest) => unknown {
  return request => ({ taskId: request.taskId, policyVersion: '1', executor: 'fake', provider: 'fake', fallback: [], reason: 'safe', costTier: 'free', requiresApproval: false, policyHash: 'sha256:x', approval: 'auto', dispatchable: true, permissionCeiling: 'read', timeoutMs: 1000, fallbackUsed: false })
}

function probeExecutor(): (request: unknown) => Promise<unknown> {
  return vi.fn(async () => ({
    childSessionId: 'probe-child' as never,
    lease: { cancel: vi.fn(async () => undefined) },
    result: Promise.resolve({ status: 'completed', output: [], timedOut: false } satisfies SupervisorExecutionResult),
    cancel: vi.fn(async () => undefined),
  }))
}

async function boot(
  route: (request: RouteRequest) => unknown,
  dispatch?: (request: unknown) => Promise<unknown>,
  options: { emitProject?: boolean } = {},
): Promise<{ service: SupervisorOrchestratorService; ctx: Context }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SupervisorService)
  if (options.emitProject !== false) {
    ctx.emit('supervisor/project', { type: 'supervisor/project', version: 1, snapshot: project('a') })
  }
  ctx.supervisor.registerRouter({ name: 'test-router', resolve: (request: RouteRequest) => {
    const raw = route(request) as ResolvedRouteDecision & Record<string, unknown>
    const decision = {
      taskId: request.taskId,
      policyVersion: typeof raw.policyVersion === 'string' ? raw.policyVersion : 'test',
      executor: typeof raw.executor === 'string' ? raw.executor : 'fake',
      provider: typeof raw.provider === 'string' ? raw.provider : 'fake',
      model: raw.model as string | undefined,
      fallback: Array.isArray(raw.fallback) ? raw.fallback : [],
      reason: typeof raw.reason === 'string' ? raw.reason : 'test',
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
  ctx.on('supervisor/notification', (event) => {
    if (event.snapshot.kind === 'owner-decision') notificationEvents.push(event)
  })
  const service = new SupervisorOrchestratorService(ctx, { maxRepairAttempts: 1, autoDispatch: false, retryOnFailure: true })
  Object.defineProperty(ctx, 'supervisorOrchestrator', { value: service })
  return { service, ctx }
}

const captureRequest = {
  projectId: SupervisorProjectId('a'), title: 'Implement feature', description: 'Implement the feature safely', nextAction: 'Run review', prompt: [], parent: {} as Agent, route: { taskType: 'coding' }, permission: 'read' as const,
}

/** Build a fake controller Session log the init path can fold. */
function interruptedLedger(taskId: string, runId: string): SessionEvent[] {
  const link: SupervisorRunLink = {
    revision: 1,
    runId: SupervisorRunId(runId),
    taskId: SupervisorTaskId(taskId),
    projectId: SupervisorProjectId('a'),
    hostSessionId: 'supervisor-project-host:a' as never,
    childSessionId: 'child-a' as never,
    executor: 'fake',
    writeAccess: true,
  }
  const row = (type: string, snapshot: Record<string, unknown>, seq: number): SessionEvent => ({
    type, seq, createdAt: new Date(0).toISOString(), data: { version: 1, snapshot },
  } as unknown as SessionEvent)
  return [
    row('supervisor/identity', { revision: 1, id: 'supervisor', sessionId: 'supervisor-main', createdAt: new Date(0).toISOString() }, 1),
    row('supervisor/project', { revision: 1, id: 'a', displayName: 'a', realPath: 'C:/projects/a', status: 'registered', registeredAt: new Date(0).toISOString() }, 2),
    row('supervisor/task', { revision: 1, id: taskId, projectId: 'a', title: 'Implement feature', description: 'Implement the feature safely', status: 'Captured', nextAction: 'Run review' }, 3),
    row('supervisor/task', { revision: 2, id: taskId, projectId: 'a', title: 'Implement feature', description: 'Implement the feature safely', status: 'Classified', nextAction: 'Run review' }, 4),
    row('supervisor/task', { revision: 3, id: taskId, projectId: 'a', title: 'Implement feature', description: 'Implement the feature safely', status: 'Ready', nextAction: 'Run review' }, 5),
    row('supervisor/task', { revision: 4, id: taskId, projectId: 'a', title: 'Implement feature', description: 'Implement the feature safely', status: 'Dispatched', nextAction: 'Run review' }, 6),
    row('supervisor/task', { revision: 5, id: taskId, projectId: 'a', title: 'Implement feature', description: 'Implement the feature safely', status: 'Running', nextAction: 'Run review' }, 7),
    row('supervisor/run-linked', link as unknown as Record<string, unknown>, 8),
  ]
}

describe('SupervisorOrchestratorService restart reconciliation', () => {
  it('keeps first-boot behavior silent when no project host is mounted', async () => {
    const { service } = await boot(autoRoute(), probeExecutor())
    const captured = await service.capture(captureRequest)
    await service.dispatch(captured.task.id)
    expect(service.getTask(captured.task.id)?.status).toBe('ReadyForReview')
    expect(notificationEvents).toHaveLength(0)
  })

  it('feeds durable run links to a mounted host at init and escalates interrupted tasks', async () => {
    const taskId = 'supervisor-task:interrupted'
    const runId = 'supervisor-run:interrupted'
    const host = {
      reconcile: vi.fn(async (recoveries: readonly { link: SupervisorRunLink; childIsLive: boolean }[]) => {
        expect(recoveries).toHaveLength(1)
        expect(String(recoveries[0]?.link.taskId)).toBe(taskId)
        expect(recoveries[0]?.childIsLive).toBe(false)
        throw Object.assign(new Error('requires explicit recovery'), { runId })
      }),
    }
    const { service, ctx } = await boot(autoRoute(), undefined, { emitProject: false })
    Object.defineProperty(ctx, 'supervisorProjectHost', { value: host })
    const events = interruptedLedger(taskId, runId)
    // Mirror production: session restore fills the central projection before
    // orchestrator init escalates interrupted tasks and feeds the host.
    ctx.supervisor.restoreLedger(events.flatMap((event) => {
      const supervisorEvent = supervisorEventFromSessionEvent(event)
      return supervisorEvent === undefined ? [] : [supervisorEvent]
    }))
    Object.defineProperty(ctx, 'supervisorSession', {
      value: { get current(): unknown { return { events } } },
    })
    // Manual construct skips Cordis lifecycle; invoke init as the plugin would.
    await service[Service.init]()
    expect(host.reconcile).toHaveBeenCalledTimes(1)
    expect(service.getTask(SupervisorTaskId(taskId))?.status).toBe('NeedsOwnerDecision')
    expect(notificationEvents).toHaveLength(1)
    expect(String(notificationEvents[0]?.snapshot.message)).toMatch(/unrecovered/)
  })
})
