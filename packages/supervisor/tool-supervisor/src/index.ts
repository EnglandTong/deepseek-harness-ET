/** Personal Supervisor human commands, critical notifications, and `@总控` delivery. */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandDefinition, CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { SupervisorProjectId, SupervisorTaskId, type SupervisorNotification, type SupervisorTaskSnapshot } from '@deepseek-ai/dsh-supervisor'
import type { SupervisorCaptureRequest } from '@deepseek-ai/dsh-supervisor-orchestrator'
import type {} from '@deepseek-ai/dsh-supervisor-project-registry'
import type {} from '@deepseek-ai/dsh-supervisor-session'
import type { PermissionCeiling, ResolvedRouteDecision, RouteRequest } from '@deepseek-ai/dsh-supervisor-routing-policy'
import { assertSupervisorIntake, assertSupervisorInteractionNotification } from './invariant.ts'
import type {
  SupervisorIntakeRequest,
  SupervisorIntakeResult,
  SupervisorInteractionNotification,
  SupervisorInteractionOrchestrator,
  SupervisorStatusView,
} from './types.ts'

export * from './invariant.ts'
export * from './types.ts'

/** Cordis loader name. */
export const name = 'tool-supervisor'
/** Services required by the command and delivery adapter. */
export const inject = ['commands', 'agents', 'supervisor', 'supervisorSession', 'supervisorOrchestrator', 'supervisorProjectRegistry']

const PLUGIN_ID = '@deepseek-ai/dsh-tool-supervisor'
const NO_ARGS = 'This command does not accept arguments.'

declare module '@deepseek-ai/cordis' {
  interface Context { supervisorInteraction: SupervisorInteractionRuntime }
}

/** Runtime options for notification forwarding. */
export interface SupervisorInteractionConfig {
  /** Whether critical notifications wake the singleton controller. */
  readonly wakeupOnNotification?: boolean
}

/** Loader schema for notification wakeup behavior. */
export const Config: z<SupervisorInteractionConfig> = z.object({
  wakeupOnNotification: z.boolean().default(false),
})

/** Result of one route-only command evaluation. */
export interface SupervisorRouteView {
  /** Task whose policy is being evaluated. */
  readonly taskId: SupervisorTaskId
  /** Explainable route decision returned by the active policy provider. */
  readonly decision: ResolvedRouteDecision
}

/**
 * Owns human command registration and the process-local notification projection.
 * It never changes project files and never turns a child report into acceptance.
 */
export class SupervisorInteractionRuntime {
  private readonly notificationsByKey = new Map<string, SupervisorInteractionNotification>()
  private readonly notificationListeners = new Set<(notification: SupervisorInteractionNotification) => void>()
  private readonly seenIntakes = new Set<string>()
  private disposed = false

  /** @param ctx - context containing the singleton Supervisor services. @param config - notification delivery policy. */
  constructor(private readonly ctx: Context, private readonly config: SupervisorInteractionConfig = {}) {}

  /**
   * Accept one mention from another conversation. A message id is committed
   * before delivery, so retries cannot send the same intake twice.
   * @param request - source identity, stable message id, and mention text.
   * @returns accepted, queued, or duplicate delivery observation.
   */
  receiveIntake(request: SupervisorIntakeRequest): SupervisorIntakeResult {
    this.assertLive()
    assertSupervisorIntake(request)
    const supervisorSession = this.ctx.supervisorSession.current
    if (supervisorSession === undefined) throw new Error('the Supervisor singleton Session is not ready')
    if (this.seenIntakes.has(request.messageId) || this.sessionContainsIntake(supervisorSession, request.messageId)) {
      this.seenIntakes.add(request.messageId)
      return { status: 'duplicate', messageId: request.messageId, supervisorSessionId: supervisorSession.id }
    }
    this.seenIntakes.add(request.messageId)
    const message = this.intakeMessage(request)
    const main = this.mainAgent(supervisorSession)
    if (main !== undefined) {
      main.send(message, 'next-turn', request.wakeup ?? true)
      return { status: 'accepted', messageId: request.messageId, supervisorSessionId: supervisorSession.id }
    }
    // A cold controller has no inbox object. Appending a normal user/message
    // keeps the intake in the controller log so a later Agent resume sees it.
    supervisorSession.append('user/message', message, { surfaceOp: 'append' })
    return { status: 'queued', messageId: request.messageId, supervisorSessionId: supervisorSession.id }
  }

