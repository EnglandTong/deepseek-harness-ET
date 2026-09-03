/** Event-sourced memory for Personal Supervisor: projection, bounded summaries, and restart reconciliation. */

import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-supervisor-session'
import { assertSupervisorEvent, foldSupervisor, supervisorEventFromSessionEvent, SupervisorProjectId } from '@deepseek-ai/dsh-supervisor'
import type {
  SupervisorEvent,
  SupervisorPolicyApplied,
  SupervisorTaskSnapshot,
} from '@deepseek-ai/dsh-supervisor'
import type { ProjectGovernanceState } from '@deepseek-ai/dsh-supervisor-project-state'
import { assertSupervisorMemoryCheckpoint, assertSupervisorMemoryProjection, assertSupervisorRollingSummary } from './invariant.ts'
import type {
  MemoryPressure,
  MemorySourceRange,
  SupervisorGovernanceMemory,
  SupervisorMemoryCheckpoint,
  SupervisorMemoryConfig,
  SupervisorMemoryConfigInput,
  SupervisorMemoryProjection,
  SupervisorMemoryReconciliation,
  SupervisorMemoryRecord,
  SupervisorQueryBrief,
  SupervisorRollingSummary,
} from './types.ts'

export * from './invariant.ts'
export * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { supervisorMemory: SupervisorMemoryService }
}

/** Conservative defaults; callers may replace all deployment-varying bounds through config. */
export const DEFAULT_SUPERVISOR_MEMORY_CONFIG: SupervisorMemoryConfig = {
  maxSummaryChars: 1200,
  maxBriefSummaries: 12,
  maxBriefNotifications: 12,
  compactionThreshold: 0.75,
}

/** Decide whether token pressure warrants using the existing compaction extension point.
 * @param pressure - current prompt and context-limit accounting.
 * @param threshold - fraction of the context limit that triggers compaction.
 * @returns whether the caller should invoke the existing compaction provider.
 */
export function shouldCompactMemory(pressure: MemoryPressure, threshold = DEFAULT_SUPERVISOR_MEMORY_CONFIG.compactionThreshold): boolean {
  if (!Number.isFinite(pressure.promptTokens) || !Number.isFinite(pressure.contextLimit) || pressure.contextLimit <= 0) throw new Error('Memory pressure requires a positive contextLimit')
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) throw new Error('Memory compaction threshold must be between 0 and 1')
  const reserved = pressure.reservedTokens ?? 0
  if (!Number.isFinite(reserved) || reserved < 0) throw new Error('Memory reservedTokens must be non-negative')
  return (pressure.promptTokens + reserved) / pressure.contextLimit >= threshold
}

/** Return a detached, deterministic digest of raw memory records.
 * @param records - contiguous raw records to digest.
 * @returns a lower-case SHA-256 digest.
 */
export function digestMemoryRecords(records: readonly SupervisorMemoryRecord[]): string {
  const hash = createHash('sha256')
  for (const record of records) {
    hash.update(String(record.seq), 'utf8')
    hash.update('\0', 'utf8')
    hash.update(canonicalJson(record.event), 'utf8')
    hash.update('\0', 'utf8')
  }
  return hash.digest('hex')
}

/** Fold the authoritative Supervisor events and attach bounded governance reads.
 * @param records - contiguous Supervisor memory records.
 * @param governance - latest read-only governance states.
 * @returns a structured memory projection.
 */
export function projectSupervisorMemory(
  records: readonly SupervisorMemoryRecord[],
  governance: readonly SupervisorGovernanceMemory[] = [],
): SupervisorMemoryProjection {
  validateRecords(records)
  const events = records.map(record => record.event)
  const supervisor = foldSupervisor(events)
  const governanceMap = new Map<string, ProjectGovernanceState>()
  for (const item of governance) {
    const key = String(item.projectId)
    if (governanceMap.has(key)) throw new Error(`Supervisor memory contains duplicate governance state for ${key}`)
    governanceMap.set(key, item.state)
  }
  const sourceSeq = records.at(-1)?.seq ?? 0
  const projection: SupervisorMemoryProjection = { supervisor, governance: governanceMap, sourceSeq }
  assertSupervisorMemoryProjection(projection)
  return projection
}

