import { Service, type Context } from '@deepseek-ai/cordis'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { createHarnessAdapters } from './adapters.ts'
import { recommend } from './routing.ts'
import type {
  GovernanceAcceptance,
  GovernanceDecision,
  GovernancePermissionMode,
  GovernanceReport,
  GovernanceTaskState,
  GovernanceTaskStatus,
  HarnessAdapter,
  HarnessDescriptor,
  HarnessExecutionResult,
  HarnessId,
  RouteRecommendation,
} from './types.ts'

declare module '@deepseek-ai/cordis' { interface Context { governance: GovernanceService } }

/** Deployment configuration for the Governance Runtime. */
export interface GovernanceRuntimeConfig {
  /** Require explicit approval for every write-capable delegation. */
  requireApproval: boolean
  /** Maximum child depth allowed below a Governance task. */
  maxNestedDepth: number
  /** Default permission used when a route does not specify one. */
  defaultPermission: GovernancePermissionMode
  /** Maximum wall-clock time for one delegated task. */
  taskTimeoutMs: number
}

const DEFAULT_CONFIG: GovernanceRuntimeConfig = {
  requireApproval: true,
  maxNestedDepth: 1,
  defaultPermission: 'workspace-write',
  taskTimeoutMs: 30 * 60 * 1000,
}

type PendingTask = {
  task: string
  recommendation: RouteRecommendation
  decision: GovernanceDecision
  adapter: HarnessAdapter | undefined
  status: GovernanceTaskStatus
}

/** Session-backed registry, router, approval gate, and adapter coordinator. */
export class GovernanceService extends Service {
  static inject = ['subagents']
  private readonly adapters: readonly HarnessAdapter[]
  private readonly pending = new Map<string, PendingTask>()
  private readonly controllers = new Map<string, AbortController>()
  private config: GovernanceRuntimeConfig = { ...DEFAULT_CONFIG }

  constructor(ctx: Context) {
    super(ctx, 'governance')
    this.adapters = createHarnessAdapters(ctx)
    ctx.effect(() => () => {
      for (const adapter of this.adapters) adapter.dispose()
      for (const controller of this.controllers.values()) controller.abort('governance disposed')
      this.controllers.clear()
    }, 'governance.adapters()')
  }

  /** Apply validated deployment configuration before a task is routed.
   * @param config - partial deployment configuration.
   */
  configure(config: Partial<GovernanceRuntimeConfig>): void {
    const next = { ...this.config, ...config }
    if (!Number.isSafeInteger(next.maxNestedDepth) || next.maxNestedDepth < 0) {
      throw new TypeError('governance maxNestedDepth must be a non-negative safe integer')
    }
    if (!Number.isSafeInteger(next.taskTimeoutMs) || next.taskTimeoutMs <= 0) {
      throw new TypeError('governance taskTimeoutMs must be a positive safe integer')
    }
    this.config = next
  }

  /** List current Provider-backed harness descriptors.
   * @returns Current live harness descriptors.
   */
  listAgents(): readonly HarnessDescriptor[] {
    return this.adapters.map(adapter => adapter.checkAvailability())
  }

  /** Check all Providers and persist the observation for replay.
   * @param session - Session receiving the observations.
   * @returns Current live harness descriptors.
   */
  listAgentsFor(session: Session): readonly HarnessDescriptor[] {
    const timestamp = new Date().toISOString()
    return this.adapters.map((adapter) => {
      const harness = adapter.checkAvailability(session.header.cwd)
      session.append('governance/harness-registered', { harness, timestamp })
      session.append('governance/harness-check', { harness, timestamp })
      return harness
    })
  }

  /** Recommend a harness without granting execution authority.
   * @param task - Task to classify.
   * @returns A recommendation that still requires approval.
   */
  route(task: string): RouteRecommendation {
    return recommend(task, this.listAgents(), this.config.defaultPermission)
  }