  /**
   * Return coalesced critical notifications in first-seen order.
   * @returns notifications.
   */
  listNotifications(): readonly SupervisorInteractionNotification[] {
    return [...this.notificationsByKey.values()].map(item => ({ ...item }))
  }

  /**
   * Return notifications not acknowledged by this runtime instance.
   * @returns unread notifications.
   */
  listUnreadNotifications(): readonly SupervisorInteractionNotification[] {
    return this.listNotifications().filter(item => item.unread)
  }

  /**
   * Mark a notification key read for this process. The durable Supervisor
   * event remains unchanged; a later projection can restore its unread fact.
   * @param id - notification id to acknowledge.
   * @returns whether a notification was found.
   */
  acknowledge(id: string): boolean {
    for (const [key, notification] of this.notificationsByKey) {
      if (String(notification.id) !== id) continue
      this.notificationsByKey.set(key, { ...notification, unread: false })
      return true
    }
    return false
  }

  /**
   * Register a listener for coalesced critical notifications.
   * @param listener - receives each notification.
   * @returns disposer.
   */
  onNotification(listener: (notification: SupervisorInteractionNotification) => void): () => void {
    this.notificationListeners.add(listener)
    return () => { this.notificationListeners.delete(listener) }
  }

  /**
   * Return a bounded status view for the main assistant and UI.
   * @returns status view.
   */
  status(): SupervisorStatusView {
    const tasks = this.orchestrator.listTasks()
    const taskStates: Record<string, number> = {}
    for (const task of tasks) taskStates[task.status] = (taskStates[task.status] ?? 0) + 1
    return {
      identity: String(this.ctx.supervisor.identity()),
      ...(this.ctx.supervisorSession.current?.id === undefined
        ? {}
        : { supervisorSessionId: String(this.ctx.supervisorSession.current.id) }),
      projects: this.ctx.supervisor.listProjects().length,
      tasks: tasks.length,
      unreadNotifications: this.listUnreadNotifications().length,
      taskStates,
    }
  }

  /**
   * Handle one emitted durable critical notification.
   * @param event - notification event.
   */
  handleNotification(event: { readonly snapshot: SupervisorNotification }): void {
    this.assertLive()
    const snapshot = event.snapshot
    const key = `${String(snapshot.projectId ?? '')}\u0000${String(snapshot.taskId ?? '')}\u0000${snapshot.kind}`
    const previous = this.notificationsByKey.get(key)
    // Re-emitting the same durable notification id is a replay duplicate;
    // distinct ids with equivalent content are coalesced and counted.
    if (previous !== undefined && previous.id === snapshot.id
      && previous.message === snapshot.message && previous.unread === snapshot.unread) return
    const notification: SupervisorInteractionNotification = {
      ...snapshot,
      count: (previous?.count ?? 0) + 1,
    }
    assertSupervisorInteractionNotification(notification)
    this.notificationsByKey.set(key, notification)
    for (const listener of this.notificationListeners) listener(notification)
    this.forwardNotification(notification)
  }

  /** Dispose local listeners and reject future external intake. */
  dispose(): void {
    this.disposed = true
    this.notificationListeners.clear()
  }

  private forwardNotification(notification: SupervisorInteractionNotification): void {
    const session = this.ctx.supervisorSession.current
    if (session === undefined) return
    const main = this.mainAgent(session)
    if (main === undefined) return
    const summary = `${notification.kind}: ${notification.message}${notification.count > 1 ? ` (${notification.count} equivalent notices)` : ''}`
    const message = createUserMessage({
      source: { kind: 'plugin', plugin: PLUGIN_ID, form: 'notice', summary: summary.slice(0, 120) },
      content: [{ type: 'text', text: `[Supervisor notification] ${summary}` }],
    })
    if (this.config.wakeupOnNotification === true) main.send(message, 'next-step', true)
    else main.inject(message)
  }

