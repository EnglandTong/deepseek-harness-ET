/** Host API projection for the Personal Supervisor. */
import { Context, Service } from '@deepseek-ai/cordis'
import type { SupervisorIdentitySnapshot, SupervisorNotification, SupervisorProjectSnapshot, SupervisorRunLink, SupervisorTaskId, SupervisorTaskSnapshot } from '@deepseek-ai/dsh-supervisor'
import type {} from '@deepseek-ai/dsh-tool-supervisor'
import { SupervisorApiRevisionConflictError, type SupervisorApiContract, type SupervisorApiTask, type SupervisorStatusResponse } from './types.ts'

export * from './types.ts'
export type {
  ExecutorCapabilities,
  PreparedSupervisorExecution,
  RawExecutionResult,
  SupervisorChildExecution,
  SupervisorExecutionHandle,
  SupervisorExecutionRequest,
  SupervisorExecutionResult,
  SupervisorExecutionStatus,
  SupervisorExecutorProvider,
} from './executor.ts'

declare module '@deepseek-ai/cordis' { interface Context { supervisorApi: SupervisorApiService } }

/**
 * Exposes a read-only projection and revision-guarded owner review methods.
 * Hidden reasoning, raw stderr, and project file access are intentionally not
 * part of this service.
 */
export class SupervisorApiService extends Service implements SupervisorApiContract {
  static inject = ['supervisor', 'supervisorOrchestrator', 'supervisorSession']
  /** @param ctx - context containing Supervisor services. */
  constructor(ctx: Context) { super(ctx, 'supervisorApi') }

  /** Return the detached dashboard projection for the main assistant.
   * @returns current detached dashboard projection.
   */
  status(): SupervisorStatusResponse {
    const tasks = this.orchestrator().listTasks()
    const runs = this.links()
    return {
      identity: String(this.ctx.supervisor.identity()),
      ...this.supervisorSessionId(),
      projects: this.ctx.supervisor.listProjects().map(project => ({ ...project })),
      tasks: tasks.map(task => ({ ...task, runs: runs.filter(run => run.taskId === task.id) })),
      notifications: this.notifications(),
    }
  }

  /**
   * Return the controller identity used by the transport-agnostic gateway.
   * @returns the current Supervisor identity and durable session reference.
   */
  identity(): SupervisorIdentitySnapshot {
    const session = this.ctx.get('supervisorSession')?.current
    return {
      id: this.ctx.supervisor.identity(),
      sessionId: session?.id ?? 'supervisor-main',
      revision: 1,
      createdAt: new Date(session?.header.createdAt ?? Date.now()).toISOString(),
    }
  }

  /**
   * Return detached project snapshots for the dashboard.
   * @returns registered projects.
   */
  listProjects(): readonly SupervisorProjectSnapshot[] { return this.ctx.supervisor.listProjects().map(project => ({ ...project })) }
  /**
   * Return detached task snapshots for the dashboard.
   * @returns current tasks.
   */
  listTasks(): readonly SupervisorTaskSnapshot[] { return this.orchestrator().listTasks().map(task => ({ ...task })) }
  /**
   * Return currently linked execution runs.
   * @returns linked runs.
   */
  listRuns(): readonly SupervisorRunLink[] { return this.links() }
  /**
   * Return critical notifications for the dashboard.
   * @returns pending notifications.
   */
  listNotifications(): readonly SupervisorNotification[] { return this.notifications() }
  /**
   * Resolve the read-only child session associated with a task run.
   * @param taskId - task identity.
   * @param runId - optional exact run identity.
   * @returns the child-session link, or undefined when no run matches.
   */
  childSession(taskId: string, runId?: string): {
    taskId: string
    runId: string
    sessionId: string
    parentSessionId: string
    readOnly: true
  } | undefined {
    const link = this.links().find(candidate => candidate.taskId === taskId && (runId === undefined || candidate.runId === runId))
    if (link === undefined) return undefined
    return { taskId, runId: link.runId, sessionId: link.childSessionId, parentSessionId: link.hostSessionId, readOnly: true }
  }
  /**
   * Apply a revision-guarded owner action from the client.
   * @param request - action and optimistic-concurrency revision.
   * @returns an action receipt after the request is accepted.
   */
  async action(request: { taskId: string; action: 'approve' | 'reject' | 'rework' | 'pause' | 'continue'; expectedRevision: number; feedback?: string }): Promise<{ taskId: string; revision: number; accepted: true }> {
    const task = this.task(request.taskId)
    if (task === undefined) throw new Error(`Supervisor task '${request.taskId}' was not found`)
    if (task.revision !== request.expectedRevision) throw new SupervisorApiRevisionConflictError(`task '${request.taskId}'`, request.expectedRevision, task.revision)
    const orchestrator = this.orchestrator()
    if (request.action === 'approve') await orchestrator.approveTask?.(task.id, request.expectedRevision)
    else if (request.action === 'reject') orchestrator.rejectTask?.(task.id, request.expectedRevision)
    else if (request.action === 'rework' && task.status === 'ReadyForReview') void orchestrator.review?.(task.id, request.expectedRevision, 'needs-fix')
    else throw new Error(`Supervisor action '${request.action}' is unavailable for task '${request.taskId}'`)
    const updated = this.task(request.taskId)
    return { taskId: request.taskId, revision: updated?.revision ?? request.expectedRevision, accepted: true }
  }

