/** Client Supervisor projection tests: refresh, retained errors, CAS actions, and read-only child access. */

import { describe, expect, it, vi } from 'vitest'
import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import { SupervisorRuntime } from '../src/client/supervisor.ts'

const identity = { id: 'supervisor', sessionId: 'session-supervisor', revision: 1, createdAt: '2026-08-31T00:00:00.000Z' }
const apiFor = (overrides: Partial<IApiClient['supervisor']> = {}): IApiClient => {
  const supervisor: IApiClient['supervisor'] = {
    identity: vi.fn(async () => ({ rpcId: 'rpc' as never, result: { ok: true as const, value: identity } })),
    projects: vi.fn(async () => ({ rpcId: 'rpc' as never, result: { ok: true as const, value: { projects: [] } } })),
    tasks: vi.fn(async () => ({ rpcId: 'rpc' as never, result: { ok: true as const, value: { tasks: [] } } })),
    runs: vi.fn(async () => ({ rpcId: 'rpc' as never, result: { ok: true as const, value: { runs: [] } } })),
    notifications: vi.fn(async () => ({ rpcId: 'rpc' as never, result: { ok: true as const, value: { notifications: [] } } })),
    childSession: vi.fn(async () => ({ rpcId: 'rpc' as never, result: { ok: true as const, value: { taskId: 'task', runId: 'run', sessionId: 'child', parentSessionId: 'host', readOnly: true as const } } })),
    action: vi.fn(async request => ({ rpcId: 'rpc' as never, result: { ok: true as const, value: { taskId: request.taskId, revision: request.expectedRevision + 1, accepted: true as const } } })),
  }
  Object.assign(supervisor, overrides)
  return { supervisor } as IApiClient
}

describe('SupervisorRuntime', () => {
  it('refreshes all bounded lists into one projection', async () => {
    const runtime = new SupervisorRuntime(apiFor())
    await runtime.refresh()
    expect(runtime.state.getSnapshot()).toMatchObject({ identity, loading: false, projects: [], tasks: [], runs: [], notifications: [] })
  })

  it('retains a failed refresh for presentation', async () => {
    const runtime = new SupervisorRuntime(apiFor({ projects: vi.fn(async () => ({ rpcId: 'rpc' as never, result: { ok: false as const, error: { code: 'internal' as const, message: 'offline', details: {} } } })) }))
    await runtime.refresh()
    expect(runtime.state.getSnapshot().error).toBe('offline')
  })

  it('refreshes after a successful action and returns a read-only child reference', async () => {
    const api = apiFor()
    const runtime = new SupervisorRuntime(api)
    const receipt = await runtime.action({ taskId: 'task', action: 'approve', expectedRevision: 1 })
    expect(receipt).toMatchObject({ taskId: 'task', revision: 2, accepted: true })
    const child = await runtime.childSession('task')
    expect(child).toMatchObject({ sessionId: 'child', readOnly: true })
  })

  it('maps a child transcript page from the generic session history, filtering non-text rows', async () => {
    const history = vi.fn(async () => ({ rpcId: 'rpc' as never, result: { ok: true as const, value: {
      events: [
        { event: { type: 'user/message', seq: 4, time: 1, data: { role: 'user', content: [{ type: 'text', text: 'routed task' }], source: { kind: 'user' } }, surfaceOp: 'append' } },
        { event: { type: 'tool/call', seq: 5, time: 2, data: { turn: 1, step: 1, callId: 'c1', name: 'noop', arguments: '{}' } } },
        { event: { type: 'assistant/message', seq: 6, time: 3, data: { turn: 1, step: 1, message: { id: 'm1', role: 'assistant', source: { kind: 'model', provider: 'deepseek', model: 'e2e' }, content: [{ type: 'text', text: 'execution done' }] } } } },
        { event: { type: 'assistant/message', seq: 7, time: 4, data: { turn: 1, step: 2, message: { id: 'm2', role: 'assistant', source: { kind: 'model', provider: 'deepseek', model: 'e2e' }, content: [] } } } },
      ],
      hasMore: true,
    } } }))
    const api = { supervisor: apiFor().supervisor, sessions: { history } } as unknown as IApiClient
    const runtime = new SupervisorRuntime(api)
    const page = await runtime.childTranscript({ taskId: 'task' })
    expect(page).toEqual({
      sessionId: 'child',
      messages: [
        { role: 'user', text: 'routed task', seq: 4 },
        { role: 'assistant', text: 'execution done', seq: 6 },
      ],
      oldestSeq: 4,
      hasOlder: true,
    })
    expect(history).toHaveBeenCalledWith({ sessionId: 'child', maxMessages: 40 }, undefined)
  })

  it('passes the older-page anchor through and throws on a failed read', async () => {
    const history = vi.fn(async (payload: { beforeSeq?: number }) => {
      if (payload.beforeSeq === undefined) throw new Error('unexpected first page')
      return { rpcId: 'rpc' as never, result: { ok: true as const, value: { events: [], hasMore: false } } }
    })
    const api = { supervisor: apiFor().supervisor, sessions: { history } } as unknown as IApiClient
    const runtime = new SupervisorRuntime(api)
    const page = await runtime.childTranscript({ taskId: 'task', beforeSeq: 4 })
    expect(page).toEqual({ sessionId: 'child', messages: [], oldestSeq: undefined, hasOlder: false })

    const failing = new SupervisorRuntime({ supervisor: apiFor().supervisor, sessions: { history: vi.fn(async () => ({ rpcId: 'rpc' as never, result: { ok: false as const, error: { code: 'internal' as const, message: 'log vanished', details: {} } } })) } } as unknown as IApiClient)
    await expect(failing.childTranscript({ taskId: 'task' })).rejects.toThrow('log vanished')
  })

  it('resolves undefined when the task has no child session', async () => {
    const history = vi.fn()
    const missingChild = vi.fn(async () => ({ rpcId: 'rpc' as never, result: { ok: false as const, error: { code: 'supervisor-not-found', message: 'no run', details: {} } } }))
    const base = apiFor().supervisor as NonNullable<IApiClient['supervisor']>
    const api = {
      supervisor: { ...base, childSession: missingChild as unknown as NonNullable<IApiClient['supervisor']>[ 'childSession' ] },
      sessions: { history },
    } as unknown as IApiClient
    const runtime = new SupervisorRuntime(api)
    await expect(runtime.childTranscript({ taskId: 'task' })).resolves.toBeUndefined()
    expect(history).not.toHaveBeenCalled()
  })
})