  private intakeMessage(request: SupervisorIntakeRequest): ReturnType<typeof createUserMessage> {
    const text = `[Supervisor intake id=${request.messageId} source=${String(request.sourceSessionId)}]\n${request.text.trim()}`
    return createUserMessage({
      source: { kind: 'plugin', plugin: PLUGIN_ID, form: 'relay' },
      content: [{ type: 'text', text }],
    })
  }

  private sessionContainsIntake(session: Session, messageId: string): boolean {
    const marker = `[Supervisor intake id=${messageId} `
    return session.events.some(event => event.type === 'user/message'
      && event.data.content.some(block => block.type === 'text' && block.text.includes(marker)))
  }

  private mainAgent(session: Session): Agent | undefined {
    return this.ctx.agents.get(session.id)
  }

  /**
   * Return the installed orchestrator through its stable public subset.
   * @returns orchestrator view.
   */
  get orchestrator(): SupervisorInteractionOrchestrator {
    return this.ctx.supervisorOrchestrator
  }

  private assertLive(): void {
    if (this.disposed) throw new Error('Supervisor interaction runtime is disposed')
  }
}

function result(text: string): CommandResult { return { kind: 'success', text } }
function failure(error: unknown): CommandResult { return { kind: 'error', text: error instanceof Error ? error.message : String(error) } }

function argsOrUsage(rawInput: string, usage: string): string | CommandResult {
  const input = rawInput.trim()
  return input.length === 0 ? { kind: 'error', text: usage } : input
}

function parseIdAndRevision(rawInput: string, usage: string): { id: SupervisorTaskId; revision: number } | CommandResult {
  const parts = rawInput.trim().split(/\s+/u)
  if (parts.length < 1 || parts[0] === '') return { kind: 'error', text: usage }
  if (parts.length !== 2 || parts[1] === undefined || !/^\d+$/u.test(parts[1])) return { kind: 'error', text: usage }
  const taskToken = parts[0]
  if (taskToken === undefined) return { kind: 'error', text: usage }
  return { id: SupervisorTaskId(taskToken), revision: Number(parts[1]) }
}

function requireNoArgs(invocation: CommandInvocation): CommandResult | undefined {
  return invocation.rawInput.trim().length === 0 ? undefined : { kind: 'error', text: NO_ARGS }
}

function renderTask(task: SupervisorTaskSnapshot): string {
  return `${task.id} [${task.status}] ${task.title}\nproject=${task.projectId}; revision=${task.revision}; next=${task.nextAction}${task.blocker === undefined ? '' : `; blocker=${task.blocker}`}`
}

function routeView(ctx: Context, rawInput: string): CommandResult {
  const parsed = argsOrUsage(rawInput, 'Usage: /supervisor_route <taskId> [high-risk]')
  if (typeof parsed !== 'string') return parsed
  const taskToken = parsed.split(/\s+/u)[0]
  if (taskToken === undefined || taskToken.length === 0) return { kind: 'error', text: 'A task id is required.' }
  const taskId = SupervisorTaskId(taskToken)
  const task = ctx.supervisorOrchestrator.getTask(taskId)
  if (task === undefined) return { kind: 'error', text: `Task '${taskId}' was not found.` }
  const router = ctx.supervisor.listRouters().find(candidate => typeof (candidate as { resolve?: unknown }).resolve === 'function') as { resolve(request: RouteRequest): ResolvedRouteDecision } | undefined
  if (router === undefined) return { kind: 'error', text: 'No Supervisor routing provider is available.' }
  const project = ctx.supervisor.getProject(task.projectId)
  const highRisk = parsed.split(/\s+/u).slice(1).some(value => value.toLowerCase() === 'high-risk')
  const decision = router.resolve({ taskId, projectId: task.projectId, ...(project?.realPath === undefined ? {} : { projectPath: project.realPath }), taskType: 'supervisor-command', highRisk })
  return result(`Route for ${taskId}: ${decision.decision.executor}${decision.decision.model === undefined ? '' : `/${decision.decision.model}`}\napproval=${decision.approval}; dispatchable=${decision.dispatchable}; reason=${decision.decision.reason}`)
}