/** Build one summary per project from the current projection, never from an older summary.
 * @param records - raw records providing provenance ranges.
 * @param projection - authoritative folded state.
 * @param generatedAt - timestamp placed in each summary.
 * @param config - summary size bounds.
 * @returns bounded rolling summaries.
 */
export function summarizeSupervisorMemory(
  records: readonly SupervisorMemoryRecord[],
  projection: SupervisorMemoryProjection,
  generatedAt = new Date().toISOString(),
  config: SupervisorMemoryConfig = DEFAULT_SUPERVISOR_MEMORY_CONFIG,
): readonly SupervisorRollingSummary[] {
  validateConfig(config)
  validateRecords(records)
  const byProject = new Map<string, SupervisorMemoryRecord[]>()
  for (const record of records) {
    const projectId = projectIdForEvent(record.event)
    if (projectId === undefined) continue
    const bucket = byProject.get(String(projectId)) ?? []
    bucket.push(record)
    byProject.set(String(projectId), bucket)
  }
  const summaries: SupervisorRollingSummary[] = []
  for (const project of projection.supervisor.projects.values()) {
    const tasks = [...projection.supervisor.tasks.values()].filter(task => task.projectId === project.id)
    const related = byProject.get(String(project.id)) ?? []
    const governanceState = projection.governance.get(String(project.id))
    const sourceRange: MemorySourceRange = {
      start: related[0]?.seq ?? records[0]?.seq ?? 1,
      end: related.at(-1)?.seq ?? records.at(-1)?.seq ?? 1,
    }
    const notifications = [...projection.supervisor.notifications.values()]
      .filter(item => item.projectId === project.id || (item.taskId !== undefined && tasks.some(task => task.id === item.taskId)))
    const policies = tasks
      .map(task => latestPolicy(projection.supervisor.policies, task.id))
      .filter((item): item is SupervisorPolicyApplied => item !== undefined)
    const latestPolicyVersion = policies.at(-1)?.policyVersion
    const runs = [...projection.supervisor.runs.values()].filter(run => run.projectId === project.id)
    const summary: SupervisorRollingSummary = {
      projectId: project.id,
      taskIds: tasks.map(task => task.id),
      currentState: truncate(`${project.status}; ${tasks.map(task => `${task.title}: ${task.status}`).join('; ') || 'no tasks'}`, config.maxSummaryChars),
      projectRevision: project.revision,
      taskRevisions: Object.fromEntries(tasks.map(task => [String(task.id), task.revision])),
      userDecisions: notifications.filter(item => item.kind === 'owner-decision').map(item => item.message).slice(-8),
      pendingConfirmations: notifications.filter(item => item.kind === 'owner-decision' && item.unread).map(item => item.message).slice(-8),
      blockers: tasks.flatMap(task => task.blocker === undefined ? [] : [`${task.title}: ${task.blocker}`]),
      uniqueNextSteps: [...new Set(tasks.map(task => task.nextAction).filter(Boolean))].slice(0, 8),
      evidence: [
        { kind: 'event', value: `supervisor/project:${project.id}`, seq: sourceRange.end },
        ...tasks.map((task) => {
          const source = related.findLast(record => record.event.type === 'supervisor/task' && String(record.event.snapshot.id) === String(task.id))
          return { kind: 'event' as const, value: `supervisor/task:${task.id}`, ...source === undefined ? {} : { seq: source.seq } }
        }),
        ...runs.flatMap(run => [
          { kind: 'run' as const, value: String(run.runId) },
          { kind: 'session' as const, value: String(run.childSessionId) },
          { kind: 'session' as const, value: String(run.hostSessionId) },
        ]),
        ...[...projection.supervisor.bindings.values()]
          .filter(binding => tasks.some(task => task.id === binding.supervisorTaskId))
          .map(binding => ({ kind: 'governance' as const, value: binding.governanceTaskId })),
        ...policies.map(policy => ({ kind: 'policy' as const, value: policy.policyVersion })),
        ...governanceReference(governanceState),
      ],
      sourceRange,
      ...(governanceState?.authorityFingerprint === undefined ? {} : { authorityFingerprint: governanceState.authorityFingerprint }),
      ...(latestPolicyVersion === undefined ? {} : { policyVersion: latestPolicyVersion }),
      generatedAt,
    }
    assertSupervisorRollingSummary(summary)
    summaries.push(summary)
  }
  return summaries
}

