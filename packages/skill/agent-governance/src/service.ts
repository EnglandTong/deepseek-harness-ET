import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { recommend } from './routing.ts'
import type { GovernanceAcceptance, GovernanceDecision, GovernanceReport, HarnessDescriptor, HarnessId, RouteRecommendation } from './types.ts'

declare module '@deepseek-ai/cordis' { interface Context { governance: GovernanceService } }

const descriptors: readonly HarnessDescriptor[] = [
  { id: 'codex', provider: 'subagent-codex', capabilities: ['code-editing', 'tests'], strengths: ['focused code changes'], permission: 'workspace-write', supportsFiles: true, supportsImages: false, supportsContinuable: false, available: true },
  { id: 'claude-code', provider: 'subagent-claude-code', capabilities: ['analysis', 'refactoring', 'review'], strengths: ['broad codebase reasoning'], permission: 'workspace-write', supportsFiles: true, supportsImages: false, supportsContinuable: false, available: true },
  { id: 'deepseek-harness', provider: 'subagent-dsh-sdk', capabilities: ['planning', 'governance', 'delegation'], strengths: ['task decomposition and coordination'], permission: 'workspace-write', supportsFiles: true, supportsImages: true, supportsContinuable: false, available: true },
]

/** Session-backed governance registry and deterministic router. */
export class GovernanceService extends Service {
  private readonly pending = new Map<string, RouteRecommendation>()
  private readonly decisions = new Map<string, GovernanceDecision>()

  constructor(ctx: Context) { super(ctx, 'governance') }

  /** List registered harnesses and current provider availability.
   * @returns Current harness descriptors.
   */
  listAgents(): readonly HarnessDescriptor[] {
    return descriptors.map(agent => ({
      ...agent,
      available: this.ctx.subagents?.getProvider(agent.provider) !== undefined,
      ...this.ctx.subagents?.getProvider(agent.provider) === undefined ? { diagnostic: `provider ${agent.provider} is not loaded` } : {},
    }))
  }

  /** List harnesses and persist availability observations for a session.
   * @param session Session receiving availability events.
   * @returns Current harness descriptors.
   */
  listAgentsFor(session: Session): readonly HarnessDescriptor[] {
    const result = this.listAgents()
    for (const harness of result) session.append('governance/harness', { harness })
    return result
  }

  /** Recommend a harness without granting execution authority.
   * @param task Task description.
   * @returns Deterministic recommendation.
   */
  route(task: string): RouteRecommendation {
    const recommendation = recommend(task, this.listAgents())
    this.ctx.logger.info(`governance route: ${recommendation.primary}`)
    return recommendation
  }

  /** Create and persist a routable governance task.
   * @param session Session receiving the route event.
   * @param task Task description.
   * @returns Task id and recommendation.
   */
  routeFor(session: Session, task: string): { taskId: string; recommendation: RouteRecommendation } {
    const taskId = `governance-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const recommendation = this.route(task)
    this.pending.set(taskId, recommendation)
    session.append('governance/route', { taskId, ...recommendation })
    return { taskId, recommendation }
  }

  /** Approve a pending task for delegation.
   * @param taskId Routed task id.
   * @param session Session receiving the decision event.
   */
  approve(taskId: string, session?: Session): void { this.loggerDecision(taskId, 'approved', undefined, session) }
  /** Reject a pending task and persist the reason.
   * @param taskId Routed task id.
   * @param reason Rejection reason.
   * @param session Session receiving the decision event.
   */
  reject(taskId: string, reason: string, session?: Session): void { this.loggerDecision(taskId, 'rejected', reason, session) }

  /** Return the in-memory recommendation for a task.
   * @param taskId Routed task id.
   * @returns Stored recommendation.
   */
  recommendation(taskId: string): RouteRecommendation {
    const recommendation = this.pending.get(taskId)
    if (recommendation === undefined) throw new Error(`unknown governance task ${taskId}`)
    return recommendation
  }

  /** Check whether a task has an approval decision.
   * @param taskId Routed task id.
   * @returns Whether delegation is approved.
   */
  isApproved(taskId: string): boolean { return this.decisions.get(taskId) === 'approved' }

  /** Persist a child report without converting it into acceptance.
   * @param report Child execution report.
   * @param session Session receiving the report event.
   */
  report(report: GovernanceReport, session?: Session): void {
    this.ctx.logger.info(`governance report ${report.taskId}: ${report.status}`)
    session?.append('governance/report', report)
  }

  /** Persist an explicit acceptance decision after a child report.
   * @param taskId Routed task id.
   * @param decision Acceptance decision.
   * @param reason Decision reason.
   * @param session Session receiving the acceptance event.
   */
  accept(taskId: string, decision: GovernanceAcceptance, reason?: string, session?: Session): void {
    this.ctx.logger.info(`governance acceptance ${taskId}: ${decision}${reason === undefined ? '' : ` (${reason})`}`)
    session?.append('governance/accept', { taskId, decision, ...reason === undefined ? {} : { reason } })
  }

  /** Return governance events that can rebuild the task state.
   * @param session Agent session.
   * @returns Governance events.
   */
  events(session: Agent['session']): readonly SessionEvent[] {
    return session.events.filter(event => event.type.startsWith('governance/'))
  }

  private loggerDecision(taskId: string, decision: GovernanceDecision, reason?: string, session?: Session): void {
    if (!this.pending.has(taskId)) throw new Error(`unknown governance task ${taskId}`)
    this.decisions.set(taskId, decision)
    this.ctx.logger.info(`governance decision ${taskId}: ${decision}${reason === undefined ? '' : ` (${reason})`}`)
    session?.append('governance/decision', { taskId, decision, ...reason === undefined ? {} : { reason } })
  }
}

export type { HarnessId }
