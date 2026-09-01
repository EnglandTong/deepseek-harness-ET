/** Read-only project governance adapter for the Personal Supervisor. */

import { createHash } from 'node:crypto'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'

const DEFAULT_MAX_FILE_BYTES = 4 * 1024 * 1024
const DEFAULT_RECENT_LOOPS = 3

/** A bounded source file selected for current project governance. */
export interface GovernanceSource {
  readonly relativePath: string
  readonly absolutePath: string
  readonly content: string
}

/** One malformed or contradictory observation that prevents a safe refresh. */
export interface GovernanceConflict {
  readonly code: 'missing-packet' | 'duplicate-packet' | 'invalid-packet' | 'missing-source' | 'fingerprint-mismatch' | 'duplicate-work-order' | 'corrupt-loop'
  readonly message: string
  readonly paths: readonly string[]
}

/** Small, model-safe projection of Active Packet frontmatter. */
export interface ActivePacketSummary {
  readonly packetId?: string
  readonly contractVersion?: string
  readonly executionState?: string
  readonly stageReview?: string
  readonly deliveryClass?: string
  readonly authorityFingerprint?: string
  readonly oneNextAction: string
}

/** Small projection of the selected Work Order. */
export interface WorkOrderSummary {
  readonly relativePath: string
  readonly title: string
  readonly workOrderId?: string
  readonly owner?: string
  readonly outcome: string
  readonly nonGoal: string
}

/** One append-only Loop Runs record, retained without hidden model output. */
export interface LoopRunSummary {
  readonly recordVersion?: string
  readonly timestamp?: string
  readonly stage?: number
  readonly loop?: number
  readonly role?: string
  readonly result?: string
  readonly progressDelta?: string
  readonly stageReview?: string
  readonly nextAction?: string
  readonly failureSignature?: string | null
}

/** Compact project state consumed by the Supervisor prompt and orchestration. */
export interface ProjectGovernanceState {
  readonly workspacePath: string
  readonly docsDirectory?: string
  readonly packetPath?: string
  readonly workOrderPath?: string
  readonly loopRunsPath?: string
  readonly packet?: ActivePacketSummary
  readonly workOrder?: WorkOrderSummary
  readonly recentLoops: readonly LoopRunSummary[]
  readonly authoritySources: readonly string[]
  readonly authorityFingerprint?: string
  readonly conflicts: readonly GovernanceConflict[]
  readonly status: 'valid' | 'missing' | 'conflicted' | 'corrupt'
}

/** A deliberately content-free, on-demand handoff to an installed Skill. */
export interface SkillHandoff {
  readonly skill: 'cms-project-governance' | 'agent-loop-engineering'
  readonly purpose: 'state' | 'execution'
  readonly invocation: 'load-on-demand'
  readonly reason: string
  readonly sourceHint: string
}

/** Optional bounds for project-state reads. */
export interface ProjectStateAdapterOptions {
  readonly maxFileBytes?: number
  readonly recentLoopCount?: number
}

/** Result of an explicit refresh request. No writer means no filesystem mutation. */
export interface RefreshResult {
  readonly written: false
  readonly state: ProjectGovernanceState
  readonly reason: 'read-only' | 'conflict' | 'no-change'
}

/**
 * Locate the one root-level Docs/docs directory without following an outside link.
 * @param workspacePath - project workspace to inspect.
 * @returns the canonical Docs directory, or undefined when absent.
 */
export async function findDocsDirectory(workspacePath: string): Promise<string | undefined> {
  const root = await realpath(workspacePath)
  const entries = await readdir(root, { withFileTypes: true })
  const names = entries.filter(entry => entry.name.toLowerCase() === 'docs').map(entry => entry.name)
  if (names.length > 1) throw new Error(`Multiple case-insensitive Docs directories found: ${names.join(', ')}`)
  const name = names[0]
  if (name === undefined) return undefined
  const candidate = await realpath(join(root, name))
  assertInside(root, candidate, 'Docs directory')
  if (!(await stat(candidate)).isDirectory()) throw new Error(`Docs path is not a directory: ${candidate}`)
  return candidate
}

/**
 * Compute the governance fingerprint used by the installed governance Skill.
 * @param workspacePath - project workspace containing the sources.
 * @param sources - workspace-relative authority source paths.
 * @returns the fingerprint and normalized source paths.
 */
