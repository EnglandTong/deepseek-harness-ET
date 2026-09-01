import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionPersistence, SessionPersistenceRevision, type SessionInspection, type SessionPersistenceSnapshot } from '@deepseek-ai/dsh-session-persistence'
import SupervisorService, { SupervisorProjectId, SupervisorRunId, SupervisorTaskId } from '@deepseek-ai/dsh-supervisor/src/index.ts'
import {
  SupervisorProjectHostRecoveryRequiredError,
  SupervisorProjectHostService,
  SupervisorProjectWriteBusyError,
  SupervisorProjectWriteGate,
  hostSessionId,
} from '../src/index.ts'

interface SharedState { readonly sessions: Map<string, { readonly meta: SessionHeader; readonly events: SessionEvent[] }> }

class MemoryPersistence extends SessionPersistence {
  override readonly supportsRawArtifacts = false
  static inject = ['sessions']
  /** @param ctx - owning test context. @param shared - test-owned durable rows. */
  constructor(ctx: Context, private readonly shared: SharedState) { super(ctx) }
  locate(_meta: SessionHeader): undefined { return undefined }
  create(meta: SessionHeader): Promise<void> {
    if (this.shared.sessions.has(String(meta.id))) return Promise.reject(new Error('persisted id collision'))
    this.shared.sessions.set(String(meta.id), { meta: structuredClone(meta), events: [] })
    return Promise.resolve()
  }
  append(_id: SessionId, _events: readonly SessionEvent[]): Promise<void> { return Promise.resolve() }
  async load(id: SessionId): Promise<SessionInspection> {
    const record = this.shared.sessions.get(String(id))
    if (record === undefined) throw new Error(`missing session ${id}`)
    return { meta: structuredClone(record.meta), events: structuredClone(record.events) }
  }
  inspect(id: SessionId): Promise<SessionInspection> { return this.load(id) }
  async readFrom(id: SessionId, fromSeq: number): Promise<{ meta: SessionHeader; events: SessionEvent[] }> {
    const loaded = await this.load(id)
    return { meta: loaded.meta, events: loaded.events.filter(event => event.seq >= fromSeq) }
  }
  async list(): Promise<SessionHeader[]> { return [...this.shared.sessions.values()].map(record => structuredClone(record.meta)) }
  async listSnapshots(): Promise<SessionPersistenceSnapshot[]> {
    return [...this.shared.sessions.values()].map(record => ({
      header: structuredClone(record.meta), revision: SessionPersistenceRevision(String(record.events.length)),
    }))
  }
}

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

async function boot(shared: SharedState = { sessions: new Map() }): Promise<{ ctx: Context; host: SupervisorProjectHostService }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(MemoryPersistence, shared)
  await ctx.plugin(SupervisorService)
  for (const [id, realPath] of [['project-a', 'C:\\projects\\a'], ['project-b', 'C:\\projects\\b']] as const) {
    ctx.emit('supervisor/project', {
      type: 'supervisor/project', version: 1,
      snapshot: { id: SupervisorProjectId(id), revision: 1, displayName: id, realPath, status: 'registered', registeredAt: '2026-08-31T00:00:00.000Z' },
    })
  }
  await ctx.plugin(SupervisorProjectHostService)
  return { ctx, host: ctx.supervisorProjectHost }
}

