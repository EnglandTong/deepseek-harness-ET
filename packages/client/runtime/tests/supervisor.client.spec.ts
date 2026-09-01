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
})