/** Create a checkpoint whose digest proves which raw log it summarizes.
 * @param records - raw records covered by the checkpoint.
 * @param summaries - summaries derived from the records.
 * @param projection - projection that supplies the source watermark and fingerprints.
 * @returns a validated checkpoint.
 */
export function createMemoryCheckpoint(
  records: readonly SupervisorMemoryRecord[],
  summaries: readonly SupervisorRollingSummary[],
  projection: SupervisorMemoryProjection,
): SupervisorMemoryCheckpoint {
  const checkpoint: SupervisorMemoryCheckpoint = {
    version: 1,
    sourceSeq: projection.sourceSeq,
    sourceDigest: digestMemoryRecords(records),
    summaries: summaries.map(summary => ({
      ...summary,
      taskIds: [...summary.taskIds],
      userDecisions: [...summary.userDecisions],
      pendingConfirmations: [...summary.pendingConfirmations],
      blockers: [...summary.blockers],
      uniqueNextSteps: [...summary.uniqueNextSteps],
      evidence: summary.evidence.map(reference => ({ ...reference })),
    })),
    authorityFingerprints: Object.fromEntries([...projection.governance.entries()].map(([id, state]) => [id, state.authorityFingerprint])),
  }
  assertSupervisorMemoryCheckpoint(checkpoint)
  return checkpoint
}

/** Reuse a checkpoint only when its source prefix and authority fingerprints still match.
 * @param records - current contiguous raw records.
 * @param checkpoint - previously persisted checkpoint, if available.
 * @param governance - current read-only governance states.
 * @param generatedAt - timestamp used if summaries must be rebuilt.
 * @param config - summary size bounds.
 * @returns reconciliation action, projection, and refreshed checkpoint.
 */
export function reconcileSupervisorMemory(
  records: readonly SupervisorMemoryRecord[],
  checkpoint: SupervisorMemoryCheckpoint | undefined,
  governance: readonly SupervisorGovernanceMemory[] = [],
  generatedAt = new Date().toISOString(),
  config: SupervisorMemoryConfig = DEFAULT_SUPERVISOR_MEMORY_CONFIG,
): SupervisorMemoryReconciliation {
  validateRecords(records)
  if (checkpoint !== undefined) assertSupervisorMemoryCheckpoint(checkpoint)
  const projection = projectSupervisorMemory(records, governance)
  const currentFingerprints = Object.fromEntries(governance.map(item => [String(item.projectId), item.state.authorityFingerprint]))
  const fingerprintIds = checkpoint === undefined
    ? []
    : [...new Set([...Object.keys(currentFingerprints), ...Object.keys(checkpoint.authorityFingerprints)])]
  const invalidated = checkpoint === undefined
    ? []
    : fingerprintIds
      .filter(id => currentFingerprints[id] !== checkpoint.authorityFingerprints[id])
      .map(id => SupervisorProjectId(id))
  const fullDigest = digestMemoryRecords(records)
  const sourceMatches = checkpoint !== undefined
    && checkpoint.sourceSeq <= projection.sourceSeq
    && digestMemoryRecords(records.filter(record => record.seq <= checkpoint.sourceSeq)) === checkpoint.sourceDigest
  const unchanged = sourceMatches && invalidated.length === 0 && checkpoint.sourceSeq === projection.sourceSeq
  const action = checkpoint === undefined ? 'fully-replayed' : invalidated.length > 0 ? 'invalidated' : unchanged ? 'reused' : sourceMatches ? 'tail-replayed' : 'fully-replayed'
  const summaries = unchanged ? checkpoint.summaries : summarizeSupervisorMemory(records, projection, generatedAt, config)
  const next = createMemoryCheckpoint(records, summaries, projection)
  return { action, projection, checkpoint: { ...next, sourceDigest: fullDigest }, invalidatedProjectIds: invalidated }
}

