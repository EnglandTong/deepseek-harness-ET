/** Keyless executor provider: one durable child Session per admitted run, no model request. */

import { SessionId } from '@deepseek-ai/dsh-session'

/** Cordis plugin name. */
export const name = 'supervisor-executor-fixture'
/** Executor bridge and Session store dependencies. */
export const inject = ['supervisorExecutors', 'sessions', 'sessionPersistence', 'supervisor']

/** Register the provider that the fixture routing policy selects. */
export function apply(ctx) {
  ctx.supervisorExecutors.register({
    name: 'fixture-subagent',
    capabilities: {
      permissions: ['none', 'read', 'write', 'execute', 'admin'],
      background: true,
      cancellation: true,
      providers: ['deepseek'],
    },
    async prepare(request) {
      const project = ctx.supervisor.getProject(request.projectId)
      if (project === undefined) throw new Error(`fixture executor has no project '${String(request.projectId)}'`)
      const childSessionId = SessionId(`supervisor-fixture-child:${String(request.runId)}`)
      const prepared = ctx.sessions.prepare(childSessionId, { meta: { cwd: project.realPath } })
      await ctx.sessionPersistence.create(prepared.header)
      const detach = ctx.sessions.enter(prepared)
      ctx.sessions.announce(prepared)
      await ctx.sessions.flush(prepared)
      let closed = false
      const close = async () => {
        if (closed) return
        closed = true
        await ctx.sessions.flush(prepared)
        detach()
      }
      return {
        childSessionId,
        async start() {
          return {
            childSessionId,
            result: Promise.resolve({
              stopReason: 'completed',
              output: [{ type: 'text', text: `FIXTURE_EXECUTION_DONE ${String(request.taskId)}` }],
            }),
            dispose: close,
          }
        },
        release: close,
      }
    },
  })
}
