/** Hidden project hosts and child-first lifetime ownership for Personal Supervisor execution. */

import { Context, Service } from '@deepseek-ai/cordis'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-supervisor'
import type {
  SupervisorProjectId,
  SupervisorProjectSnapshot,
  SupervisorRunLink,
  SupervisorRunId,
} from '@deepseek-ai/dsh-supervisor'
import { SupervisorProjectWriteGate } from './gate.ts'
import type {
  SupervisorChildLifecycle,
  SupervisorProjectHostSnapshot,
  SupervisorRunAdmissionRequest,
  SupervisorRunLease,
  SupervisorRunRecovery,
} from './types.ts'

export * from './gate.ts'
export * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { supervisorProjectHost: SupervisorProjectHostService }
}

/** Raised when a host request does not identify an active registered project. */
export class SupervisorProjectHostUnavailableError extends Error {
  /** @param projectId - requested project identity. */
  constructor(readonly projectId: SupervisorProjectId) {
    super(`Supervisor project '${projectId}' is not available for execution`)
    this.name = 'SupervisorProjectHostUnavailableError'
  }
}

/** Raised when restart observes an unfinished link without a proof of settlement. */
export class SupervisorProjectHostRecoveryRequiredError extends Error {
  /** @param runId - unresolved durable run. */
  constructor(readonly runId: SupervisorRunId) {
    super(`Supervisor run '${runId}' requires explicit recovery before another writer can start`)
    this.name = 'SupervisorProjectHostRecoveryRequiredError'
  }
}

interface HostRecord {
  readonly snapshot: SupervisorProjectHostSnapshot
  readonly session: Session
  readonly detach: () => void
}

interface RunRecord {
  readonly request: SupervisorRunAdmissionRequest
  readonly link: SupervisorRunLink
  lifecycle: SupervisorChildLifecycle | undefined
  settled: boolean
  released: boolean
  recoveryRequired: boolean
}

/**
 * Owns hidden Sessions for explicitly registered projects. The service never
 * invokes a model or starts a subagent; the executor bridge acquires a lease
 * before it creates its child, attaches exact child ownership, and releases it
 * after the child settles. This makes the project writer lock cover admission,
 * execution, cancellation, and teardown rather than a task-label convention.
 */
export class SupervisorProjectHostService extends Service {
  static inject = ['sessions', 'sessionPersistence', 'supervisor']

  private readonly hosts = new Map<string, HostRecord>()
  private readonly runs = new Map<string, RunRecord>()
  private readonly gates = new SupervisorProjectWriteGate()
  private readonly projectTails = new Map<string, Promise<void>>()
  private stopping = false

  /** @param ctx - context supplying durable Sessions and current project snapshots. */
  constructor(ctx: Context) {
    super(ctx, 'supervisorProjectHost')
    ctx.effect(() => async () => { await this.disposeRuntime() }, 'supervisor-project-host.runtime')
  }

  /**
   * Return a detached hidden-host description, if it is currently resident.
   * @param projectId - registered project identity.
   * @returns resident host metadata, if present.
   */
  getHost(projectId: SupervisorProjectId): SupervisorProjectHostSnapshot | undefined {
    const host = this.hosts.get(String(projectId))
    return host === undefined ? undefined : { ...host.snapshot }
  }

  /**
   * Create or restore the exact hidden host for a registered project.
   * @param projectId - registered project identity.
   * @returns durable host metadata after publication.
   */
  async ensureHost(projectId: SupervisorProjectId): Promise<SupervisorProjectHostSnapshot> {
    this.assertOpen()
    return await this.serialize(projectId, () => this.ensureHostLocked(projectId))
  }

  /**
   * Reserve a project execution slot before starting its child. A read-only
   * reviewer can coexist with a writer, but a second writer is rejected until
   * the first exact lease releases.
   * @param request - project, task, child, executor and permission facts.
   * @returns a lease that owns exactly one admitted child lifecycle.
   */
  async admit(request: SupervisorRunAdmissionRequest): Promise<SupervisorRunLease> {
    this.assertOpen()
    return await this.serialize(request.projectId, async () => {
      this.assertOpen()
      if (this.runs.has(String(request.runId))) throw new Error(`Supervisor run '${request.runId}' is already admitted`)
      const host = await this.ensureHostLocked(request.projectId)
      this.assertOpen()
      this.gates.admit(String(request.projectId), request.runId, request.writeAccess)
      const link: SupervisorRunLink = {
        revision: 1,
        runId: request.runId,
        taskId: request.taskId,
        projectId: request.projectId,
        hostSessionId: host.sessionId,
        childSessionId: request.childSessionId,
        executor: request.executor,
        ...request.model === undefined ? {} : { model: request.model },
        writeAccess: request.writeAccess,
      }
      const record: RunRecord = { request, link, lifecycle: undefined, settled: true, released: false, recoveryRequired: false }
      this.runs.set(String(request.runId), record)
      this.ctx.emit('supervisor/run-linked', { type: 'supervisor/run-linked', version: 1, snapshot: link })
      return this.lease(record)
    })
  }

