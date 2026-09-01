import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SqliteSessionPersistence from '@deepseek-ai/dsh-session-persistence-sqlite'
import SupervisorService, { SupervisorProjectId, SupervisorTaskId } from '@deepseek-ai/dsh-supervisor'
import SupervisorSessionService from '../src/index.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

class TestSettings extends SettingsProvider {
  constructor(ctx: Context, private readonly state: Record<string, unknown>) { super(ctx) }
  get writable(): boolean { return true }
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve(structuredClone(this.state)) }
  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.state[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function boot(root: string, settings: Record<string, unknown>): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(TestSettings, settings)
  await ctx.plugin(SupervisorService)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  await ctx.plugin(SupervisorSessionService)
  return ctx
}

async function bootSqlite(path: string, settings: Record<string, unknown>): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(TestSettings, settings)
  await ctx.plugin(SupervisorService)
  await ctx.plugin(SqliteSessionPersistence, { path, journalMode: 'delete' })
  await ctx.plugin(SupervisorSessionService)
  return ctx
}

describe('SupervisorSessionService JSONL durability', () => {
  it('persists controller project events and restores them after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-jsonl-'))
    roots.push(root)
    const settings: Record<string, unknown> = {}
    const first = await boot(root, settings)
    first.emit('supervisor/project', {
      type: 'supervisor/project',
      version: 1,
      snapshot: {
        id: SupervisorProjectId('project-a'), revision: 1, displayName: 'Project A', realPath: 'C:/Project A',
        status: 'registered', registeredAt: new Date(0).toISOString(),
      },
    })
    await first.sessions.flush(first.supervisorSession.current!)
    const id = SessionId('supervisor-main')
    const stored = await first.sessionPersistence.inspect(id)
    expect(stored.events.some(event => event.type === 'supervisor/project')).toBe(true)
    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)

    const second = await boot(root, settings)
    const restored = await second.sessionPersistence.inspect(id)
    expect(restored.events.filter(event => event.type === 'supervisor/project')).toHaveLength(1)
    expect(second.supervisorSession.current?.id).toBe(id)
  })

  it('keeps the same singleton and event vocabulary on SQLite', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-sqlite-'))
    roots.push(root)
    const settings: Record<string, unknown> = {}
    const first = await bootSqlite(join(root, 'sessions.db'), settings)
    first.emit('supervisor/task', {
      type: 'supervisor/task',
      version: 1,
      snapshot: {
        id: SupervisorTaskId('task-a'), projectId: SupervisorProjectId('project-a'), revision: 1, title: 'Task', description: '',
        status: 'Captured', nextAction: 'Classify',
      },
    })
    await first.sessions.flush(first.supervisorSession.current!)
    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)
    const second = await bootSqlite(join(root, 'sessions.db'), settings)
    const restored = await second.sessionPersistence.inspect(SessionId('supervisor-main'))
    expect(restored.events.some(event => event.type === 'supervisor/task')).toBe(true)
    expect(second.supervisorSession.current?.id).toBe(SessionId('supervisor-main'))
  })
})