  /** Return one detached task and its linked execution runs.
   * @param taskId - exact task id.
   * @returns linked task or undefined.
   */
  task(taskId: string): SupervisorApiTask | undefined {
    const task = this.orchestrator().getTask(taskId as SupervisorTaskId)
    return task === undefined ? undefined : { ...task, runs: this.links().filter(run => run.taskId === task.id) }
  }

  /** Apply an owner review to a task after checking its optimistic-concurrency revision.
   * @param taskId - task id.
   * @param revision - client revision.
   * @param outcome - owner review result.
   * @returns updated task.
   */
  async review(taskId: string, revision: number, outcome: 'accepted' | 'needs-fix'): Promise<SupervisorTaskSnapshot> {
    const current = this.task(taskId)
    if (current === undefined) throw new Error(`Supervisor task '${taskId}' was not found`)
    if (current.revision !== revision) throw new SupervisorApiRevisionConflictError(`task '${taskId}'`, revision, current.revision)
    const orchestrator = this.orchestrator()
    if (orchestrator.review === undefined) throw new Error('Supervisor review operation is unavailable')
    return await orchestrator.review(current.id, revision, outcome)
  }

  private orchestrator(): OrchestratorApiLike { return this.ctx.get('supervisorOrchestrator') as unknown as OrchestratorApiLike }
  private notifications(): readonly SupervisorNotification[] {
    const interaction = this.ctx.get('supervisorInteraction')
    return interaction?.listNotifications().map(notification => ({ ...notification })) ?? []
  }
  private supervisorSessionId(): { readonly supervisorSessionId?: string } {
    const service = this.ctx.get('supervisorSession') as { current?: { id: string } } | undefined
    const id = service?.current?.id
    return id === undefined ? {} : { supervisorSessionId: id }
  }
  private links(): readonly SupervisorRunLink[] {
    const memory = this.ctx.get('supervisorMemory') as { project?: () => { supervisor: { runs: ReadonlyMap<string, SupervisorRunLink> } } } | undefined
    const projection = memory?.project?.()
    return projection === undefined ? [] : [...projection.supervisor.runs.values()].map(link => ({ ...link }))
  }
}

interface OrchestratorApiLike {
  listTasks(): readonly SupervisorTaskSnapshot[]
  getTask(taskId: SupervisorTaskId): SupervisorTaskSnapshot | undefined
  review?: (taskId: SupervisorTaskId, revision: number, outcome: 'accepted' | 'needs-fix') => Promise<SupervisorTaskSnapshot> | SupervisorTaskSnapshot
  approveTask?: (taskId: SupervisorTaskId, revision: number) => Promise<unknown>
  rejectTask?: (taskId: SupervisorTaskId, revision: number) => void
}

export default SupervisorApiService
