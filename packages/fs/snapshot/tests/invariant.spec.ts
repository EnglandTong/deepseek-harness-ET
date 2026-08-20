/** Tests for the snapshot invariant companion: event-data validation on replay and dispatch. */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import * as SnapshotInvariant from '@deepseek-ai/dsh-snapshot/invariant'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(SnapshotInvariant)
  return ctx
}

function invariantError(message: string): Partial<InvariantError> {
  return expect.objectContaining({ code: 'INVARIANT', packageName: '@deepseek-ai/dsh-snapshot', message: expect.stringMatching(message) })
}

describe('snapshot invariant companion', () => {
  it('registers under the package name and requires the invariants service', () => {
    expect(SnapshotInvariant.name).toBe('snapshot-invariant')
    expect(SnapshotInvariant.inject).toEqual(['invariants'])
  })

  it('rejects a malformed snapshot create before committing it', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('snapshot-invariant-invalid'))
    expect(() => {
      session.append('snapshot/create', { id: '', reason: 'r' })
    }).toThrow(invariantError('snapshot event id'))
    expect(() => {
      session.append('snapshot/create', { id: 's1', reason: 5 } as never)
    }).toThrow(invariantError('reason must be a string'))
  })

  it('rejects malformed restore payloads and accepts well-formed events', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('snapshot-invariant-malformed'))
    expect(() => {
      session.append('snapshot/restore', { id: 's1', restored: -1, removed: 0 })
    }).toThrow(invariantError('restored must be a non-negative safe integer'))
    expect(() => {
      session.append('snapshot/restore', { id: 's1', restored: 1.5, removed: 0 })
    }).toThrow(invariantError('restored must be a non-negative safe integer'))
    expect(() => {
      session.append('snapshot/restore', { id: 's1', restored: 2, removed: -1 })
    }).toThrow(invariantError('removed must be a non-negative safe integer'))

    session.append('snapshot/create', { id: 's1', reason: 'before refactor' })
    expect(() => {
      session.append('snapshot/restore', { id: 's1', restored: 3, removed: 1 })
    }).not.toThrow()
  })

  it('reconstructs an existing durable snapshot log before checking later events', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('snapshot-invariant-late-load'))
    session.append('snapshot/create', { id: 's1', reason: 'before load' })

    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(SnapshotInvariant)
    expect(() => {
      session.append('snapshot/restore', { id: 's1', restored: 1, removed: 0 })
    }).not.toThrow()
    expect(() => {
      session.append('snapshot/restore', { id: '', restored: 1, removed: 0 })
    }).toThrow(invariantError('snapshot event id'))
  })

  it('passes unrelated events through untouched', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('snapshot-invariant-unrelated'))
    expect(() => {
      session.append('todo/write', { todos: [] } as never)
    }).not.toThrow()
  })
})
