/** Explicit project enrollment and bounded, read-only project discovery. */

import { randomUUID } from 'node:crypto'
import { lstat, realpath, readdir, stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import {
  SupervisorProjectId,
  type SupervisorProjectProvider,
  type SupervisorProjectSnapshot,
} from '@deepseek-ai/dsh-supervisor'
import type {
  ProjectCandidate,
  ProjectDiscoveryOptions,
  ProjectPathKind,
  ProjectRegistryConfig,
  RegisteredProject,
} from './types.ts'

export type {
  ProjectCandidate,
  ProjectDiscoveryOptions,
  ProjectPathKind,
  ProjectRegistryConfig,
  RegisteredProject,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { supervisorProjectRegistry: SupervisorProjectRegistry }
}

/** A requested path did not resolve to an existing directory. */
export class ProjectPathUnavailableError extends Error {
  /** @param path - absolute requested path. @param reason - observed failure. */
  constructor(readonly path: string, readonly reason: string) {
    super(`cannot register project '${path}': ${reason}`)
    this.name = 'ProjectPathUnavailableError'
  }
}

/** A path already belongs to another canonical project registration. */
export class ProjectAlreadyRegisteredError extends Error {
  /** @param path - canonical duplicate path. @param projectId - existing owner. */
  constructor(readonly path: string, readonly projectId: string) {
    super(`project path '${path}' is already registered as '${projectId}'`)
    this.name = 'ProjectAlreadyRegisteredError'
  }
}

interface PathObservation {
  readonly inputPath: string
  readonly realPath?: string
  readonly kind: ProjectPathKind
  readonly isWorktree: boolean
  readonly reason?: string
}

const DEFAULT_MAX_CANDIDATES_PER_ROOT = 256
const ENOENT = 'ENOENT'

/**
 * Registry for explicit project enrollment. Discovery accepts only caller
 * supplied roots and performs metadata-only reads. Enrollment canonicalizes
 * through `realpath`, emits one versioned project snapshot, and never changes
 * project files or creates an execution session.
 */
export class SupervisorProjectRegistry extends Service implements SupervisorProjectProvider {
  static inject = []

  /** Provider identity used by the Supervisor service registry. */
  override readonly name: string
  private readonly maxCandidatesPerRoot: number
  private readonly projects = new Map<string, SupervisorProjectSnapshot>()
  /** Original enrolled spelling, retained to detect a retargeted symlink/junction. */
  private readonly enrollmentPaths = new Map<string, string>()
  private operationTail: Promise<void> = Promise.resolve()
  private supervisorDisposer: (() => void) | undefined

  /** @param ctx - owning Cordis context. @param config - bounded discovery configuration. */
  constructor(ctx: Context, config: ProjectRegistryConfig = {}) {
    super(ctx, 'supervisorProjectRegistry')
    this.name = config.providerName?.trim() || 'filesystem'
    this.maxCandidatesPerRoot = resolveLimit(config.maxCandidatesPerRoot)
    this.syncFromSupervisor()
    const supervisor = ctx.get('supervisor')
    if (supervisor !== undefined) {
      this.supervisorDisposer = supervisor.registerProjectProvider(this)
      ctx.effect(() => () => {
        this.supervisorDisposer?.()
        this.supervisorDisposer = undefined
      }, 'supervisor-project-registry.provider')
    }
  }

  /**
   * Return currently enrolled projects, excluding removed records.
   * @returns enrolled project snapshots.
   */
  list(): readonly RegisteredProject[] {
    this.syncFromSupervisor()
    return [...this.projects.values()].map(project => ({ ...project }))
  }

  /**
   * Look up one enrolled project by opaque id.
   * @param id - project identity.
   * @returns the project, or undefined.
   */
  get(id: SupervisorProjectId): RegisteredProject | undefined {
    this.syncFromSupervisor()
    const project = [...this.projects.values()].find(candidate => candidate.id === id)
    return project === undefined ? undefined : { ...project }
  }

  /**
   * Enumerate immediate children of explicit roots. The method never reads file
   * contents, writes a Packet, or enrolls a candidate; callers must confirm
   * one result through {@link registerProject}.
   * @param options - explicit roots, item bound, and optional cancellation.
   * @returns metadata-only candidates in deterministic path order.
   */
  async suggestProjects(options: ProjectDiscoveryOptions): Promise<readonly ProjectCandidate[]> {
    this.syncFromSupervisor()
    if (options.roots.length === 0) return []
    const limit = resolveLimit(options.maxCandidatesPerRoot ?? this.maxCandidatesPerRoot)
    const candidates: ProjectCandidate[] = []
    for (const root of options.roots) {
      options.signal?.throwIfAborted()
      const rootObservation = await observePath(root, options.signal)
      if (rootObservation.kind !== 'directory' && rootObservation.kind !== 'symlink' && rootObservation.kind !== 'junction') {
        candidates.push(this.candidate(rootObservation))
        continue
      }

      // A supplied root with a Git marker is itself a useful project candidate.
      if (rootObservation.isWorktree || await hasGitDirectory(rootObservation.realPath as string, options.signal)) {
        candidates.push(this.candidate(rootObservation))
      }
      let entries
      try {
        entries = await readdir(rootObservation.realPath as string, { withFileTypes: true })
      } catch (error: unknown) {
        if (isAbort(error)) throw error
        candidates.push(this.candidate({ ...rootObservation, kind: 'inaccessible', reason: errorMessage(error) }))
        continue
      }
      let inspected = 0
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        options.signal?.throwIfAborted()
        if (inspected >= limit) break
        const observation = await observePath(resolve(rootObservation.realPath as string, entry.name), options.signal)
        if (!isDirectoryKind(observation.kind)) continue
        inspected += 1
        candidates.push(this.candidate(observation))
      }
    }
    return candidates.sort((left, right) => left.path.localeCompare(right.path))
  }

  /**
   * Enroll an existing directory after user confirmation. Canonical realpaths
   * make symlink and junction aliases idempotent; a missing or non-directory
   * path fails without publishing state.
   * @param path - user-confirmed directory path.
   * @param displayName - optional label; defaults to the canonical basename.
   * @returns the committed project snapshot.
   */
  async registerProject(path: string, displayName?: string): Promise<RegisteredProject> {
    return await this.enqueue(() => {
      this.syncFromSupervisor()
      // Canonicalization belongs inside the same queue as the uniqueness check:
      // a path alias can be retargeted between two callers, so an observation
      // made before admission would not protect the publication it precedes.
      return this.registerObserved(path, displayName)
    })
  }

  private async registerObserved(path: string, displayName?: string): Promise<RegisteredProject> {
    const observation = await observePath(path)
    if (observation.realPath === undefined || !isDirectoryKind(observation.kind)) {
      throw new ProjectPathUnavailableError(observation.inputPath, observation.reason ?? observation.kind)
    }
    const existing = this.findByRealPath(observation.realPath)
    if (existing !== undefined) return { ...existing }

    const now = new Date().toISOString()
    const snapshot: SupervisorProjectSnapshot = {
      id: SupervisorProjectId(randomUUID()),
      revision: 1,
      displayName: displayName?.trim() || basename(observation.realPath),
      realPath: observation.realPath,
      status: 'registered',
      registeredAt: now,
    }
    this.publish(snapshot)
    this.enrollmentPaths.set(String(snapshot.id), observation.inputPath)
    return { ...snapshot }
  }

  /**
   * Re-check registered paths and publish `unavailable` only after a definite
   * disappearance. Other I/O failures propagate so permission faults are not
   * mistaken for missing projects.
   * @returns the refreshed project snapshots.
   */
  async refreshStatuses(): Promise<readonly RegisteredProject[]> {
    return await this.enqueue(async () => {
      this.syncFromSupervisor()
      for (const project of [...this.projects.values()]) {
        const observation = await observePath(this.enrollmentPaths.get(String(project.id)) ?? project.realPath)
        if (observation.kind === 'inaccessible') {
          throw new ProjectPathUnavailableError(project.realPath, observation.reason ?? 'path is inaccessible')
        }
        // A path that resolves to another canonical target is not silently
        // redirected; the original enrollment becomes unavailable.
        const available = isDirectoryKind(observation.kind) && observation.realPath === project.realPath
        const nextStatus = available ? 'registered' : 'unavailable'
        if (project.status !== nextStatus) this.publish({ ...project, revision: project.revision + 1, status: nextStatus })
      }
      return this.list()
    })
  }

  /**
   * Remove only the central enrollment relation. Project files, directories,
   * sessions, and any governance records remain untouched; repeated removal is
   * an idempotent false result.
   * @param id - project identity to remove.
   * @returns a promise resolving to true when an active registration was removed.
   */
  async removeProject(id: SupervisorProjectId): Promise<boolean> {
    return await this.enqueue(() => {
      this.syncFromSupervisor()
      const project = this.projects.get(String(id))
      if (project === undefined) return false
      this.publish({ ...project, revision: project.revision + 1, status: 'removed' })
      this.projects.delete(String(id))
      this.enrollmentPaths.delete(String(id))
      return true
    })
  }

  /**
   * Merge central-ledger projects this process has not observed yet. Service
   * construction can precede the controller ledger replay, so restored
   * registrations become visible only here; the merge never republishes.
   */
  private syncFromSupervisor(): void {
    const supervisor = this.ctx.get('supervisor')
    if (supervisor === undefined) return
    for (const project of supervisor.listProjects()) {
      const id = String(project.id)
      if (project.status === 'removed' || this.projects.has(id)) continue
      this.projects.set(id, { ...project })
      this.enrollmentPaths.set(id, project.realPath)
    }
  }

  private candidate(observation: PathObservation): ProjectCandidate {
    const registered = observation.realPath === undefined ? undefined : this.findByRealPath(observation.realPath)
    return {
      path: observation.inputPath,
      ...observation.realPath === undefined ? {} : { realPath: observation.realPath },
      displayName: basename(observation.inputPath),
      kind: observation.kind,
      isWorktree: observation.isWorktree,
      ...registered === undefined ? {} : { registeredProjectId: registered.id },
      ...observation.reason === undefined ? {} : { reason: observation.reason },
    }
  }

  private findByRealPath(realPath: string): SupervisorProjectSnapshot | undefined {
    return [...this.projects.values()].find(project => project.realPath === realPath)
  }

  private publish(snapshot: SupervisorProjectSnapshot): void {
    const previous = this.projects.get(String(snapshot.id))
    if (previous !== undefined && snapshot.revision !== previous.revision + 1) {
      throw new Error(`project '${snapshot.id}' revision must increment from ${previous.revision}`)
    }
    this.projects.set(String(snapshot.id), { ...snapshot })
    const supervisor = this.ctx.get('supervisor')
    if (supervisor !== undefined) this.ctx.emit('supervisor/project', { type: 'supervisor/project', version: 1, snapshot })
  }

  /** Serialize canonicalization checks and publication for concurrent callers. */
  private enqueue<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => undefined, () => undefined)
    return result
  }
}