function registerDefinitions(ctx: Context, runtime: SupervisorInteractionRuntime): readonly CommandDefinition[] {
  const command = (name: string, description: string, handler: CommandDefinition['handler'], input?: string): CommandDefinition => ({ name, description, ...(input === undefined ? {} : { input: { hint: input } }), handler })
  return [
    command('supervisor_status', 'show Personal Supervisor status', (invocation) => { const invalid = requireNoArgs(invocation); return invalid ?? result(renderStatus(runtime.status())) }),
    command('supervisor_projects', 'list registered Supervisor projects', (invocation) => { const invalid = requireNoArgs(invocation); if (invalid !== undefined) return invalid; return result(ctx.supervisor.listProjects().map(project => `${project.id} [${project.status}] ${project.displayName} — ${project.realPath}`).join('\n') || 'No projects are registered.') }),
    command('supervisor_tasks', 'list Supervisor tasks and their next actions', (invocation) => { const invalid = requireNoArgs(invocation); if (invalid !== undefined) return invalid; const tasks = runtime.orchestrator.listTasks(); return result(tasks.map(renderTask).join('\n') || 'No Supervisor tasks are captured.') }),
    command('supervisor_register_project', 'register one confirmed project path', invocation => executeRegister(ctx, invocation), '<path> [display name]'),
    command('supervisor_route', 'evaluate the current route for a Supervisor task', invocation => routeView(ctx, invocation.rawInput), '<taskId> [high-risk]'),
    command('supervisor_approve', 'approve one grouped Supervisor route', invocation => executeApproval(runtime, invocation, true), '<approvalBatchId>'),
    command('supervisor_reject', 'reject one grouped Supervisor route', invocation => executeApproval(runtime, invocation, false), '<approvalBatchId>'),
    command('supervisor_dispatch', 'dispatch one ready Supervisor task', invocation => executeDispatch(runtime, invocation), '<taskId> <revision>'),
    command('supervisor_followup', 'send an owner follow-up to one task', invocation => executeFollowUp(runtime, invocation), '<taskId> <revision> <next action> :: <message>'),
    command('supervisor_interrupt', 'interrupt one exact Supervisor run', invocation => executeInterrupt(runtime, invocation), '<taskId>'),
    command('supervisor_cancel', 'cancel one exact Supervisor run', invocation => executeInterrupt(runtime, invocation), '<taskId>'),
    command('supervisor_capture', 'capture one new Supervisor task for a registered project', invocation => executeCapture(runtime, invocation), '<projectId> <title> :: <description> :: <next action> [--high-risk] [--perm=<ceiling>]'),
    command('supervisor_review', 'record an owner review outcome', invocation => executeReview(runtime, invocation), '<taskId> <revision> accept|needs-fix'),
  ]
}

function renderStatus(view: SupervisorStatusView): string {
  const states = Object.entries(view.taskStates).map(([state, count]) => `${state}=${count}`).join(', ') || 'none'
  return `Supervisor ${view.identity} (session ${view.supervisorSessionId ?? 'not ready'})\nprojects=${view.projects}; tasks=${view.tasks}; unread notifications=${view.unreadNotifications}\nstates: ${states}`
}

function executeRegister(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const parsed = argsOrUsage(invocation.rawInput, 'Usage: /supervisor_register_project <path> [display name]')
  if (typeof parsed !== 'string') return Promise.resolve(parsed)
  const match = /^(?:"([^"]+)"|'([^']+)'|(\S+))(?:\s+([\s\S]*))?$/u.exec(parsed)
  if (match === null) return Promise.resolve({ kind: 'error', text: 'A project path is required.' })
  const path = match[1] ?? match[2] ?? match[3]
  if (path === undefined || path.length === 0) return Promise.resolve({ kind: 'error', text: 'A project path is required.' })
  const label = match[4]?.trim()
  return ctx.supervisorProjectRegistry.registerProject(path, label === undefined || label.length === 0 ? undefined : label)
    .then(project => result(`Registered ${project.displayName} (${project.id}) at ${project.realPath}.`))
    .catch(failure)
}