export async function computeAuthorityFingerprint(
  workspacePath: string,
  sources: readonly string[],
): Promise<{ fingerprint: string; sources: readonly string[] }> {
  const root = await realpath(workspacePath)
  const normalized = [] as string[]
  for (const source of sources) {
    const target = await realpath(resolve(root, source))
    assertInside(root, target, 'authority source')
    if (!(await stat(target)).isFile()) throw new Error(`Authority source does not exist: ${source}`)
    normalized.push(normalizeRelative(relative(root, target)))
  }
  normalized.sort((a, b) => a.localeCompare(b, 'en'))
  const hash = createHash('sha256')
  for (const path of normalized) {
    hash.update(path, 'utf8')
    hash.update('\0')
    hash.update(await readFile(resolve(root, path)))
    hash.update('\0')
  }
  return { fingerprint: `sha256:${hash.digest('hex')}`, sources: normalized }
}

/**
 * Read the current governance files and return a bounded, conflict-checked projection.
 * @param workspacePath - project workspace to inspect.
 * @param options - optional read bounds.
 * @returns the current governance projection.
 */
export async function readProjectGovernanceState(
  workspacePath: string,
  options: ProjectStateAdapterOptions = {},
): Promise<ProjectGovernanceState> {
  return await new ProjectStateAdapter(options).read(workspacePath)
}

/**
 * Create the minimal Skill handoff; full Skill text remains outside project memory.
 * @param skill - installed Skill identifier.
 * @param reason - reason the handoff is needed.
 * @returns a content-free, on-demand handoff descriptor.
 */
export function createSkillHandoff(skill: SkillHandoff['skill'], reason: string): SkillHandoff {
  return skill === 'cms-project-governance'
    ? { skill, purpose: 'state', invocation: 'load-on-demand', reason, sourceHint: 'Read the installed cms-project-governance Skill and only its required references.' }
    : { skill, purpose: 'execution', invocation: 'load-on-demand', reason, sourceHint: 'Read the installed agent-loop-engineering Skill and only its required references.' }
}

/** Owns the bounded read and explicit no-write refresh behavior for one project. */
export class ProjectStateAdapter {
  private readonly maxFileBytes: number
  private readonly recentLoopCount: number

  /** @param options - read bounds. */
  constructor(options: ProjectStateAdapterOptions = {}) {
    this.maxFileBytes = positiveInteger(options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES, 'maxFileBytes')
    this.recentLoopCount = positiveInteger(options.recentLoopCount ?? DEFAULT_RECENT_LOOPS, 'recentLoopCount')
  }