/** Select a small query-specific view without mutating the authoritative projection.
 * @param projection - authoritative folded state.
 * @param summaries - current rolling summaries.
 * @param question - main-assistant question being answered.
 * @param config - brief size bounds.
 * @returns a bounded query brief.
 */
export function createSupervisorQueryBrief(
  projection: SupervisorMemoryProjection,
  summaries: readonly SupervisorRollingSummary[],
  question: string,
  config: SupervisorMemoryConfig = DEFAULT_SUPERVISOR_MEMORY_CONFIG,
): SupervisorQueryBrief {
  validateConfig(config)
  const notifications = [...projection.supervisor.notifications.values()].filter(item => item.unread).map(item => item.message)
  const selected = summaries.slice(0, config.maxBriefSummaries)
  const truncated = summaries.length > selected.length || notifications.length > config.maxBriefNotifications
  return {
    question,
    generatedAt: new Date().toISOString(),
    summaries: selected,
    notifications: notifications.slice(0, config.maxBriefNotifications),
    sourceSeq: projection.sourceSeq,
    truncated,
  }
}

/** Runtime service holding live raw records and read-only derived memory. */
export class SupervisorMemoryService extends Service {
  static inject = ['supervisor', 'supervisorSession']
  static Config = z.object({
    maxSummaryChars: z.number().step(1).min(80),
    maxBriefSummaries: z.number().step(1).min(1),
    maxBriefNotifications: z.number().step(1).min(1),
    compactionThreshold: z.number(),
  })
  private readonly records: SupervisorMemoryRecord[] = []
  private readonly governance = new Map<string, SupervisorGovernanceMemory>()
  private readonly config: SupervisorMemoryConfig
  private replaying = false

  /**
   * @param ctx - context used to register this service.
   * @param config - explicit memory bounds.
   */
  constructor(ctx: Context, config: SupervisorMemoryConfigInput = {}) {
    super(ctx, 'supervisorMemory')
    this.config = resolveConfig(config)
    ctx.on('supervisor/identity', (event) => { this.append(event) })
    ctx.on('supervisor/project', (event) => { this.append(event) })
    ctx.on('supervisor/task', (event) => { this.append(event) })
    ctx.on('supervisor/run-linked', (event) => { this.append(event) })
    ctx.on('supervisor/id-binding', (event) => { this.append(event) })
    ctx.on('supervisor/policy-applied', (event) => { this.append(event) })
    ctx.on('supervisor/notification', (event) => { this.append(event) })
  }

  /** Replay Supervisor events already persisted before this service initialized. */
  protected [Service.init](): void {
    const session = this.ctx.supervisorSession.current
    if (session === undefined) return
    this.replaying = true
    try {
      for (const event of session.events) {
        const supervisorEvent = supervisorEventFromSessionEvent(event)
        if (supervisorEvent !== undefined) this.append(supervisorEvent)
      }
    } finally {
      this.replaying = false
    }
  }

  /** Append one event to the raw in-memory log; persistence is owned by the session layer.
   * @param event - validated Supervisor event.
   * @param seq - next contiguous memory sequence, or the implicit next sequence.
   * @returns void.
   */
  append(event: SupervisorEvent, seq?: number): void {
    assertSupervisorEvent(event)
    const nextSeq = seq ?? (this.records.at(-1)?.seq ?? 0) + 1
    // The session replay and live event listeners can overlap during startup;
    // one immutable event must enter the memory log only once.
    const eventDigest = canonicalJson(event)
    if (this.records.some(record => canonicalJson(record.event) === eventDigest)) {
      if (this.replaying) return
      throw new Error('Supervisor memory cannot append the same event twice')
    }
    if (!Number.isSafeInteger(nextSeq) || nextSeq < 1) throw new Error('Supervisor memory event seq must be positive')
    if (nextSeq !== (this.records.at(-1)?.seq ?? 0) + 1) throw new Error('Supervisor memory event seq must be contiguous')
    this.records.push({ seq: nextSeq, event })
  }

