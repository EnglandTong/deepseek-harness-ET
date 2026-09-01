/** Supervisor API contract: bounded snapshots, read-only child references, and CAS actions. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createApiProxy, type SupervisorApiProvider } from '@deepseek-ai/dsh-host-apiproxy'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import type { SupervisorActionRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { supervisorActionRequestSchema, supervisorIdentityValueSchema } from '../src/api/supervisor.schema.ts'

const identity = { id: 'supervisor', sessionId: 'session-supervisor', revision: 1, createdAt: '2026-08-31T00:00:00.000Z' }

const provider = (): SupervisorApiProvider => ({
  identity: () => identity,
  listProjects: () => [{ id: 'project-a', revision: 1, displayName: 'A', realPath: 'C:/work/a', status: 'registered', registeredAt: '2026-08-31T00:00:00.000Z' }],
  listTasks: () => [
    { id: 'task-a', revision: 2, projectId: 'project-a', title: 'Build', description: 'Build feature', status: 'NeedsOwnerDecision', nextAction: 'Approve' },
    { id: 'task-b', revision: 1, projectId: 'project-a', title: 'Done', description: 'Done', status: 'Accepted', nextAction: 'None' },
  ],
  listRuns: () => [{ revision: 1, runId: 'run-a', taskId: 'task-a', projectId: 'project-a', hostSessionId: 'host-a', childSessionId: 'child-a', executor: 'codex', model: 'm', writeAccess: true }],
  listNotifications: () => [{ revision: 2, id: 'notice-a', taskId: 'task-a', projectId: 'project-a', kind: 'owner-decision', message: 'Approve', unread: true, createdAt: '2026-08-31T00:00:00.000Z' }],
  childSession: () => ({ taskId: 'task-a', runId: 'run-a', sessionId: 'child-a', parentSessionId: 'host-a', readOnly: true }),
  action: async (request: SupervisorActionRequest) => ({
    taskId: request.taskId,
    revision: request.expectedRevision + 1,
    accepted: true as const,
  }),
})

function request<P>(payload: P) {
  return { rpcId: RpcId('supervisor-test'), payload }
}

function context(): Context {
  const ctx = new Context()
  // createApiProxy registers its question bridge eagerly; Supervisor tests do
  // not exercise that bridge, so provide the smallest disposable provider.
  ctx.provide('userQuestions', { registerProvider: () => () => {} })
  return ctx
}

describe('Personal Supervisor ApiProxy domain', () => {
  it('rejects unversioned or malformed response values at the client boundary', () => {
    expect(() => supervisorIdentityValueSchema.parse(identity)).toThrow()
    expect(() => supervisorIdentityValueSchema.parse({ version: 1, ...identity })).not.toThrow()
    expect(() => supervisorActionRequestSchema.parse({ taskId: 'task', action: 'approve', expectedRevision: 0 })).toThrow()
  })
  it('returns versioned identity and filtered snapshots', async () => {
    const api = createApiProxy(context(), { cwd: 'C:/work', defaultModelSelection: () => ({ provider: 'p', model: 'm' }), supervisor: provider() })
    const identity = await api.supervisor.identity(request({}))
    expect(identity.result).toMatchObject({ ok: true, value: { id: 'supervisor', sessionId: 'session-supervisor' } })
    const tasks = await api.supervisor.tasks(request({ statuses: ['NeedsOwnerDecision'] }))
    expect(tasks.result).toMatchObject({ ok: true, value: { tasks: [{ id: 'task-a' }] } })
  })

  it('enforces unread/revision filters and marks child references read-only', async () => {
    const api = createApiProxy(context(), { cwd: 'C:/work', defaultModelSelection: () => ({ provider: 'p', model: 'm' }), supervisor: provider() })
    const notices = await api.supervisor.notifications(request({ unreadOnly: true, afterRevision: 1 }))
    expect(notices.result).toMatchObject({ ok: true, value: { notifications: [{ id: 'notice-a' }] } })
    const child = await api.supervisor.childSession(request({ taskId: 'task-a' }))
    expect(child.result).toMatchObject({ ok: true, value: { sessionId: 'child-a', readOnly: true } })
  })

  it('preserves an explicit revision conflict from the control port', async () => {
    const conflict = Object.assign(new Error('task changed'), { code: 'SUPERVISOR_REVISION_CONFLICT', expected: 1, actual: 2 })
    const api = createApiProxy(context(), {
      cwd: 'C:/work', defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      supervisor: { ...provider(), action: async () => { throw conflict } },
    })
    const result = await api.supervisor.action(request({ taskId: 'task-a', action: 'approve', expectedRevision: 1 }))
    expect(result.result).toEqual({ ok: false, error: { code: 'supervisor-conflict', message: 'task changed', details: { taskId: 'task-a', expected: 1, actual: 2 } } })
  })

  it('fails closed when the optional Supervisor bundle is absent', async () => {
    const api = createApiProxy(context(), { cwd: 'C:/work', defaultModelSelection: () => ({ provider: 'p', model: 'm' }) })
    const result = await api.supervisor.projects(request({}))
    expect(result.result).toMatchObject({ ok: false, error: { code: 'supervisor-unavailable' } })
  })
})