  /**
   * Read project authority without writing any file.
   * @param workspacePath - project workspace to inspect.
   * @returns the current governance projection.
   */
  async read(workspacePath: string): Promise<ProjectGovernanceState> {
    const root = await realpath(workspacePath)
    const conflicts: GovernanceConflict[] = []
    let docsDirectory: string | undefined
    try {
      docsDirectory = await findDocsDirectory(root)
    } catch (error) {
      conflicts.push(conflict('invalid-packet', errorMessage(error), []))
    }
    const packetCandidates = docsDirectory === undefined ? [] : await findFilesCaseInsensitive(docsDirectory, 'active_packet.md')
    if (packetCandidates.length > 1) conflicts.push(conflict('duplicate-packet', 'Multiple case-insensitive Active Packet files were found.', packetCandidates.map(path => relative(root, path))))
    const packetPath = packetCandidates[0]
    let packetSource: GovernanceSource | undefined
    let packet: ActivePacketSummary | undefined
    let declaredSources: string[] = []
    if (packetPath !== undefined) {
      try {
        packetSource = await this.source(root, packetPath)
        const fields = parseFrontmatter(packetSource.content)
        packet = packetSummary(fields, packetSource.content)
        if (String(fields.contract_version ?? '') !== '2.0') conflicts.push(conflict('invalid-packet', 'Active Packet requires contract_version 2.0.', [packetSource.relativePath]))
        if (typeof fields.authority_fingerprint !== 'string' || fields.authority_fingerprint.length === 0) conflicts.push(conflict('invalid-packet', 'Active Packet requires a non-empty authority_fingerprint.', [packetSource.relativePath]))
        declaredSources = authoritySources(packetSource.content)
        if (declaredSources.length === 0) conflicts.push(conflict('invalid-packet', 'Active Packet requires at least one Authority Sources entry.', [packetSource.relativePath]))
      } catch (error) {
        conflicts.push(conflict('invalid-packet', errorMessage(error), [relative(root, packetPath)]))
      }
    } else {
      conflicts.push(conflict('missing-packet', 'No Active Packet was found in Docs/docs.', []))
    }
    const sourcePaths = declaredSources.length > 0 ? declaredSources : []
    const authoritySourcesResolved: GovernanceSource[] = []
    for (const source of sourcePaths) {
      try {
        const target = await resolveAuthoritySource(root, packetPath, source)
        if (target === undefined) throw new Error(`Authority source does not exist: ${source}`)
        authoritySourcesResolved.push(await this.source(root, target))
      } catch (error) {
        conflicts.push(conflict('missing-source', errorMessage(error), [source]))
      }
    }
    let authorityFingerprint: string | undefined
    if (authoritySourcesResolved.length === sourcePaths.length && sourcePaths.length > 0) {
      const fingerprinted = await computeAuthorityFingerprint(root, authoritySourcesResolved.map(source => source.relativePath))
      authorityFingerprint = fingerprinted.fingerprint
      if (packet?.authorityFingerprint !== undefined && packet.authorityFingerprint !== authorityFingerprint) conflicts.push(conflict('fingerprint-mismatch', 'Active Packet authority_fingerprint does not match its authority sources.', [packetSource?.relativePath ?? '']))
    }
    const workOrderCandidates = await this.findWorkOrders(root, docsDirectory, packetSource?.content)
    if (workOrderCandidates.length > 1) conflicts.push(conflict('duplicate-work-order', 'Multiple current Work Order files were found.', workOrderCandidates.map(path => relative(root, path))))
    const workOrderPath = workOrderCandidates[0]
    let workOrder: WorkOrderSummary | undefined
    if (workOrderPath !== undefined) workOrder = await this.parseWorkOrder(root, workOrderPath, conflicts)
    const loopRunsPath = await this.findLoopRuns(root, docsDirectory)
    const recentLoops = loopRunsPath === undefined ? [] : await this.parseLoops(root, loopRunsPath, conflicts)
    const status = conflicts.some(item => item.code === 'corrupt-loop') ? 'corrupt' : conflicts.length > 0 ? (conflicts.some(item => item.code === 'missing-packet') ? 'missing' : 'conflicted') : 'valid'
    return {
      workspacePath: root,
      ...(docsDirectory === undefined ? {} : { docsDirectory }),
      ...(packetPath === undefined ? {} : { packetPath }),
      ...(workOrderPath === undefined ? {} : { workOrderPath }),
      ...(loopRunsPath === undefined ? {} : { loopRunsPath }),
      ...(packet === undefined ? {} : { packet }),
      ...(workOrder === undefined ? {} : { workOrder }),
      recentLoops,
      authoritySources: authoritySourcesResolved.map(source => source.relativePath),
      ...(authorityFingerprint === undefined ? {} : { authorityFingerprint }),
      conflicts,
      status,
    }
  }

  /**
   * Refuse implicit writes; callers must supply a writer in a later package.
   * @param workspacePath - project workspace to inspect.
   * @returns the read-only refresh result.
   */
  async refresh(workspacePath: string): Promise<RefreshResult> {
    const state = await this.read(workspacePath)
    return { written: false, state, reason: state.conflicts.length > 0 ? 'conflict' : 'read-only' }
  }

  private async source(root: string, path: string): Promise<GovernanceSource> {
    assertInside(root, path, 'governance source')
    const info = await stat(path)
    if (!info.isFile()) throw new Error(`Governance source is not a file: ${path}`)
    if (info.size > this.maxFileBytes) throw new Error(`Governance source exceeds ${this.maxFileBytes} bytes: ${path}`)
    return { relativePath: normalizeRelative(relative(root, path)), absolutePath: path, content: await readFile(path, 'utf8') }
  }

  private async findWorkOrders(root: string, docs: string | undefined, packetText: string | undefined): Promise<string[]> {
    const linked = packetText === undefined
      ? []
      : authoritySources(packetText)
        .filter(path => /work[_ -]?order/i.test(path))
        .map(path => resolve(root, path))
    const candidates = [...linked, ...(docs === undefined ? [] : await findFilesCaseInsensitive(docs, 'work_orders.md')), ...await findFilesCaseInsensitive(root, 'work_orders.md')]
    return uniqueExisting(candidates, root)
  }