  /** Replace one project's current governance read; no project file is written.
   * @param item - current project governance state.
   * @returns void.
   */
  setGovernance(item: SupervisorGovernanceMemory): void { this.governance.set(String(item.projectId), item) }

  /** Return a detached copy of the raw log for a persistence/checkpoint adapter.
   * @returns raw records in sequence order.
   */
  rawRecords(): readonly SupervisorMemoryRecord[] { return this.records.map(record => ({ seq: record.seq, event: record.event })) }

  /** Build the current structured projection.
   * @returns authoritative folded projection.
   */
  project(): SupervisorMemoryProjection { return projectSupervisorMemory(this.records, [...this.governance.values()]) }

  /** Build current rolling summaries from the authoritative event projection.
   * @param now - timestamp used for generated summaries.
   * @returns bounded rolling summaries.
   */
  summaries(now: string = new Date().toISOString()): readonly SupervisorRollingSummary[] {
    const projection = this.project()
    return summarizeSupervisorMemory(this.records, projection, now, this.config)
  }

  /** Build a bounded brief for one main-assistant question.
   * @param question - question being answered.
   * @returns a bounded query brief.
   */
  brief(question: string): SupervisorQueryBrief {
    const projection = this.project()
    return createSupervisorQueryBrief(projection, this.summaries(), question, this.config)
  }
}

export default SupervisorMemoryService

function validateRecords(records: readonly SupervisorMemoryRecord[]): void {
  let expected = 1
  for (const record of records) {
    if (record.seq !== expected) throw new Error(`Supervisor memory record seq must be contiguous at ${expected}`)
    expected += 1
  }
}

function validateConfig(config: SupervisorMemoryConfig): void {
  if (!Number.isSafeInteger(config.maxSummaryChars) || config.maxSummaryChars < 80) throw new Error('maxSummaryChars must be at least 80')
  if (!Number.isSafeInteger(config.maxBriefSummaries) || config.maxBriefSummaries < 1) throw new Error('maxBriefSummaries must be positive')
  if (!Number.isSafeInteger(config.maxBriefNotifications) || config.maxBriefNotifications < 1) throw new Error('maxBriefNotifications must be positive')
  if (!Number.isFinite(config.compactionThreshold) || config.compactionThreshold <= 0 || config.compactionThreshold >= 1) throw new Error('compactionThreshold must be between 0 and 1')
}

function resolveConfig(config: SupervisorMemoryConfigInput): SupervisorMemoryConfig {
  const resolved = { ...DEFAULT_SUPERVISOR_MEMORY_CONFIG, ...config }
  validateConfig(resolved)
  return resolved
}

function truncate(value: string, max: number): string { return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…` }

function latestPolicy(policies: ReadonlyMap<string, SupervisorPolicyApplied>, taskId: SupervisorTaskSnapshot['id']): SupervisorPolicyApplied | undefined {
  return [...policies.values()].filter(policy => policy.taskId === taskId).at(-1)
}

function projectIdForEvent(event: SupervisorEvent): SupervisorProjectId | undefined {
  switch (event.type) {
    case 'supervisor/project': return event.snapshot.id
    case 'supervisor/task': return event.snapshot.projectId
    case 'supervisor/run-linked': return event.snapshot.projectId
    case 'supervisor/notification': return event.snapshot.projectId
    case 'supervisor/id-binding': return undefined
    case 'supervisor/policy-applied': return undefined
    case 'supervisor/identity': return undefined
    default: return assertNever(event)
  }
}

function governanceReference(state: ProjectGovernanceState | undefined): readonly { kind: 'governance'; value: string }[] {
  return state === undefined ? [] : [{ kind: 'governance', value: state.packetPath ?? state.workspacePath }]
}

function assertNever(value: never): never { throw new Error(`unknown Supervisor memory event ${(value as { type?: unknown }).type as string}`) }

function canonicalJson(value: unknown): string {
  if (value === undefined || typeof value === 'symbol' || typeof value === 'function') return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item)).join(',')}]`
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`
}
