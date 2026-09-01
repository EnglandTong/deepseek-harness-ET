import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SupervisorService, { SupervisorProjectId, SupervisorTaskId } from '@deepseek-ai/dsh-supervisor'
import type { SupervisorCaptureRequest } from '@deepseek-ai/dsh-supervisor-orchestrator'
import { apply } from '../src/index.ts'
import type { SupervisorInteractionOrchestrator } from '../src/types.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

function agent(ctx: Context, id: string): Agent {
  const session = ctx.sessions.get(SessionId(id)) ?? ctx.sessions.create(SessionId(id))
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  let status: AgentStatus = 'idle'
  return {
    id: session.id, options: {}, session, inbox, ctx: new Context(), get status() { return status },
    send(message, target, wakeup) { inbox.append(target, message); if (wakeup) status = 'running' },
    followup: (message) =>{  inbox.append('next-turn', message) }, steer: (message) =>{  inbox.append('next-step', message) }, inject: (message) =>{  inbox.append('next-step', message) },
    cancel: () => { status = 'idle' }, runMaintenance: task => task(new AbortController().signal), whenIdle: () => Promise.resolve(),
  }
}

function task(id = 'task-a') {
  return { id: SupervisorTaskId(id), revision: 1, projectId: SupervisorProjectId('project-a'), title: 'Build', description: 'Build it', status: 'Ready' as const, nextAction: 'Review' }
}

async function boot(orchestrator: Partial<SupervisorInteractionOrchestrator> = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SupervisorService)
  const mainSession = ctx.sessions.create(SessionId('supervisor-main'))
  Object.defineProperty(ctx, 'supervisorSession', { value: { current: mainSession } })
  Object.defineProperty(ctx, 'supervisorOrchestrator', { value: {
    listTasks: () => [task()], getTask: () => task(), listApprovalBatches: () => [],
    approve: vi.fn(async () => []), reject: vi.fn(), dispatch: vi.fn(async () => ({ task: task(), runId: 'run-a' })),
    followUp: vi.fn(async () => ({ task: task(), runId: 'run-b' })), interrupt: vi.fn(async () => undefined), ...orchestrator,
  } })
  Object.defineProperty(ctx, 'supervisorProjectRegistry', { value: { list: () => [], registerProject: vi.fn(async () => ({ id: SupervisorProjectId('project-a'), displayName: 'A', realPath: 'C:/a', status: 'registered' })) } })
  ctx.emit('supervisor/project', { type: 'supervisor/project', version: 1, snapshot: { id: SupervisorProjectId('project-a'), revision: 1, displayName: 'A', realPath: 'C:/a', status: 'registered', registeredAt: new Date(0).toISOString() } })
  apply(ctx)
  return { ctx, main: agent(ctx, 'supervisor-main') }
}

describe('tool-supervisor command registration', () => {
  it('registers all command names and dispatches a real status command', async () => {
    const h = await boot()
    h.ctx.agents.register(h.main)
    const names = h.ctx.commands.list(h.main).map(command => command.name)
    expect(names).toEqual([
      'supervisor_approve', 'supervisor_cancel', 'supervisor_capture', 'supervisor_dispatch', 'supervisor_followup', 'supervisor_interrupt',
      'supervisor_projects', 'supervisor_register_project', 'supervisor_reject', 'supervisor_review', 'supervisor_route', 'supervisor_status', 'supervisor_tasks',
    ])
    await expect(h.ctx.commands.execute(h.main, '/supervisor_status', [], new AbortController().signal)).resolves.toMatchObject({ result: { kind: 'success', text: expect.stringContaining('projects=1') as string } })
  })

  it('requires the task revision for dispatch and forwards a valid revision', async () => {
    const dispatch = vi.fn(async () => ({ task: task(), runId: 'run-a' }))
    const h = await boot({ dispatch })
    h.ctx.agents.register(h.main)
    await expect(h.ctx.commands.execute(h.main, '/supervisor_dispatch task-a 4', [], new AbortController().signal)).resolves.toMatchObject({ result: { kind: 'success' } })
    expect(dispatch).toHaveBeenCalledWith(SupervisorTaskId('task-a'), 4)
  })
})