  private async findLoopRuns(root: string, docs: string | undefined): Promise<string | undefined> {
    const candidates = [...(docs === undefined ? [] : await findFilesCaseInsensitive(docs, 'loop_runs.jsonl')), ...await findFilesCaseInsensitive(root, 'loop_runs.jsonl')]
    return uniqueExisting(candidates, root)[0]
  }

  private async parseWorkOrder(root: string, path: string, conflicts: GovernanceConflict[]): Promise<WorkOrderSummary | undefined> {
    try {
      const source = await this.source(root, path)
      const heading = source.content.split(/\r?\n/).find(line => /^#\s+/.test(line))?.replace(/^#\s+/, '').trim() ?? basename(path)
      const body = source.content.replace(/^---[\s\S]*?---\s*/, '')
      return { relativePath: source.relativePath, title: heading, ...firstWorkOrderFields(body) }
    } catch (error) {
      conflicts.push(conflict('invalid-packet', errorMessage(error), [normalizeRelative(relative(root, path))]))
      return undefined
    }
  }

  private async parseLoops(root: string, path: string, conflicts: GovernanceConflict[]): Promise<LoopRunSummary[]> {
    try {
      const source = await this.source(root, path)
      const records: LoopRunSummary[] = []
      for (const [index, line] of source.content.split(/\r?\n/).entries()) {
        if (!line.trim()) continue
        try {
          const value: unknown = JSON.parse(line)
          if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Loop record must be an object')
          const item = value as Record<string, unknown>
          validateLoopRecord(item)
          records.push({
            ...(typeof item.record_version === 'string' ? { recordVersion: item.record_version } : {}),
            ...(typeof item.timestamp === 'string' ? { timestamp: item.timestamp } : {}),
            ...(typeof item.stage === 'number' ? { stage: item.stage } : {}),
            ...(typeof item.loop === 'number' ? { loop: item.loop } : {}),
            ...(typeof item.role === 'string' ? { role: item.role } : {}),
            ...(typeof item.result === 'string' ? { result: item.result } : {}),
            ...(typeof item.progress_delta === 'string' ? { progressDelta: item.progress_delta } : {}),
            ...(typeof item.stage_review === 'string' ? { stageReview: item.stage_review } : {}),
            ...(typeof item.next_action === 'string' ? { nextAction: item.next_action } : {}),
            ...(item.failure_signature === null || typeof item.failure_signature === 'string' ? { failureSignature: item.failure_signature } : {}),
          })
        } catch (error) {
          conflicts.push(conflict('corrupt-loop', `Invalid Loop Runs record at line ${index + 1}: ${errorMessage(error)}`, [source.relativePath]))
        }
      }
      return records.slice(-this.recentLoopCount)
    } catch (error) {
      conflicts.push(conflict('corrupt-loop', errorMessage(error), [normalizeRelative(relative(root, path))]))
      return []
    }
  }
}

function parseFrontmatter(text: string): Record<string, string | number | boolean | null> {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (match === null) return {}
  const body = match[1]
  if (body === undefined) return {}
  const fields: Record<string, string | number | boolean | null> = {}
  for (const line of body.split(/\r?\n/)) {
    const found = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (found === null) continue
    const key = found[1]
    const value = found[2]
    if (key === undefined || value === undefined) continue
    fields[key] = parseScalar(value)
  }
  return fields
}

function parseScalar(raw: string): string | number | boolean | null {
  const value = raw.trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1)
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null') return null
  if (/^-?\d+$/.test(value)) return Number(value)
  return value
}

function validateLoopRecord(item: Record<string, unknown>): void {
  const requiredStrings = ['record_version', 'contract_version', 'timestamp', 'packet_id', 'role', 'result', 'progress_delta', 'stage_review', 'next_action']
  for (const field of requiredStrings) if (typeof item[field] !== 'string' || item[field] === '') throw new Error(`Loop record requires non-empty ${field}`)
  for (const field of ['stage', 'loop']) if (!Number.isSafeInteger(item[field]) || (item[field] as number) < 1) throw new Error(`Loop record requires positive integer ${field}`)
  if (!Array.isArray(item.evidence)) throw new Error('Loop record requires evidence array')
  if (item.failure_signature !== null && typeof item.failure_signature !== 'string') throw new Error('Loop record failure_signature must be string or null')
  if (item.context_stats === null || typeof item.context_stats !== 'object' || Array.isArray(item.context_stats)) throw new Error('Loop record requires context_stats object')
}