  /** Create and persist a routable task.
   * @param session - Session receiving the route event.
   * @param task - Task to classify and route.
   * @returns The durable task id and recommendation.
   */
  routeFor(session: Session, task: string): { taskId: string; recommendation: RouteRecommendation } {
    const taskId = `governance-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const recommendation = this.route(task)
    this.pending.set(taskId, { task, recommendation, decision: 'pending', adapter: undefined, status: 'routed' })
    session.append('governance/route', { taskId, ...recommendation, timestamp: new Date().toISOString() })
    return { taskId, recommendation }
  }

  /** Approve a pending task for delegation.
   * @param taskId - Task id returned by {@link routeFor}.
   * @param session - Optional Session receiving the approval event.
   */
  approve(taskId: string, session?: Session): void {
    this.setDecision(taskId, 'approved', undefined, session)
  }

  /** Reject a pending task.
   * @param taskId - Task id returned by {@link routeFor}.
   * @param reason - Rejection reason.
   * @param session - Optional Session receiving the rejection event.
   */
  reject(taskId: string, reason: string, session?: Session): void {
    this.setDecision(taskId, 'rejected', reason, session)
  }

  /** Return the recommendation for a known task.
   * @param taskId - Task id returned by {@link routeFor}.
   * @returns The stored route recommendation.
   */
  recommendation(taskId: string): RouteRecommendation {
    const task = this.pending.get(taskId)
    if (task === undefined) throw new Error(`unknown governance task ${taskId}`)
    return task.recommendation
  }

  /** Return whether a task has explicit execution approval.
   * @param taskId - Task id returned by {@link routeFor}.
   * @returns Whether the task is approved.
   */
  isApproved(taskId: string): boolean {
    return this.pending.get(taskId)?.decision === 'approved'
  }

  /** Execute an approved task through its existing DSH Subagent Provider.
   * @param taskId - Task id returned by {@link routeFor}.
   * @param prompt - Bounded prompt delivered to the child.
   * @param parent - Agent requesting the delegation.
   * @param session - Session supplying the workspace and receiving events.
   * @param signal - Optional caller cancellation signal.
   * @returns The normalized child report.
   */
  async delegate(
    taskId: string,
    prompt: readonly ContentBlock[],
    parent: Agent,
    session: Session,
    signal?: AbortSignal,
  ): Promise<GovernanceReport> {
    const task = this.pending.get(taskId)
    if (task === undefined) throw new Error(`unknown governance task ${taskId}`)
    if (task.decision !== 'approved' && (this.config.requireApproval || task.recommendation.riskLevel !== 'low')) {
      throw new Error(`governance task ${taskId} is not approved`)
    }
    const workspace = session.header.cwd
    if (workspace === undefined) throw new Error('governance delegation requires a session workspace')
    const adapter = this.adapters.find(candidate => candidate.id === task.recommendation.primary)
    if (adapter === undefined) throw new Error(`governance harness ${task.recommendation.primary} is not registered`)
    const descriptor = adapter.checkAvailability(workspace)
    if (!descriptor.available) throw new Error(descriptor.diagnostic ?? `governance provider ${descriptor.provider} is unavailable`)
    const nestedDepth = session.header.delegationDepth ?? 0
    const controller = new AbortController()
    let abortFromCaller: (() => void) | undefined
    if (signal !== undefined) {
      abortFromCaller = () => controller.abort(signal.reason)
      if (signal.aborted) controller.abort(signal.reason)
      else signal.addEventListener('abort', abortFromCaller, { once: true })
    }
    const timeout = setTimeout(() => controller.abort('governance task timeout'), this.config.taskTimeoutMs)
    this.controllers.set(taskId, controller)
    const request = adapter.prepare({
      taskId,
      prompt,
      workspace,
      permission: task.recommendation.permission,
      nestedDepth,
      maxNestedDepth: this.config.maxNestedDepth,
      signal: controller.signal,
      parent,
    })
    task.adapter = adapter
    task.status = 'running'
    session.append('governance/delegation-start', {
      taskId,
      harness: adapter.id,
      provider: adapter.provider,
      workspace,
      permission: task.recommendation.permission,
      nestedDepth,
      timestamp: new Date().toISOString(),
    })
    try {
      const result = await adapter.execute(request)
      task.status = result.status
      session.append('governance/delegation-progress', {
        taskId,
        status: result.status,
        summary: result.summary,
        timestamp: new Date().toISOString(),
      })
      const report = this.reportFromResult(taskId, adapter.id, result, workspace)
      this.report(report, session)
      return report
    } catch (error) {
      task.status = 'failed'
      const summary = error instanceof Error ? error.message : String(error)
      session.append('governance/delegation-failed', {
        taskId,
        provider: adapter.provider,
        summary,
        timestamp: new Date().toISOString(),
      })
      throw error
    } finally {
      clearTimeout(timeout)
      if (signal !== undefined && abortFromCaller !== undefined) signal.removeEventListener('abort', abortFromCaller)
      this.controllers.delete(taskId)
      task.adapter = undefined
    }
  }

  /** Cancel a live adapter run and record the cancellation request.
   * @param taskId - Task id returned by {@link routeFor}.
   * @param session - Optional Session receiving the cancellation event.
   * @param reason - Optional cancellation reason.
   */
  async cancel(taskId: string, session?: Session, reason?: string): Promise<void> {
    const task = this.pending.get(taskId)
    if (task === undefined) throw new Error(`unknown governance task ${taskId}`)
    this.controllers.get(taskId)?.abort(reason ?? 'governance cancellation')
    if (task.adapter !== undefined) await task.adapter.cancel(taskId)
    task.status = 'cancelled'
    session?.append('governance/delegation-cancelled', {
      taskId,
      ...(reason === undefined ? {} : { reason }),
      timestamp: new Date().toISOString(),
    })
  }

  /** Persist a child report without converting it into acceptance.
   * @param report - Normalized child report.
   * @param session - Optional Session receiving the report and evidence events.
   */
  report(report: GovernanceReport, session?: Session): void {
    const task = this.pending.get(report.taskId)
    if (task === undefined) throw new Error(`unknown governance task ${report.taskId}`)
    if (session !== undefined) validateChangedFiles(session.header.cwd, report.changedFiles)
    task.status = report.status
    session?.append('governance/report', { ...report, timestamp: new Date().toISOString() })
    if (session !== undefined && report.evidence !== undefined) {
      const evidence = report.evidence
      session.append('governance/file-change-summary', {
        taskId: report.taskId,
        evidence: evidence.filter(item => item.kind === 'file'),
        timestamp: new Date().toISOString(),
      })
      session.append('governance/test-evidence', {
        taskId: report.taskId,
        evidence: evidence.filter(item => item.kind === 'test'),
        timestamp: new Date().toISOString(),
      })
    }
  }

  /** Persist a handoff reference; full content remains in the referenced file.
   * @param taskId - Task id returned by {@link routeFor}.
   * @param path - Relative or absolute handoff path.
   * @param summary - Short handoff summary.
   * @param session - Session supplying the workspace and receiving the event.
   * @param sha256 - Optional content hash.
   */
  handoff(taskId: string, path: string, summary: string, session: Session, sha256?: string): void {
    if (!this.pending.has(taskId)) throw new Error(`unknown governance task ${taskId}`)
    const workspace = session.header.cwd
    if (workspace === undefined) throw new Error('governance handoff requires a session workspace')
    const resolvedPath = resolve(workspace, path)
    if (!isWithinWorkspace(workspace, resolvedPath)) throw new Error(`governance handoff path is outside workspace: ${resolvedPath}`)
    session.append('governance/handoff', {
      taskId,
      path: resolvedPath,
      summary,
      ...(sha256 === undefined ? {} : { sha256 }),
      timestamp: new Date().toISOString(),
    })
  }

  /** Persist an explicit acceptance decision after a child report.
   * @param taskId - Task id returned by {@link routeFor}.
   * @param decision - Independent acceptance decision.
   * @param reason - Optional acceptance reason.
   * @param session - Optional Session receiving the decision event.
   */
  accept(taskId: string, decision: GovernanceAcceptance, reason?: string, session?: Session): void {
    const task = this.pending.get(taskId)
    if (task === undefined) throw new Error(`unknown governance task ${taskId}`)
    if (task.status !== 'completed' && decision === 'accepted') {
      throw new Error(`governance task ${taskId} has no completed report`)
    }
    task.status = decision === 'accepted' ? 'completed' : task.status
    session?.append('governance/acceptance', {
      taskId,
      decision,
      ...(reason === undefined ? {} : { reason }),
      timestamp: new Date().toISOString(),
    })
  }

  /** Return governance events that can rebuild the task state.
   * @param session - Agent Session whose events are inspected.
   * @returns Governance events in their original order.
   */
  events(session: Agent['session']): readonly SessionEvent[] {
    return session.events.filter(event => event.type.startsWith('governance/'))
  }

  /** Replay route, approval, delegation, report and acceptance state.
   * @param session - Agent Session whose events are replayed.
   * @returns Reconstructed task states.
   */
  replay(session: Agent['session']): readonly GovernanceTaskState[] {
    const states = new Map<string, GovernanceTaskState>()
    for (const event of this.events(session)) {
      const data = event.data as Record<string, unknown>
      const taskId = typeof data.taskId === 'string' ? data.taskId : undefined
      if (taskId === undefined) continue
      const previous = states.get(taskId)
      switch (event.type) {
        case 'governance/route':
          states.set(taskId, { taskId, task: typeof data.task === 'string' ? data.task : '', status: 'routed', harness: data.primary as HarnessId })
          break
        case 'governance/approval':
          states.set(taskId, { ...previous, taskId, task: previous?.task ?? '', status: data.decision === 'approved' ? 'approved' : 'routed', decision: data.decision as GovernanceDecision })
          break
        case 'governance/decision':
          states.set(taskId, { ...previous, taskId, task: previous?.task ?? '', status: data.decision === 'approved' ? 'approved' : 'routed', decision: data.decision as GovernanceDecision })
          break
        case 'governance/delegation-start':
          states.set(taskId, { ...previous, taskId, task: previous?.task ?? '', status: 'running', harness: data.harness as HarnessId, provider: data.provider as string })
          break
        case 'governance/report':
          states.set(taskId, { ...previous, taskId, task: previous?.task ?? '', status: data.status as GovernanceTaskStatus, report: data as unknown as GovernanceReport })
          break
        case 'governance/acceptance':
          states.set(taskId, { ...previous, taskId, task: previous?.task ?? '', status: previous?.status ?? 'completed', acceptance: data.decision as GovernanceAcceptance })
          break
        case 'governance/accept':
          states.set(taskId, { ...previous, taskId, task: previous?.task ?? '', status: previous?.status ?? 'completed', acceptance: data.decision as GovernanceAcceptance })
          break
        default:
          break
      }
    }
    return [...states.values()]
  }

  private setDecision(taskId: string, decision: GovernanceDecision, reason?: string, session?: Session): void {
    const task = this.pending.get(taskId)
    if (task === undefined) throw new Error(`unknown governance task ${taskId}`)
    if (task.status !== 'routed') throw new Error(`governance task ${taskId} is no longer awaiting approval`)
    task.decision = decision
    task.status = decision === 'approved' ? 'approved' : 'routed'
    session?.append('governance/approval', {
      taskId,
      decision,
      ...(reason === undefined ? {} : { reason }),
      timestamp: new Date().toISOString(),
    })
  }

  private reportFromResult(taskId: string, harness: HarnessId, result: HarnessExecutionResult, workspace: string): GovernanceReport {
    const permission = this.pending.get(taskId)?.recommendation.permission
    return {
      taskId,
      harness,
      status: result.status,
      summary: result.summary,
      changedFiles: result.changedFiles,
      tests: result.tests,
      workspace,
      ...(permission === undefined ? {} : { permission }),
    }
  }
}

function isWithinWorkspace(workspace: string, candidate: string): boolean {
  const difference = relative(resolve(workspace), resolve(candidate))
  return difference === '' || (difference !== '..' && !difference.startsWith(`..${sep}`) && !isAbsolute(difference))
}

function validateChangedFiles(workspace: string | undefined, files: readonly string[]): void {
  if (workspace === undefined) throw new Error('governance report requires a session workspace')
  for (const file of files) {
    const resolved = resolve(workspace, file)
    if (!isWithinWorkspace(workspace, resolved)) throw new Error(`governance report file is outside workspace: ${resolved}`)
  }
}
