/** Personal Supervisor orchestration service with bounded, revision-safe control flow. */

import { createHash, randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-supervisor-session'
import type {
  ResolvedRouteDecision,
  RouteRequest,
} from '@deepseek-ai/dsh-supervisor-routing-policy'
import type { SupervisorExecutionHandle, SupervisorExecutionResult } from '@deepseek-ai/dsh-supervisor-executor-subagent'
import type { SupervisorRouter } from '@deepseek-ai/dsh-supervisor'
import {
  SupervisorRunId,
  SupervisorTaskId,
  SUPERVISOR_EVENT_VERSION,
  foldSupervisor,
  supervisorEventFromSessionEvent,
  type SupervisorNotification,
  type SupervisorPolicyApplied,
  type SupervisorTaskSnapshot,
} from '@deepseek-ai/dsh-supervisor'
import { SupervisorOrchestratorError } from './error.ts'
import { assertOrchestrationRun, assertOrchestrationTask } from './invariant.ts'
import type {
  SupervisorApprovalBatch,
  SupervisorCaptureRequest,
  SupervisorCaptureResult,
  SupervisorDispatchResult,
  SupervisorFollowUpRequest,
  SupervisorNotificationListener,
  SupervisorOrchestratorConfig,
  SupervisorOrchestratorNotification,
  SupervisorRunResult,
} from './types.ts'

export * from './error.ts'
export * from './invariant.ts'
export * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { supervisorOrchestrator: SupervisorOrchestratorService }
}

interface TaskRecord {
  snapshot: SupervisorTaskSnapshot
  capture: SupervisorCaptureRequest | undefined
  route: ResolvedRouteDecision | undefined
  attempts: number
  signatures: Set<string>
  active: { runId: ReturnType<typeof SupervisorRunId>; controller: AbortController; handle?: SupervisorExecutionHandle } | undefined
}

/** Route provider extension used by the orchestration service. */
interface ResolvingRouter extends SupervisorRouter {
  resolve(request: RouteRequest): ResolvedRouteDecision
}

/**
 * Captures main-assistant requests, obtains policy decisions, and drives child
 * execution through one bounded repair loop. It never edits project files or
 * claims owner acceptance.
 */
export class SupervisorOrchestratorService extends Service {
  static inject = ['supervisor', 'supervisorExecutors', 'supervisorSession']

  /** Runtime bounds are profile configuration, not source-level policy. */
  static Config: z<SupervisorOrchestratorConfig> = z.object({
    maxRepairAttempts: z.natural().default(2),
    autoDispatch: z.boolean().default(true),
    retryOnFailure: z.boolean().default(true),
  })

  private readonly config: SupervisorOrchestratorConfig
  private readonly tasks = new Map<string, TaskRecord>()
  private readonly approvals = new Map<string, SupervisorApprovalBatch>()
  private readonly runs = new Map<string, Promise<SupervisorRunResult>>()
  private readonly listeners = new Set<SupervisorNotificationListener>()
  private readonly notified = new Set<string>()
  private stopping = false

  /** @param ctx - context containing the Supervisor and executor bridge. @param config - validated orchestration bounds. */
  constructor(ctx: Context, config: SupervisorOrchestratorConfig) {
    super(ctx, 'supervisorOrchestrator')
    this.config = config
    ctx.effect(() => async () => {
      this.stopping = true
      const active = [...this.tasks.values()]
        .map(record => record.active?.handle?.cancel())
        .filter((value): value is Promise<void> => value !== undefined)
      await Promise.all(active.map(value => value.catch(() => undefined)))
      this.tasks.clear()
      this.runs.clear()
    }, 'supervisor-orchestrator.runtime')
  }