function packetSummary(fields: Record<string, string | number | boolean | null>, text: string): ActivePacketSummary {
  const nextAction = text.match(/##\s+One Next Action[^\n]*\r?\n([\s\S]*?)(?=\r?\n##\s|$)/i)?.[1]?.split(/\r?\n/).map(line => line.replace(/^[-*]\s+/, '').trim()).find(Boolean) ?? ''
  return {
    ...(typeof fields.packet_id === 'string' ? { packetId: fields.packet_id } : {}),
    ...(fields.contract_version !== undefined ? { contractVersion: String(fields.contract_version) } : {}),
    ...(typeof fields.execution_state === 'string' ? { executionState: fields.execution_state } : {}),
    ...(typeof fields.stage_review === 'string' ? { stageReview: fields.stage_review } : {}),
    ...(typeof fields.delivery_class === 'string' ? { deliveryClass: fields.delivery_class } : {}),
    ...(typeof fields.authority_fingerprint === 'string' ? { authorityFingerprint: fields.authority_fingerprint } : {}),
    oneNextAction: nextAction,
  }
}

function firstWorkOrderFields(text: string): Pick<WorkOrderSummary, 'workOrderId' | 'owner' | 'outcome' | 'nonGoal'> {
  const firstSection = (name: string): string => text.match(new RegExp(`(?:^|\\n)##?\\s*${name}[^\\n]*\\n([\\s\\S]*?)(?=\\n##?\\s|$)`, 'i'))?.[1]?.split(/\r?\n/).map(line => line.replace(/^[-*]\s+/, '').trim()).find(Boolean) ?? ''
  const id = text.match(/\b(WO[-_]?\d+)\b/i)?.[1]
  const owner = text.match(/(?:owner|负责人)\s*[:：]\s*([^\n.]+)/i)?.[1]?.trim()
  return { ...(id === undefined ? {} : { workOrderId: id.toUpperCase() }), ...(owner === undefined ? {} : { owner }), outcome: firstSection('Outcome|目标') || firstSection('Must Produce|必须产出'), nonGoal: firstSection('Non-Goal|禁止') }
}

function authoritySources(text: string): string[] {
  const section = text.match(/##\s+Authority Sources[^\n]*\r?\n([\s\S]*?)(?=\r?\n##\s|$)/i)?.[1] ?? ''
  const values: string[] = []
  for (const line of section.split(/\r?\n/)) {
    const backtick = line.match(/`([^`]+)`/)?.[1]
    const link = line.match(/\[[^\]]*\]\(([^)#]+)(?:#[^)]*)?\)/)?.[1]
    const plain = line.match(/^\s*[-*]\s+([^|]+?\.md(?:#[^\s|]+)?)(?:\s|$)/i)?.[1]
    const value = (backtick ?? link ?? plain)?.split('#')[0]?.trim()
    if (value) values.push(value)
  }
  return [...new Set(values)]
}

async function resolveAuthoritySource(root: string, packetPath: string | undefined, source: string): Promise<string | undefined> {
  const candidates = [resolve(root, source), ...(packetPath === undefined ? [] : [resolve(dirname(packetPath), source)])]
  for (const candidate of candidates) {
    try { const target = await realpath(candidate); assertInside(root, target, 'authority source'); if ((await stat(target)).isFile()) return target } catch { /* absent candidate: try the next documented location */ }
  }
  return undefined
}

async function findFilesCaseInsensitive(directory: string, fileName: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  return entries
    .filter(entry => entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase())
    .map(entry => join(directory, entry.name))
}

function uniqueExisting(paths: readonly string[], root: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const path of paths) {
    const normalized = resolve(path)
    if (!isInside(root, normalized)) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
  }
  return result
}

function assertInside(root: string, target: string, label: string): void {
  if (!isInside(root, target)) throw new Error(`${label} escapes workspace: ${target}`)
}

function isInside(root: string, target: string): boolean {
  const value = relative(root, target)
  return value === '' || (!value.startsWith('..') && !/^[A-Za-z]:[\\/]/.test(value))
}

function normalizeRelative(value: string): string { return value.split('\\').join('/').replace(/^\.\//, '') }
function positiveInteger(value: number, name: string): number { if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`); return value }
function conflict(code: GovernanceConflict['code'], message: string, paths: readonly string[]): GovernanceConflict { return { code, message, paths } }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