describe('Supervisor project host admission primitives', () => {
  it('uses a stable hidden Session id per project', () => {
    const project = SupervisorProjectId('project-a')
    expect(hostSessionId(project)).toBe(SessionId('supervisor-project-host:project-a'))
    expect(hostSessionId(SupervisorProjectId('project-b'))).not.toBe(hostSessionId(project))
  })

  it('serializes same-project writers while allowing concurrent reviewers', () => {
    const gate = new SupervisorProjectWriteGate()
    const writer = SupervisorRunId('writer')
    gate.admit('project-a', writer, true)
    gate.admit('project-a', SupervisorRunId('reviewer-a'), false)
    gate.admit('project-a', SupervisorRunId('reviewer-b'), false)
    expect(gate.owner('project-a')).toBe(writer)
    expect(() =>{  gate.admit('project-a', SupervisorRunId('second-writer'), true) })
      .toThrow(SupervisorProjectWriteBusyError)
    gate.release('project-a', SupervisorRunId('forged'), true)
    expect(gate.owner('project-a')).toBe(writer)
    gate.release('project-a', writer, true)
    expect(gate.owner('project-a')).toBeUndefined()
    expect(() =>{  gate.admit('project-a', SupervisorRunId('second-writer'), true) }).not.toThrow()
  })

  it('keeps writer admission independent across projects', () => {
    const gate = new SupervisorProjectWriteGate()
    expect(() => {
      gate.admit('project-a', SupervisorRunId('writer-a'), true)
      gate.admit('project-b', SupervisorRunId('writer-b'), true)
    }).not.toThrow()
  })

  it('creates isolated hidden hosts and releases a settled exact child', async () => {
    const { ctx, host } = await boot()
    const projectA = SupervisorProjectId('project-a')
    const projectB = SupervisorProjectId('project-b')
    const [a, b] = await Promise.all([host.ensureHost(projectA), host.ensureHost(projectB)])
    expect(a).toMatchObject({ sessionId: hostSessionId(projectA), cwd: 'C:\\projects\\a' })
    expect(b).toMatchObject({ sessionId: hostSessionId(projectB), cwd: 'C:\\projects\\b' })
    expect(ctx.sessions.get(a.sessionId)?.header.cwd).toBe('C:\\projects\\a')
    expect(ctx.sessions.get(b.sessionId)?.header.cwd).toBe('C:\\projects\\b')

    const lease = await host.admit({
      projectId: projectA, taskId: SupervisorTaskId('task-a'), runId: SupervisorRunId('run-a'),
      childSessionId: SessionId('child-a'), executor: 'mock', writeAccess: true,
    })
    const done = Promise.withResolvers<undefined>()
    let cancelled = 0
    lease.attach({ done: done.promise, cancel: () => { cancelled += 1; done.resolve(undefined) } })
    await lease.cancel()
    expect(cancelled).toBe(1)
    await expect(host.admit({
      projectId: projectA, taskId: SupervisorTaskId('task-b'), runId: SupervisorRunId('run-b'),
      childSessionId: SessionId('child-b'), executor: 'mock', writeAccess: true,
    })).resolves.toMatchObject({ link: { runId: 'run-b' } })
  })

  it('validates recovered host identity and refuses uncertain recovered writers', async () => {
    const { host } = await boot()
    const project = SupervisorProjectId('project-a')
    const lease = await host.admit({
      projectId: project, taskId: SupervisorTaskId('task-a'), runId: SupervisorRunId('run-a'),
      childSessionId: SessionId('child-a'), executor: 'mock', writeAccess: true,
    })
    const valid = lease.link
    await lease.release()
    await expect(host.reconcile([{ link: { ...valid, hostSessionId: SessionId('wrong-host') }, childIsLive: true }]))
      .rejects.toThrow(/not available/)
    await expect(host.reconcile([{ link: valid, childIsLive: false }]))
      .rejects.toBeInstanceOf(SupervisorProjectHostRecoveryRequiredError)
  })

  it('returns a recovered live-child lease and frees its writer on failure settlement', async () => {
    const { host } = await boot()
    const project = SupervisorProjectId('project-a')
    const initial = await host.admit({
      projectId: project, taskId: SupervisorTaskId('task-a'), runId: SupervisorRunId('run-a'),
      childSessionId: SessionId('child-a'), executor: 'mock', writeAccess: true,
    })
    const link = initial.link
    await initial.release()
    const [recovered] = await host.reconcile([{ link, childIsLive: true }])
    if (recovered === undefined) throw new Error('live recovered run did not return a lease')
    await expect(recovered.release()).rejects.toBeInstanceOf(SupervisorProjectHostRecoveryRequiredError)
    await expect(host.admit({
      projectId: project, taskId: SupervisorTaskId('task-before-attach'), runId: SupervisorRunId('run-before-attach'),
      childSessionId: SessionId('child-before-attach'), executor: 'mock', writeAccess: true,
    })).rejects.toBeInstanceOf(SupervisorProjectWriteBusyError)
    const failed = Promise.withResolvers<undefined>()
    recovered.attach({ done: failed.promise, cancel: () => { failed.reject(new Error('timeout')) } })
    failed.reject(new Error('provider failed'))
    await Promise.resolve()
    await Promise.resolve()
    await expect(host.admit({
      projectId: project, taskId: SupervisorTaskId('task-b'), runId: SupervisorRunId('run-b'),
      childSessionId: SessionId('child-b'), executor: 'mock', writeAccess: true,
    })).resolves.toMatchObject({ link: { runId: 'run-b' } })
  })

  it('retains a writer when exact child cancellation throws until the child settles', async () => {
    const { host } = await boot()
    const project = SupervisorProjectId('project-a')
    const lease = await host.admit({
      projectId: project, taskId: SupervisorTaskId('task-a'), runId: SupervisorRunId('run-a'),
      childSessionId: SessionId('child-a'), executor: 'mock', writeAccess: true,
    })
    const done = Promise.withResolvers<undefined>()
    lease.attach({ done: done.promise, cancel: () => { throw new Error('cancel failed') } })
    await expect(lease.cancel()).rejects.toBeInstanceOf(SupervisorProjectHostRecoveryRequiredError)
    await expect(host.admit({
      projectId: project, taskId: SupervisorTaskId('task-b'), runId: SupervisorRunId('run-b'),
      childSessionId: SessionId('child-b'), executor: 'mock', writeAccess: true,
    })).rejects.toBeInstanceOf(SupervisorProjectWriteBusyError)
    await expect(lease.release()).rejects.toBeInstanceOf(SupervisorProjectHostRecoveryRequiredError)
    done.resolve(undefined)
    await Promise.resolve()
    await Promise.resolve()
    await expect(host.admit({
      projectId: project, taskId: SupervisorTaskId('task-b'), runId: SupervisorRunId('run-b'),
      childSessionId: SessionId('child-b'), executor: 'mock', writeAccess: true,
    })).resolves.toMatchObject({ link: { runId: 'run-b' } })
  })

  it('does not let a caller release an attached child before settlement', async () => {
    const { host } = await boot()
    const project = SupervisorProjectId('project-a')
    const lease = await host.admit({
      projectId: project, taskId: SupervisorTaskId('task-a'), runId: SupervisorRunId('run-a'),
      childSessionId: SessionId('child-a'), executor: 'mock', writeAccess: true,
    })
    const done = Promise.withResolvers<undefined>()
    lease.attach({ done: done.promise, cancel: () => { done.resolve(undefined) } })
    await expect(lease.release()).rejects.toBeInstanceOf(SupervisorProjectHostRecoveryRequiredError)
    await expect(host.admit({
      projectId: project, taskId: SupervisorTaskId('task-b'), runId: SupervisorRunId('run-b'),
      childSessionId: SessionId('child-b'), executor: 'mock', writeAccess: true,
    })).rejects.toBeInstanceOf(SupervisorProjectWriteBusyError)
    done.resolve(undefined)
    await Promise.resolve()
    await Promise.resolve()
    await expect(host.admit({
      projectId: project, taskId: SupervisorTaskId('task-b'), runId: SupervisorRunId('run-b'),
      childSessionId: SessionId('child-b'), executor: 'mock', writeAccess: true,
    })).resolves.toMatchObject({ link: { runId: 'run-b' } })
  })

  it('closes admission, drains an attached child, then detaches its host', async () => {
    const { ctx, host } = await boot()
    const project = SupervisorProjectId('project-a')
    await host.ensureHost(project)
    const lease = await host.admit({
      projectId: project, taskId: SupervisorTaskId('task-a'), runId: SupervisorRunId('run-a'),
      childSessionId: SessionId('child-a'), executor: 'mock', writeAccess: true,
    })
    const done = Promise.withResolvers<undefined>()
    const cancelEntered = Promise.withResolvers<undefined>()
    lease.attach({ done: done.promise, cancel: () => { cancelEntered.resolve(undefined) } })

    const disposing = ctx.fiber.dispose()
    await cancelEntered.promise
    await expect(host.ensureHost(SupervisorProjectId('project-b'))).rejects.toThrow(/stopping/)
    expect(host.getHost(project)).toBeDefined()
    done.resolve(undefined)
    await disposing
    expect(host.getHost(project)).toBeUndefined()
  })

  it('restores a persisted host across contexts before reconciling a live child', async () => {
    const shared: SharedState = { sessions: new Map() }
    const first = await boot(shared)
    const project = SupervisorProjectId('project-a')
    const hostSnapshot = await first.host.ensureHost(project)
    const link = {
      revision: 1,
      runId: SupervisorRunId('restart-run'),
      taskId: SupervisorTaskId('restart-task'),
      projectId: project,
      hostSessionId: hostSnapshot.sessionId,
      childSessionId: SessionId('restart-child'),
      executor: 'mock',
      writeAccess: true,
    } as const
    await first.ctx.fiber.dispose()

    const second = await boot(shared)
    await expect(second.host.ensureHost(project)).resolves.toMatchObject({ sessionId: hostSnapshot.sessionId, cwd: 'C:\\projects\\a' })
    const [recovered] = await second.host.reconcile([{ link, childIsLive: true }])
    if (recovered === undefined) throw new Error('restart recovery did not return a lease')
    const done = Promise.withResolvers<undefined>()
    recovered.attach({ done: done.promise, cancel: () => { done.resolve(undefined) } })
    done.resolve(undefined)
    await Promise.resolve()
    await Promise.resolve()
    await expect(second.host.admit({
      projectId: project, taskId: SupervisorTaskId('after-restart'), runId: SupervisorRunId('after-restart'),
      childSessionId: SessionId('after-restart-child'), executor: 'mock', writeAccess: true,
    })).resolves.toMatchObject({ link: { runId: 'after-restart' } })
  })
})