  /**
   * Reconcile durable links supplied by the central projection after restart.
   * A link with a live child reclaims its writer lock; an uncertain writer is
   * deliberately refused, so the orchestrator cannot repeat unsafe work.
   * @param recoveries - central-projection observations for previously linked runs.
   * @returns leases for recovered live children; the provider attaches each exact lifecycle so settlement can release its gate.
   */
  async reconcile(recoveries: readonly SupervisorRunRecovery[]): Promise<readonly SupervisorRunLease[]> {
    this.assertOpen()
    const leases: SupervisorRunLease[] = []
    for (const recovery of recoveries) {
      await this.serialize(recovery.link.projectId, async () => {
        this.assertOpen()
        if (this.runs.has(String(recovery.link.runId))) return
        const host = await this.ensureHostLocked(recovery.link.projectId)
        this.assertOpen()
        this.assertRecoveredLink(recovery.link, host)
        if (!recovery.childIsLive) {
          if (recovery.link.writeAccess) throw new SupervisorProjectHostRecoveryRequiredError(recovery.link.runId)
          return
        }
        this.gates.admit(String(recovery.link.projectId), recovery.link.runId, recovery.link.writeAccess)
        const record: RunRecord = {
          request: {
            projectId: recovery.link.projectId,
            taskId: recovery.link.taskId,
            runId: recovery.link.runId,
            childSessionId: recovery.link.childSessionId,
            executor: recovery.link.executor,
            ...recovery.link.model === undefined ? {} : { model: recovery.link.model },
            writeAccess: recovery.link.writeAccess,
          },
          link: recovery.link,
          lifecycle: undefined,
          // A recovered link proves that an external child is live, not that
          // it has settled. Hold the writer gate until its provider attaches
          // the exact lifecycle and that lifecycle reaches done.
          settled: false,
          released: false,
          recoveryRequired: false,
        }
        this.runs.set(String(recovery.link.runId), record)
        leases.push(this.lease(record))
      })
    }
    return leases
  }

  private lease(record: RunRecord): SupervisorRunLease {
    let attached = false
    return {
      link: record.link,
      attach: (lifecycle): void => {
        if (attached || record.released || record.lifecycle !== undefined) throw new Error(`Supervisor run '${record.link.runId}' cannot attach another child`)
        attached = true
        record.lifecycle = lifecycle
        record.settled = false
        void lifecycle.done.then(
          () => { record.settled = true; return this.release(record) },
          () => { record.settled = true; return this.release(record) },
        )
      },
      cancel: async (): Promise<void> => {
        const child = record.lifecycle
        if (child !== undefined) {
          try {
            await child.cancel()
          } catch (error) {
            this.markRecoveryRequired(record, error)
            throw new SupervisorProjectHostRecoveryRequiredError(record.link.runId)
          }
          await child.done.catch(() => undefined)
        }
        await this.release(record)
      },
      release: async (): Promise<void> => {
        if (record.recoveryRequired || !record.settled) {
          throw new SupervisorProjectHostRecoveryRequiredError(record.link.runId)
        }
        await this.release(record)
      },
    }
  }

  private async release(record: RunRecord): Promise<void> {
    const detachable = await this.serialize(record.request.projectId, () => {
      if (record.released) return
      record.released = true
      this.runs.delete(String(record.link.runId))
      this.gates.release(String(record.request.projectId), record.request.runId, record.request.writeAccess)
      if (!this.stopping || [...this.runs.values()].some(candidate => candidate.link.projectId === record.link.projectId)) return
      const host = this.hosts.get(String(record.link.projectId))
      if (host === undefined) return
      this.hosts.delete(String(record.link.projectId))
      return host
    })
    if (detachable !== undefined) {
      const sessions = this.ctx.get('sessions')
      if (sessions !== undefined) await sessions.flush(detachable.session)
      detachable.detach()
    }
  }

  /** Keep a run's writer gate until its already-attached child proves settlement. */
  private markRecoveryRequired(record: RunRecord, failure: unknown): void {
    record.recoveryRequired = true
    this.ctx.logger.warn(`Supervisor run '${record.link.runId}' cancellation failed; retaining its project writer gate until child settlement: ${String(failure)}`)
  }

  private async createHost(project: SupervisorProjectSnapshot, sessionId: SessionId): Promise<SupervisorProjectHostSnapshot> {
    const prepared = this.ctx.sessions.prepare(sessionId, { meta: { cwd: project.realPath } })
    try {
      await this.ctx.sessionPersistence.create(prepared.header)
    } catch (error) {
      // No store entry was published, so the prepared Session remains private
      // and callers can retry without an accidental live host.
      throw error
    }
    let detach: (() => void) | undefined
    try {
      detach = this.ctx.sessions.enter(prepared)
      this.ctx.sessions.announce(prepared)
      await this.ctx.sessions.flush(prepared)
      return this.recordHost(project, prepared, detach)
    } catch (error) {
      detach?.()
      throw error
    }
  }