function executeApproval(runtime: SupervisorInteractionRuntime, invocation: CommandInvocation, approve: boolean): Promise<CommandResult> {
  const parsed = argsOrUsage(invocation.rawInput, `Usage: /supervisor_${approve ? 'approve' : 'reject'} <approvalBatchId>`)
  if (typeof parsed !== 'string') return Promise.resolve(parsed)
  if (!approve) {
    runtime.orchestrator.reject(parsed)
    return Promise.resolve(result(`Rejected ${parsed}.`)).catch(failure)
  }
  return runtime.orchestrator.approve(parsed)
    .then(started => result(`Approved ${parsed}; started ${started.length} task run(s).`))
    .catch(failure)
}

function executeDispatch(runtime: SupervisorInteractionRuntime, invocation: CommandInvocation): Promise<CommandResult> {
  const parsed = parseIdAndRevision(invocation.rawInput, 'Usage: /supervisor_dispatch <taskId> <revision>')
  if ('kind' in parsed) return Promise.resolve(parsed)
  return runtime.orchestrator.dispatch(parsed.id, parsed.revision).then(value => result(`Dispatched ${parsed.id} as ${value.runId}.`)).catch(failure)
}

function executeFollowUp(runtime: SupervisorInteractionRuntime, invocation: CommandInvocation): Promise<CommandResult> {
  const match = /^(\S+)\s+(\d+)\s+(.+?)\s+::\s+([\s\S]+)$/u.exec(invocation.rawInput.trim())
  if (match === null || match[1] === undefined || match[2] === undefined || match[3] === undefined || match[4] === undefined) return Promise.resolve({ kind: 'error', text: 'Usage: /supervisor_followup <taskId> <revision> <next action> :: <message>' })
  const prompt: ContentBlock[] = [{ type: 'text', text: match[4].trim() }]
  return runtime.orchestrator.followUp({ taskId: SupervisorTaskId(match[1]), expectedRevision: Number(match[2]), prompt, nextAction: match[3].trim() }).then(value => result(`Follow-up accepted for ${value.task.id}; started ${value.runId}.`)).catch(failure)
}

const CAPTURE_USAGE = 'Usage: /supervisor_capture <projectId> <title> :: <description> :: <next action> [--high-risk] [--perm=<ceiling>]'
const HIGH_RISK_FLAG = /(?:^|\s)--high-risk(?=\s|$)/u
const PERMISSION_FLAG = /(?:^|\s)--perm=(none|read|write|execute|admin)(?=\s|$)/u