  /**
   * Replay the restored controller ledger into task state, then reconcile
   * every task that cannot resume execution to the owner.
   */
  protected [Service.init](): void {
    const session = this.ctx.supervisorSession.current
    if (session === undefined) return
    const events = session.events.flatMap((event) => {
      const supervisorEvent = supervisorEventFromSessionEvent(event)
      return supervisorEvent === undefined ? [] : [supervisorEvent]
    })
    const projection = foldSupervisor(events)
    for (const task of projection.tasks.values()) {
      this.tasks.set(String(task.id), {
        snapshot: task,
        capture: undefined,
        route: undefined,
        attempts: 0,
        signatures: new Set(),
        active: undefined,
      })
    }
    // A notification is always emitted on the publishing stack right after its
    // task publish, so the task revision current at that log position rebuilds
    // the dedupe key exactly. Failure signatures are not durable and restart
    // empty; the attempts bound still caps automatic repair after restart.
    const revisions = new Map<string, number>()
    for (const event of events) {
      if (event.type === 'supervisor/task') revisions.set(String(event.snapshot.id), event.snapshot.revision)
      else if (event.type === 'supervisor/run-linked') {
        const record = this.tasks.get(String(event.snapshot.taskId))
        if (record !== undefined) record.attempts += 1
      } else if (event.type === 'supervisor/notification' && event.snapshot.taskId !== undefined) {
        const revision = revisions.get(String(event.snapshot.taskId))
        if (revision !== undefined) this.notified.add(`${String(event.snapshot.taskId)}:${event.snapshot.kind}:${revision}`)
      }
    }
    for (const record of [...this.tasks.values()]) {
      if (record.snapshot.status === 'AwaitingApproval' || record.snapshot.status === 'NeedsOwnerDecision') {
        const batchId = `approval:${String(record.snapshot.id)}`
        this.approvals.set(batchId, { id: batchId, taskIds: [record.snapshot.id], createdAt: new Date().toISOString() })
      }
      if (record.snapshot.status !== 'Captured' && record.snapshot.status !== 'Classified' && record.snapshot.status !== 'Ready'
        && record.snapshot.status !== 'Dispatched' && record.snapshot.status !== 'Running' && record.snapshot.status !== 'NeedsFix') continue
      this.publishTask(record, 'NeedsOwnerDecision', 'Process exit interrupted orchestration; the owner decides to re-capture, follow up, or cancel.')
    }
  }

  /**
   * Return current task snapshots in capture order.
   * @returns task snapshots.
   */
  listTasks(): readonly SupervisorTaskSnapshot[] { return [...this.tasks.values()].map(record => record.snapshot) }

  /**
   * Look up one task snapshot.
   * @param taskId - task identity.
   * @returns task or undefined.
   */
  getTask(taskId: SupervisorTaskId): SupervisorTaskSnapshot | undefined { return this.tasks.get(String(taskId))?.snapshot }

  /**
   * Return approval groups awaiting one owner decision.
   * @returns pending approval batches.
   */
  listApprovalBatches(): readonly SupervisorApprovalBatch[] { return [...this.approvals.values()] }

