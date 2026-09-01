import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionPersistence, SessionPersistenceRevision, type SessionInspection, type SessionPersistenceSnapshot } from '@deepseek-ai/dsh-session-persistence'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SupervisorService from '@deepseek-ai/dsh-supervisor'
import SupervisorSessionService, { DEFAULT_SUPERVISOR_SESSION_ID, SUPERVISOR_SESSION_SETTINGS_NAMESPACE, type SupervisorIdentityData } from '../src/index.ts'

interface SharedState {
  settings: Record<string, unknown>
  sessions: Map<string, { meta: SessionHeader; events: SessionEvent[] }>
  flushes: number
}

class MemorySettings extends SettingsProvider {
  constructor(ctx: Context, private readonly shared: SharedState) { super(ctx) }
  get writable(): boolean { return true }
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve(structuredClone(this.shared.settings)) }
  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.shared.settings[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

class MemoryPersistence extends SessionPersistence {
  override readonly supportsRawArtifacts = false
  static inject = ['sessions']
  constructor(ctx: Context, private readonly shared: SharedState) {
    super(ctx)
    ctx.on('session/event', (session, event) => {
      const record = this.shared.sessions.get(String(session.id))
      if (record !== undefined) record.events.push(structuredClone(event))
    })
    ctx.on('session/flush', () => {
      this.shared.flushes += 1
    })
  }
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
  async list(): Promise<SessionHeader[]> {
    return [...this.shared.sessions.values()].map(record => structuredClone(record.meta))
  }
  async listSnapshots(): Promise<SessionPersistenceSnapshot[]> {
    return [...this.shared.sessions.values()].map(record => ({
      header: structuredClone(record.meta), revision: SessionPersistenceRevision(String(record.events.length)),
    }))
  }
}

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function boot(shared: SharedState): Promise<{
  ctx: Context
  service: SupervisorSessionService
  fiber: { dispose(): Promise<void> }
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(MemorySettings, shared)
  await ctx.plugin(SupervisorService)
  await ctx.plugin(MemoryPersistence, shared)
  const fiber = await ctx.plugin(SupervisorSessionService)
  return { ctx, service: ctx.supervisorSession, fiber }
}

function freshState(): SharedState {
  return { settings: {}, sessions: new Map(), flushes: 0 }
}

describe('SupervisorSessionService', () => {
  it('creates one identity, flushes it, then persists the settings id', async () => {
    const shared = freshState()
    const { ctx, service } = await boot(shared)
    expect(service.current?.id).toBe(DEFAULT_SUPERVISOR_SESSION_ID)
    expect(shared.settings[String(SUPERVISOR_SESSION_SETTINGS_NAMESPACE)]).toEqual({
      supervisorSessionId: String(DEFAULT_SUPERVISOR_SESSION_ID),
    })
    const record = shared.sessions.get(String(DEFAULT_SUPERVISOR_SESSION_ID))!
    expect(record.events).toHaveLength(1)
    expect(record.events[0]?.type).toBe('supervisor/identity')
    expect(shared.flushes).toBeGreaterThan(0)
    expect(ctx.supervisor.identity()).toBe('supervisor')
  })

  it('restores the same Session from the configured persistence backend', async () => {
    const shared = freshState()
    const first = await boot(shared)
    const firstId = first.service.current?.id
    await first.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(first.ctx), 1)
    const second = await boot(shared)
    expect(second.service.current?.id).toBe(firstId)
    // Session.fromRestore appends its `session/end-seed` lifecycle marker.
    expect(second.service.current?.events.filter(event => event.type === 'supervisor/identity')).toHaveLength(1)
  })

  it('rejects a configured id with no persisted Session', async () => {
    const shared = freshState()
    shared.settings[String(SUPERVISOR_SESSION_SETTINGS_NAMESPACE)] = { supervisorSessionId: 'missing' }
    await expect(boot(shared)).rejects.toThrow(/missing Supervisor session/)
  })

  it('rejects duplicate identity events before publishing a restored Session', async () => {
    const shared = freshState()
    const first = await boot(shared)
    const record = shared.sessions.get(String(first.service.current!.id))!
    const duplicate = { ...structuredClone(record.events[0]!), seq: 1 }
    record.events.push(duplicate)
    await first.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(first.ctx), 1)
    await expect(boot(shared)).rejects.toThrow(/exactly one identity/)
  })

  it('rejects a malformed versioned identity payload before restore', async () => {
    const shared = freshState()
    const first = await boot(shared)
    const record = shared.sessions.get(String(first.service.current!.id))!
    const identity = record.events[0]!
    record.events[0] = {
      ...identity,
      data: {
        version: 99,
        snapshot: (identity.data as SupervisorIdentityData).snapshot,
      },
    } as SessionEvent<'supervisor/identity'>
    await first.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(first.ctx), 1)
    await expect(boot(shared)).rejects.toThrow(/invalid Supervisor identity event/)
  })

  it('flushes before detaching on disposal', async () => {
    const shared = freshState()
    const { service, ctx, fiber } = await boot(shared)
    const before = shared.flushes
    await fiber.dispose()
    expect(shared.flushes).toBeGreaterThan(before)
    expect(service.current).toBeUndefined()
    expect(ctx.sessions.get(DEFAULT_SUPERVISOR_SESSION_ID)).toBeUndefined()
  })
})