function executeCapture(runtime: SupervisorInteractionRuntime, invocation: CommandInvocation): Promise<CommandResult> {
  const orchestrator = runtime.orchestrator
  if (orchestrator.capture === undefined) return Promise.resolve({ kind: 'error', text: 'Capture is not available in the mounted orchestrator.' })
  let input = invocation.rawInput.trim()
  const highRisk = HIGH_RISK_FLAG.test(input)
  input = input.replace(HIGH_RISK_FLAG, ' ').trim()
  const permissionMatch = PERMISSION_FLAG.exec(input)
  if (permissionMatch === null && /(?:^|\s)--perm=/u.test(input)) return Promise.resolve({ kind: 'error', text: CAPTURE_USAGE })
  const permission = (permissionMatch?.[1] ?? 'read') as PermissionCeiling
  input = input.replace(PERMISSION_FLAG, ' ').trim()
  const sections = input.split(/\s+::\s+/u).map(section => section.trim())
  if (sections.length !== 3 || sections.some(section => section.length === 0)) return Promise.resolve({ kind: 'error', text: CAPTURE_USAGE })
  const head = sections[0]
  const description = sections[1]
  const nextAction = sections[2]
  if (head === undefined || description === undefined || nextAction === undefined) return Promise.resolve({ kind: 'error', text: CAPTURE_USAGE })
  const headMatch = /^(\S+)\s+([\s\S]+)$/u.exec(head)
  if (headMatch === null || headMatch[1] === undefined || headMatch[2] === undefined) return Promise.resolve({ kind: 'error', text: CAPTURE_USAGE })
  const title = headMatch[2].trim()
  const request: SupervisorCaptureRequest = {
    projectId: SupervisorProjectId(headMatch[1]),
    title,
    description,
    nextAction,
    prompt: [{ type: 'text', text: `${title}\n\n${description}` }],
    parent: invocation.agent,
    route: { taskType: 'supervisor-command', requestedPermission: permission, ...(highRisk ? { highRisk: true } : {}) },
    permission,
  }
  return orchestrator.capture(request).then((captured) => {
    const lines = [`Captured ${captured.task.id} [${captured.task.status}] ${captured.task.title}`,
      `project=${captured.task.projectId}; revision=${captured.task.revision}; route=${captured.route.decision.executor}; approval=${captured.route.approval}`]
    if (captured.approvalBatchId !== undefined) lines.push(`Owner approval required: /supervisor_approve ${captured.approvalBatchId} or /supervisor_reject ${captured.approvalBatchId}`)
    return result(lines.join('\n'))
  }).catch(failure)
}

function executeInterrupt(runtime: SupervisorInteractionRuntime, invocation: CommandInvocation): Promise<CommandResult> {
  const parsed = argsOrUsage(invocation.rawInput, 'Usage: /supervisor_interrupt <taskId>')
  if (typeof parsed !== 'string') return Promise.resolve(parsed)
  const taskToken = parsed.split(/\s+/u)[0]
  if (taskToken === undefined || taskToken.length === 0) return Promise.resolve({ kind: 'error', text: 'A task id is required.' })
  return runtime.orchestrator.interrupt(SupervisorTaskId(taskToken)).then(() => result(`Interrupted ${taskToken}.`)).catch(failure)
}

function executeReview(runtime: SupervisorInteractionRuntime, invocation: CommandInvocation): Promise<CommandResult> {
  const parts = invocation.rawInput.trim().split(/\s+/u)
  if (parts.length !== 3 || parts[0] === undefined || parts[1] === undefined || parts[2] === undefined || !/^\d+$/u.test(parts[1]) || !['accept', 'needs-fix'].includes(parts[2])) return Promise.resolve({ kind: 'error', text: 'Usage: /supervisor_review <taskId> <revision> accept|needs-fix' })
  const orchestrator = runtime.orchestrator
  if (orchestrator.review === undefined) return Promise.resolve({ kind: 'error', text: 'Review recording is not available in the mounted orchestrator.' })
  const outcome = parts[2] === 'accept' ? 'accepted' : 'needs-fix'
  return Promise.resolve(orchestrator.review(SupervisorTaskId(parts[0]), Number(parts[1]), outcome)).then(task => result(`Review recorded: ${renderTask(task)}.`)).catch(failure)
}

/** Register all Supervisor commands and the singleton notification listener. */
export function apply(ctx: Context, config: SupervisorInteractionConfig = {}): void {
  const runtime = new SupervisorInteractionRuntime(ctx, config)
  ctx.accessor('supervisorInteraction', { get: () => runtime })
  ctx.on('supervisor/notification', (event) => { runtime.handleNotification(event) })
  ctx.on('agent/created', ({ agent }) => {
    const session = ctx.supervisorSession.current
    if (session === undefined || agent.id !== session.id) return
    // Cold intakes were appended to the Session log and do not need replay.
    // The normal Agent startup derives them from user/message events.
  })
  ctx.effect(() => {
    const disposers = registerDefinitions(ctx, runtime).map(definition => ctx.commands.register(definition))
    return () => { runtime.dispose(); for (const dispose of disposers) dispose() }
  }, 'tool-supervisor lifecycle')
}