async function observePath(path: string, signal?: AbortSignal): Promise<PathObservation> {
  const inputPath = resolve(path)
  signal?.throwIfAborted()
  let lstatResult
  try {
    lstatResult = await lstat(inputPath)
  } catch (error: unknown) {
    if (isMissing(error)) return { inputPath, kind: 'missing', isWorktree: false, reason: 'path does not exist' }
    if (isAbort(error)) throw error
    throw error
  }
  let realPath: string
  try {
    realPath = await realpath(inputPath)
    const target = await stat(realPath)
    if (!target.isDirectory()) return { inputPath, realPath, kind: 'not-directory', isWorktree: false, reason: 'path is not a directory' }
  } catch (error: unknown) {
    if (isMissing(error)) return { inputPath, kind: 'missing', isWorktree: false, reason: 'path target does not exist' }
    if (isAbort(error)) throw error
    return { inputPath, kind: 'inaccessible', isWorktree: false, reason: errorMessage(error) }
  }
  const linkKind: ProjectPathKind | undefined = lstatResult.isSymbolicLink()
    ? process.platform === 'win32' ? 'junction' : 'symlink'
    : undefined
  return { inputPath, realPath, kind: linkKind ?? 'directory', isWorktree: await hasGitFile(realPath, signal) }
}

async function hasGitFile(directory: string, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted()
  try { return (await lstat(resolve(directory, '.git'))).isFile() }
  catch (error: unknown) { if (isMissing(error)) return false; if (isAbort(error)) throw error; throw error }
}

async function hasGitDirectory(directory: string, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted()
  try { return (await lstat(resolve(directory, '.git'))).isDirectory() }
  catch (error: unknown) { if (isMissing(error)) return false; if (isAbort(error)) throw error; throw error }
}

function isDirectoryKind(kind: ProjectPathKind): boolean {
  return kind === 'directory' || kind === 'symlink' || kind === 'junction'
}

function resolveLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_MAX_CANDIDATES_PER_ROOT
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('project discovery candidate limit must be a positive safe integer')
  return limit
}

function isMissing(error: unknown): boolean { return (error as NodeJS.ErrnoException | null)?.code === ENOENT }
function isAbort(error: unknown): boolean { return (error as { name?: unknown } | null)?.name === 'AbortError' || (error as { code?: unknown } | null)?.code === 'ABORT_ERR' }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }

export default SupervisorProjectRegistry