describe('supervisor_capture and supervisor_review commands', () => {
  function captureRoute(approval: 'auto' | 'confirm') {
    return {
      decision: { taskId: SupervisorTaskId('task-a'), policyVersion: 'policy-v1', executor: 'subagent', provider: 'deepseek', fallback: [] as readonly string[], reason: 'matched default rule', costTier: 'free' as const, requiresApproval: approval === 'confirm' },
      policyHash: 'hash-v1', approval, dispatchable: approval === 'auto', permissionCeiling: 'write' as const, timeoutMs: 0, fallbackUsed: false,
    }
  }

  it('parses sections and flags and forwards the receiving agent as parent', async () => {
    let received: SupervisorCaptureRequest | undefined
    const capture = vi.fn(async (request: SupervisorCaptureRequest) => {
      received = request
      return { task: { ...task(), status: 'AwaitingApproval' as const }, route: captureRoute('confirm'), approvalBatchId: 'approval:batch-a' }
    })
    const h = await boot({ capture })
    h.ctx.agents.register(h.main)
    await expect(h.ctx.commands.execute(h.main, '/supervisor_capture project-a Fix login :: Session cookie expires :: Rotate the cookie and retest --high-risk --perm=write', [], new AbortController().signal))
      .resolves.toMatchObject({ result: { kind: 'success', text: expect.stringContaining('Owner approval required: /supervisor_approve approval:batch-a') as string } })
    expect(capture).toHaveBeenCalledTimes(1)
    expect(received).toEqual({
      projectId: SupervisorProjectId('project-a'),
      title: 'Fix login',
      description: 'Session cookie expires',
      nextAction: 'Rotate the cookie and retest',
      prompt: [{ type: 'text', text: 'Fix login\n\nSession cookie expires' }],
      parent: h.main,
      route: { taskType: 'supervisor-command', requestedPermission: 'write', highRisk: true },
      permission: 'write',
    })
  })

  it('defaults to read permission and omits the high-risk flag unless requested', async () => {
    let received: SupervisorCaptureRequest | undefined
    const capture = vi.fn(async (request: SupervisorCaptureRequest) => { received = request; return { task: task(), route: captureRoute('auto') } })
    const h = await boot({ capture })
    h.ctx.agents.register(h.main)
    await expect(h.ctx.commands.execute(h.main, '/supervisor_capture project-a Refresh docs :: Update the README :: Open a review', [], new AbortController().signal))
      .resolves.toMatchObject({ result: { kind: 'success', text: expect.not.stringContaining('Owner approval required') as string } })
    expect(received).toMatchObject({ permission: 'read', route: { taskType: 'supervisor-command', requestedPermission: 'read' } })
    expect(received?.route).not.toHaveProperty('highRisk')
  })

  it('rejects malformed capture input and unknown permission values with usage text', async () => {
    const capture = vi.fn()
    const h = await boot({ capture })
    h.ctx.agents.register(h.main)
    const signal = new AbortController().signal
    await expect(h.ctx.commands.execute(h.main, '/supervisor_capture project-a Only a title', [], signal)).resolves.toMatchObject({ result: { kind: 'error', text: expect.stringContaining('Usage: /supervisor_capture') as string } })
    await expect(h.ctx.commands.execute(h.main, '/supervisor_capture project-a T :: D :: N --perm=root', [], signal)).resolves.toMatchObject({ result: { kind: 'error', text: expect.stringContaining('Usage: /supervisor_capture') as string } })
    expect(capture).not.toHaveBeenCalled()
  })

  it('reports when the mounted orchestrator cannot capture', async () => {
    const h = await boot()
    h.ctx.agents.register(h.main)
    await expect(h.ctx.commands.execute(h.main, '/supervisor_capture project-a T :: D :: N', [], new AbortController().signal))
      .resolves.toMatchObject({ result: { kind: 'error', text: expect.stringContaining('Capture is not available') as string } })
  })

  it('maps the accept token to the accepted review outcome', async () => {
    const review = vi.fn(async () => ({ ...task(), status: 'Accepted' as const }))
    const h = await boot({ review })
    h.ctx.agents.register(h.main)
    await expect(h.ctx.commands.execute(h.main, '/supervisor_review task-a 3 accept', [], new AbortController().signal))
      .resolves.toMatchObject({ result: { kind: 'success', text: expect.stringContaining('Review recorded') as string } })
    expect(review).toHaveBeenCalledWith(SupervisorTaskId('task-a'), 3, 'accepted')
  })
})

describe('Supervisor intake and notification behavior', () => {
  it('deduplicates @总控 messages and persists cold delivery for resume', async () => {
    const h = await boot()
    const runtime = h.ctx.supervisorInteraction
    const first = runtime.receiveIntake({ messageId: 'm-1', sourceSessionId: SessionId('source'), text: 'check all projects' })
    const second = runtime.receiveIntake({ messageId: 'm-1', sourceSessionId: SessionId('source'), text: 'check all projects' })
    expect(first.status).toBe('queued')
    expect(second.status).toBe('duplicate')
    expect(h.ctx.supervisorSession.current?.events.some(event => event.type === 'user/message' && event.data.content.some(block => block.type === 'text' && block.text.includes('m-1')))).toBe(true)
  })

  it('sends a live intake once and coalesces repeated critical notices', async () => {
    const h = await boot()
    h.ctx.agents.register(h.main)
    const runtime = h.ctx.supervisorInteraction
    const first = runtime.receiveIntake({ messageId: 'm-2', sourceSessionId: SessionId('source'), text: 'status', wakeup: false })
    const second = runtime.receiveIntake({ messageId: 'm-2', sourceSessionId: SessionId('source'), text: 'status', wakeup: false })
    expect(first.status).toBe('accepted')
    expect(second.status).toBe('duplicate')
    const notice = { type: 'supervisor/notification' as const, version: 1 as const, snapshot: { id: 'notification-a' as never, revision: 1, taskId: SupervisorTaskId('task-a'), projectId: SupervisorProjectId('project-a'), kind: 'blocked' as const, message: 'same', unread: true, createdAt: new Date(0).toISOString() } }
    runtime.handleNotification(notice)
    runtime.handleNotification({ ...notice, snapshot: { ...notice.snapshot, id: 'notification-b' as never } })
    expect(runtime.listNotifications()).toHaveLength(1)
    expect(runtime.listNotifications()[0]?.count).toBe(2)
    expect(h.main.inbox.hasPending).toBe(true)
  })

  it('rejects blank intake before touching the singleton log', async () => {
    const h = await boot()
    const runtime = h.ctx.supervisorInteraction
    expect(() => runtime.receiveIntake({ messageId: 'm-3', sourceSessionId: SessionId('source'), text: ' ' })).toThrow(/text must be a non-empty string/)
    expect(h.ctx.supervisorSession.current?.events.some(event => event.type === 'user/message')).toBe(false)
  })
})
