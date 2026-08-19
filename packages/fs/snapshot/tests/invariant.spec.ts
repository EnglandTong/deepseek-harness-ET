/** Tests for the snapshot invariant companion: event-data validation on replay and dispatch. */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

const register = vi.fn()
vi.mock('@deepseek-ai/cordis', async (importOriginal) => {
  const original = await importOriginal<typeof import('@deepseek-ai/cordis')>()
  return {
    ...original,
    Context: class extends original.Context {
      invariants = { register }
    },
  }
})

import { apply, inject, name } from '@deepseek-ai/dsh-snapshot/invariant'

type Listener = (mode: unknown, eventName: string, args: unknown) => void

function fakeSession(events: SessionEvent[]): Session {
  return { events } as unknown as Session
}

describe('snapshot invariant companion', () => {
  it('registers under the package name and requires the invariants service', () => {
    expect(name).toBe('snapshot-invariant')
    expect(inject).toEqual(['invariants'])
  })

  it('validates loaded snapshot events at install', async () => {
    let installer: ((ctx: unknown, fail: (m: string) => never) => void) | undefined
    register.mockImplementationOnce((_pkg: string, install: (ctx: unknown, fail: (m: string) => never) => void) => {
      installer = install
      return () => {}
    })
    await apply(new Context())
    expect(installer).toBeDefined()

    const bad = fakeSession([{ type: 'snapshot/create', data: { id: '', reason: 'r' } }])
    const fakeCtx = { sessions: { list: () => [bad] }, on: () => {} }
    expect(() => installer!(fakeCtx, (m: string) => { throw new Error(m) })).toThrow('snapshot event id')

    const good = fakeSession([{ type: 'snapshot/create', data: { id: 's1', reason: 'r' } }])
    const goodCtx = { sessions: { list: () => [good] }, on: () => {} }
    expect(() => installer!(goodCtx, (m: string) => { throw new Error(m) })).not.toThrow()
  })

  it('rejects malformed create and restore payloads, accepts well-formed ones', async () => {
    const dispatchListener = vi.fn()
    register.mockImplementationOnce((_pkg: string, installer: (ctx: never, fail: (m: string) => never) => void) => {
      const ctx = {
        sessions: { list: () => [] },
        on: (_event: string, listener: Listener) => { dispatchListener.mockImplementation(listener) },
      }
      installer(ctx as never, (message: string) => { throw new Error(message) })
      return () => {}
    })
    await apply(new Context())

    const session = fakeSession([])
    const dispatch = (event: SessionEvent) => dispatchListener('emit', 'session/event', [session, event])

    expect(() => dispatch({ type: 'snapshot/create', data: { reason: 'r' } as never })).toThrow('snapshot event id')
    expect(() => dispatch({ type: 'snapshot/create', data: { id: 's1', reason: 5 } as never })).toThrow('reason')
    expect(() => dispatch({ type: 'snapshot/restore', data: { id: 's1', restored: -1, removed: 0 } as never })).toThrow('restored')
    expect(() => dispatch({ type: 'snapshot/restore', data: { id: 's1', restored: 1.5, removed: 0 } as never })).toThrow('restored')
    expect(() => dispatch({ type: 'snapshot/restore', data: { id: 's1', restored: 2, removed: 'x' } as never })).toThrow('removed')

    expect(() => dispatch({ type: 'snapshot/create', data: { id: 's1', reason: 'before refactor' } })).not.toThrow()
    expect(() => dispatch({ type: 'snapshot/restore', data: { id: 's1', restored: 3, removed: 1 } })).not.toThrow()

    // Unrelated events pass through untouched.
    expect(() => dispatch({ type: 'todo/write', data: { todos: [] } } as never)).not.toThrow()
  })
})