  /** Resolve one project host while its caller already owns the project queue. */
  private async ensureHostLocked(projectId: SupervisorProjectId): Promise<SupervisorProjectHostSnapshot> {
    this.assertOpen()
    const existing = this.hosts.get(String(projectId))
    if (existing !== undefined) return { ...existing.snapshot }
    const project = this.requireAvailableProject(projectId)
    const sessionId = hostSessionId(projectId)
    const live = this.ctx.sessions.get(sessionId)
    if (live !== undefined) {
      this.assertHostCwd(live, project)
      return this.recordHost(project, live, () => { /* externally owned live Session */ })
    }
    const persisted = (await this.ctx.sessionPersistence.list()).some(header => header.id === sessionId)
    return persisted ? await this.restoreHost(project, sessionId) : await this.createHost(project, sessionId)
  }

  private async restoreHost(project: SupervisorProjectSnapshot, sessionId: SessionId): Promise<SupervisorProjectHostSnapshot> {
    const preparation = await this.ctx.sessionPersistence.prepare(sessionId)
    try {
      const restored = preparation.session
      this.assertHostCwd(restored, project)
      const detach = this.ctx.sessions.enter(restored)
      try {
        this.ctx.sessions.announce(restored)
        await this.ctx.sessions.flush(restored)
        return this.recordHost(project, restored, detach)
      } catch (error) {
        detach()
        throw error
      }
    } finally {
      preparation[Symbol.dispose]()
    }
  }

  private recordHost(project: SupervisorProjectSnapshot, session: Session, detach: () => void): SupervisorProjectHostSnapshot {
    const snapshot: SupervisorProjectHostSnapshot = { projectId: project.id, sessionId: session.id, cwd: project.realPath }
    this.hosts.set(String(project.id), { snapshot, session, detach })
    return { ...snapshot }
  }

  private requireAvailableProject(projectId: SupervisorProjectId): SupervisorProjectSnapshot {
    const project = this.ctx.supervisor.getProject(projectId)
    if (project === undefined || project.status !== 'registered') throw new SupervisorProjectHostUnavailableError(projectId)
    return project
  }

  private assertHostCwd(session: Session, project: SupervisorProjectSnapshot): void {
    if (session.header.cwd !== project.realPath) {
      throw new SupervisorProjectHostUnavailableError(project.id)
    }
  }

  /** Reject a recovered run that cannot belong to this exact registered host. */
  private assertRecoveredLink(link: SupervisorRunLink, host: SupervisorProjectHostSnapshot): void {
    const project = this.requireAvailableProject(link.projectId)
    if (link.hostSessionId !== host.sessionId
      || link.hostSessionId !== hostSessionId(link.projectId)
      || host.cwd !== project.realPath
      || link.childSessionId === link.hostSessionId) {
      throw new SupervisorProjectHostUnavailableError(link.projectId)
    }
  }

  private serialize<T>(projectId: SupervisorProjectId, operation: () => Promise<T> | T): Promise<T> {
    const key = String(projectId)
    const tail = this.projectTails.get(key) ?? Promise.resolve()
    const result = tail.then(operation)
    this.projectTails.set(key, result.then(() => undefined, () => undefined))
    return result
  }

  private assertOpen(): void {
    if (this.stopping) throw new Error('Supervisor project hosts are stopping')
  }

  private async disposeRuntime(): Promise<void> {
    this.stopping = true
    await this.drainProjectQueues()
    const records = [...this.runs.values()]
    const protectedHosts = new Set<string>()
    await Promise.all(records.map(async (record) => {
      const child = record.lifecycle
      if (child === undefined && !record.settled) {
        this.markRecoveryRequired(record, new Error('recovered live child has not attached its lifecycle'))
        protectedHosts.add(String(record.link.projectId))
        return
      }
      if (child !== undefined) {
        try {
          await child.cancel()
        } catch (error) {
          this.markRecoveryRequired(record, error)
          protectedHosts.add(String(record.link.projectId))
          return
        }
        await child.done.catch(() => undefined)
      }
      await this.release(record)
    }))
    for (const [projectId, host] of this.hosts) {
      if (protectedHosts.has(projectId)) continue
      await this.ctx.sessions.flush(host.session)
      host.detach()
      this.hosts.delete(projectId)
    }
  }

  /** Wait for operations admitted before close, while new operations reject at their entry point. */
  private async drainProjectQueues(): Promise<void> {
    const tails = [...this.projectTails.values()]
    await Promise.all(tails.map(tail => tail.catch(() => undefined)))
  }
}

/**
 * Derive the stable hidden host identity for one registered project.
 * @param projectId - exact registered project identity.
 * @returns deterministic hidden Session identity.
 */
export function hostSessionId(projectId: SupervisorProjectId): SessionId {
  return SessionId(`supervisor-project-host:${projectId}`)
}

export default SupervisorProjectHostService