  /**
   * Register a critical-notification listener.
   * @param listener - receives each notification once.
   * @returns disposer.
   */
  onNotification(listener: SupervisorNotificationListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Capture and classify one request. Approval-required routes are grouped into
   * one batch; only policy-approved low-risk routes can auto-dispatch.
   * @param request - user request and execution context.
   * @returns task, route and optional approval batch.
   */
  async capture(request: SupervisorCaptureRequest): Promise<SupervisorCaptureResult> {
    this.assertOpen()
    const project = this.ctx.supervisor.getProject(request.projectId)
    if (project === undefined || project.status !== 'registered') throw new SupervisorOrchestratorError('PROJECT_UNAVAILABLE', `project '${request.projectId}' is not registered`)
    const title = request.title.trim()
    const description = request.description.trim()
    const nextAction = request.nextAction.trim()
    if (title.length === 0 || description.length === 0 || nextAction.length === 0) throw new SupervisorOrchestratorError('INVALID_STATUS', 'task title, description and nextAction must be non-empty')
    const taskId = SupervisorTaskId(`supervisor-task:${randomUUID()}`)
    const task: SupervisorTaskSnapshot = { revision: 1, id: taskId, projectId: request.projectId, title, description, status: 'Captured', nextAction }
    const record: TaskRecord = {
      snapshot: task,
      capture: { ...request, title, description, nextAction },
      route: undefined,
      attempts: 0,
      signatures: new Set(),
      active: undefined,
    }
    this.tasks.set(String(taskId), record)
    this.ctx.emit('supervisor/task', { type: 'supervisor/task', version: SUPERVISOR_EVENT_VERSION, snapshot: task })
    this.publishTask(record, 'Classified')
    const router = this.findRouter()
    if (router === undefined) {
      this.publishTask(record, 'AwaitingApproval', 'No routing provider is available')
      this.notify(record, 'policy-gate', 'No routing provider is available; owner decision is required.')
      throw new SupervisorOrchestratorError('ROUTER_UNAVAILABLE', 'no resolving Supervisor router is registered')
    }
    const routeRequest: RouteRequest = { ...request.route, taskId, projectId: request.projectId, projectPath: project.realPath }
    const route = router.resolve(routeRequest)
    record.route = route
    this.publishPolicy(record, route)
    if (!route.dispatchable) {
      this.publishTask(record, 'AwaitingApproval', route.decision.reason)
      const pending = [...this.approvals.values()][0]
      const batchId = pending?.id ?? `approval:${randomUUID()}`
      this.approvals.set(batchId, pending === undefined
        ? { id: batchId, taskIds: [taskId], createdAt: new Date().toISOString() }
        : { ...pending, taskIds: [...pending.taskIds, taskId] })
      this.notify(record, 'owner-decision', route.decision.reason)
      return { task: record.snapshot, route, approvalBatchId: batchId }
    }
    this.publishTask(record, 'Ready')
    if (this.config.autoDispatch) await this.dispatch(taskId)
    return { task: record.snapshot, route }
  }

  /**
   * Approve all tasks in a batch atomically with respect to each task revision.
   * A denied route remains non-dispatchable even after an owner response.
   * @param batchId - approval group identity.
   * @param expectedRevisions - optional stale-write guards by task id.
   * @returns dispatches started for approved tasks.
   */
  async approve(
    batchId: string,
    expectedRevisions: ReadonlyMap<SupervisorTaskId, number> = new Map(),
  ): Promise<readonly SupervisorDispatchResult[]> {
    this.assertOpen()
    const batch = this.approvals.get(batchId)
    if (batch === undefined) throw new SupervisorOrchestratorError('TASK_NOT_FOUND', `approval batch '${batchId}' was not found`)
    const dispatches: SupervisorDispatchResult[] = []
    for (const taskId of batch.taskIds) {
      const record = this.requireTask(taskId)
      this.assertRevision(record, expectedRevisions.get(taskId))
      if (record.capture === undefined) throw new SupervisorOrchestratorError('TASK_NOT_RESUMABLE', `task '${taskId}' was restored from the ledger without its work order and cannot execute; re-capture or follow up instead`)
      const route = record.route
      if (route === undefined || route.approval === 'deny' || route.decision.executor === 'unmatched') throw new SupervisorOrchestratorError('APPROVAL_REQUIRED', `task '${taskId}' has no admissible route`)
      record.route = { ...route, approval: 'auto', dispatchable: true, decision: { ...route.decision, requiresApproval: false } }
      this.publishTask(record, 'Ready')
      if (this.config.autoDispatch) dispatches.push(await this.dispatch(taskId))
    }
    this.approvals.delete(batchId)
    return dispatches
  }

  /**
   * Approve the single pending batch containing one task.
   * @param taskId - task identity.
   * @param expectedRevision - revision observed by the owner.
   * @returns the started dispatch, when auto-dispatch is enabled.
   */
  async approveTask(taskId: SupervisorTaskId, expectedRevision: number): Promise<SupervisorDispatchResult | undefined> {
    for (const [batchId, batch] of this.approvals) {
      if (batch.taskIds.includes(taskId)) {
        const results = await this.approve(batchId, new Map([[taskId, expectedRevision]]))
        return results[0]
      }
    }
    throw new SupervisorOrchestratorError('TASK_NOT_FOUND', `no pending approval for task '${taskId}'`)
  }

  /**
   * Reject the single pending batch containing one task.
   * @param taskId - task identity.
   * @param expectedRevision - revision observed by the owner.
   */
  rejectTask(taskId: SupervisorTaskId, expectedRevision: number): void {
    for (const [batchId, batch] of this.approvals) {
      if (batch.taskIds.includes(taskId)) {
        this.reject(batchId, new Map([[taskId, expectedRevision]]))
        return
      }
    }
    throw new SupervisorOrchestratorError('TASK_NOT_FOUND', `no pending approval for task '${taskId}'`)
  }

  /**
   * Reject all tasks in an approval batch.
   * @param batchId - approval group identity.
   * @param expectedRevisions - optional stale-write guards.
   */
  reject(batchId: string, expectedRevisions: ReadonlyMap<SupervisorTaskId, number> = new Map()): void {
    this.assertOpen()
    const batch = this.approvals.get(batchId)
    if (batch === undefined) throw new SupervisorOrchestratorError('TASK_NOT_FOUND', `approval batch '${batchId}' was not found`)
    for (const taskId of batch.taskIds) {
      const record = this.requireTask(taskId)
      this.assertRevision(record, expectedRevisions.get(taskId))
      this.publishTask(record, 'Cancelled', 'Owner rejected the route')
    }
    this.approvals.delete(batchId)
  }

  /**
   * Dispatch a ready task and observe its terminal result asynchronously.
   * @param taskId - task identity.
   * @param expectedRevision - optional optimistic-concurrency guard.
   * @returns child run identity and running task snapshot.
   */
  async dispatch(taskId: SupervisorTaskId, expectedRevision?: number): Promise<SupervisorDispatchResult> {
    this.assertOpen()
    const record = this.requireTask(taskId)
    this.assertRevision(record, expectedRevision)
    if (record.snapshot.status !== 'Ready' && record.snapshot.status !== 'NeedsFix') throw new SupervisorOrchestratorError('INVALID_STATUS', `task '${taskId}' is ${record.snapshot.status}, not dispatchable`)
    if (record.capture === undefined) throw new SupervisorOrchestratorError('TASK_NOT_RESUMABLE', `task '${taskId}' was restored from the ledger without its work order and cannot execute; re-capture or follow up instead`)
    const route = record.route
    if (route === undefined || !route.dispatchable) throw new SupervisorOrchestratorError('APPROVAL_REQUIRED', `task '${taskId}' still requires owner approval`)
    const runId = SupervisorRunId(`supervisor-run:${randomUUID()}`)
    const controller = new AbortController()
    record.active = { runId, controller }
    this.publishTask(record, 'Dispatched')
    const executors = this.ctx.supervisorExecutors
    try {
      const handle = await executors.dispatch({
        projectId: record.snapshot.projectId,
        taskId,
        runId,
        prompt: record.capture.prompt,
        parent: record.capture.parent,
        route,
        permission: record.capture.permission,
        background: record.capture.background ?? true,
        signal: controller.signal,
      })
      record.active.handle = handle
      this.publishTask(record, 'Running')
      const result = this.observe(record, runId, handle)
      this.runs.set(String(runId), result)
      void result.catch(() => undefined)
      return { task: record.snapshot, runId }
    } catch (error: unknown) {
      record.active = undefined
      this.publishTask(record, 'Failed', error instanceof Error ? error.message : String(error))
      this.notify(record, 'failed', 'Dispatch failed before the child run started.')
      throw new SupervisorOrchestratorError('DISPATCH_FAILED', error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * Wait for one active or completed run.
   * @param runId - exact run identity.
   * @returns terminal execution result.
   */
  async wait(runId: ReturnType<typeof SupervisorRunId>): Promise<SupervisorRunResult> {
    const result = this.runs.get(String(runId))
    if (result === undefined) throw new SupervisorOrchestratorError('TASK_NOT_FOUND', `run '${runId}' was not found`)
    return await result
  }

  /**
   * Apply an owner follow-up only to the revision the owner viewed.
   * @param request - revision-safe follow-up.
   * @returns the started repair dispatch.
   */
  async followUp(request: SupervisorFollowUpRequest): Promise<SupervisorDispatchResult> {
    this.assertOpen()
    const record = this.requireTask(request.taskId)
    this.assertRevision(record, request.expectedRevision)
    if (record.snapshot.status !== 'ReadyForReview' && record.snapshot.status !== 'NeedsOwnerDecision') throw new SupervisorOrchestratorError('INVALID_STATUS', `task '${request.taskId}' cannot accept a follow-up from ${record.snapshot.status}`)
    if (record.capture === undefined) throw new SupervisorOrchestratorError('TASK_NOT_RESUMABLE', `task '${request.taskId}' was restored from the ledger without its work order and cannot execute; re-capture instead`)
    record.capture = { ...record.capture, prompt: request.prompt, nextAction: request.nextAction }
    this.publishTask(record, record.snapshot.status === 'NeedsOwnerDecision' ? 'Ready' : 'NeedsFix', request.nextAction)
    return await this.dispatch(request.taskId, record.snapshot.revision)
  }

  /** Record the owner's review without inferring acceptance from execution output.
   * @param taskId - exact task identity.
   * @param expectedRevision - revision shown by the owner.
   * @param outcome - explicit owner decision.
   * @returns the updated task snapshot.
   */
  review(taskId: SupervisorTaskId, expectedRevision: number, outcome: 'accepted' | 'needs-fix'): SupervisorTaskSnapshot {
    this.assertOpen()
    const record = this.requireTask(taskId)
    this.assertRevision(record, expectedRevision)
    if (record.snapshot.status !== 'ReadyForReview') throw new SupervisorOrchestratorError('INVALID_STATUS', `task '${taskId}' is not ready for review`)
    this.publishTask(record, outcome === 'accepted' ? 'Accepted' : 'NeedsFix', outcome === 'accepted' ? undefined : 'Owner requested a fix')
    return record.snapshot
  }

  /**
   * Cancel one exact run without touching peer projects.
   * @param taskId - task to interrupt.
   */
  async interrupt(taskId: SupervisorTaskId): Promise<void> {
    const record = this.requireTask(taskId)
    if (record.active === undefined) return
    await record.active.handle?.cancel()
    if (record.snapshot.status === 'Running' || record.snapshot.status === 'Dispatched') this.publishTask(record, 'Cancelled', 'Interrupted by owner')
  }

  private async observe(
    record: TaskRecord,
    runId: ReturnType<typeof SupervisorRunId>,
    handle: SupervisorExecutionHandle,
  ): Promise<SupervisorRunResult> {
    const result = await handle.result
    const attempt = record.attempts + 1
    record.attempts = attempt
    const failureSignature = result.status === 'completed' ? undefined : executionFailureSignature(result)
    const run: SupervisorRunResult = {
      taskId: record.snapshot.id, runId, attempt, result,
      ...(failureSignature === undefined ? {} : { failureSignature }),
    }
    assertOrchestrationRun(run)
    record.active = undefined
    if (this.stopping || record.snapshot.status === 'Cancelled') return run
    if (result.status === 'completed') {
      this.publishTask(record, 'ReadyForReview')
      this.notify(record, 'ready-for-review', 'Execution completed and is ready for review; owner acceptance is still required.')
    } else {
      await this.handleFailure(record, failureSignature ?? 'unknown-failure')
    }
    return run
  }

  private async handleFailure(record: TaskRecord, signature: string): Promise<void> {
    const repeated = record.signatures.has(signature)
    record.signatures.add(signature)
    const canRepair = this.config.retryOnFailure && !repeated && record.attempts <= this.config.maxRepairAttempts
    if (canRepair) {
      this.publishTask(record, 'NeedsFix', `Failure signature ${signature}`)
      try {
        await this.dispatch(record.snapshot.id, record.snapshot.revision)
      } catch {
        // The dispatch path publishes a terminal failure and notification; the
        // original run remains a completed observation in the run ledger.
      }
      return
    }
    this.publishTask(record, 'Failed', `Failure signature ${signature}`)
    this.notify(record, repeated ? 'blocked' : 'failed', repeated ? `No progress after repeated failure signature ${signature}.` : `Execution failed with signature ${signature}.`)
  }

  private publishTask(record: TaskRecord, status: SupervisorTaskSnapshot['status'], blocker?: string): void {
    const previous = record.snapshot
    const next: SupervisorTaskSnapshot = {
      ...previous, revision: previous.revision + 1, status,
      ...(blocker === undefined ? {} : { blocker }),
    }
    assertOrchestrationTask(next)
    record.snapshot = next
    this.ctx.emit('supervisor/task', { type: 'supervisor/task', version: SUPERVISOR_EVENT_VERSION, snapshot: next })
  }

  private publishPolicy(record: TaskRecord, route: ResolvedRouteDecision): void {
    const snapshot: SupervisorPolicyApplied = {
      revision: 1,
      taskId: record.snapshot.id,
      policyVersion: route.decision.policyVersion,
      executor: route.decision.executor,
      ...(route.decision.model === undefined ? {} : { model: route.decision.model }),
      requiresApproval: route.decision.requiresApproval,
      reason: route.decision.reason,
    }
    this.ctx.emit('supervisor/policy-applied', { type: 'supervisor/policy-applied', version: SUPERVISOR_EVENT_VERSION, snapshot })
  }

  private notify(record: TaskRecord, kind: SupervisorOrchestratorNotification['kind'], message: string): void {
    const key = `${record.snapshot.id}:${kind}:${record.snapshot.revision}`
    if (this.notified.has(key)) return
    this.notified.add(key)
    const createdAt = new Date().toISOString()
    const notification: SupervisorNotification = { revision: 1, id: `supervisor-notification:${randomUUID()}` as SupervisorNotification['id'], taskId: record.snapshot.id, projectId: record.snapshot.projectId, kind, message, unread: true, createdAt }
    this.ctx.emit('supervisor/notification', { type: 'supervisor/notification', version: SUPERVISOR_EVENT_VERSION, snapshot: notification })
    const compact: SupervisorOrchestratorNotification = { taskId: record.snapshot.id, kind, message, createdAt }
    for (const listener of this.listeners) listener(compact)
  }

  private findRouter(): ResolvingRouter | undefined {
    return this.ctx.supervisor.listRouters().find(router => typeof (router as Partial<ResolvingRouter>).resolve === 'function') as ResolvingRouter | undefined
  }

  private requireTask(taskId: SupervisorTaskId): TaskRecord {
    const record = this.tasks.get(String(taskId))
    if (record === undefined) throw new SupervisorOrchestratorError('TASK_NOT_FOUND', `task '${taskId}' was not found`)
    return record
  }

  private assertRevision(record: TaskRecord, expected: number | undefined): void {
    if (expected !== undefined && expected !== record.snapshot.revision) throw new SupervisorOrchestratorError('STALE_REVISION', `task '${record.snapshot.id}' is at revision ${record.snapshot.revision}, expected ${expected}`)
  }

  private assertOpen(): void { if (this.stopping) throw new SupervisorOrchestratorError('ORCHESTRATOR_STOPPING', 'Supervisor orchestrator is stopping') }
}

function executionFailureSignature(result: SupervisorExecutionResult): string {
  const value = JSON.stringify({ status: result.status, diagnostic: result.diagnostic ?? '', timedOut: result.timedOut, signal: result.signal ?? null, exitCode: result.exitCode ?? null })
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

export default SupervisorOrchestratorService
