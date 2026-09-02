/** Keyless host-side helpers for the supervisor dashboard e2e: the controller stub, the routing policy, and the fixture executor. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { SessionId as brandSessionId } from '@deepseek-ai/dsh-session'
import type { SupervisorExecutorProvider } from '@deepseek-ai/dsh-supervisor-executor-subagent'

/**
 * The inline policy the spec registers: every classified task names the
 * fixture executor and requires the owner's confirmation, so the dashboard's
 * approval gate is always exercised.
 */
export const E2E_ROUTING_POLICY = [
  'version: 1',
  'defaults:',
  '  approval: confirm',
  '  permissionCeiling: read',
  '  timeoutMs: 30000',
  '  costTier: unknown',
  'routes:',
  '  - id: supervisor-command',
  '    taskType:',
  '      - supervisor-command',
  '    executor: e2e-fixture',
  '    provider: deepseek',
  '    permissionCeiling: read',
  '    approval: confirm',
  '',
].join('\n')

/**
 * The keyless executor provider: one durable child Session per admitted run
 * in the registered project's workspace, with no model request. Ported from
 * the headless snapshot's fixture executor so the dashboard's approved task
 * reaches ReadyForReview without credentials.
 * @param ctx - the settled scaffold context carrying the supervisor services.
 * @returns a provider ready for `ctx.supervisorExecutors.register()`.
 */
export function createE2eExecutor(ctx: Context): SupervisorExecutorProvider {
  return {
    name: 'e2e-fixture',
    capabilities: {
      permissions: ['none', 'read', 'write', 'execute', 'admin'],
      background: true,
      cancellation: true,
      providers: ['deepseek'],
    },
    async prepare(request) {
      const project = ctx.supervisor.getProject(request.projectId)
      if (project === undefined) throw new Error(`e2e executor has no project '${String(request.projectId)}'`)
      const childSessionId = brandSessionId(`supervisor-e2e-child:${String(request.runId)}`)
      const prepared = ctx.sessions.prepare(childSessionId, { meta: { cwd: project.realPath } })
      await ctx.sessionPersistence.create(prepared.header)
      // A small deterministic transcript so the dashboard's read-only child
      // view has content to render, exactly as a real child run would. The
      // messages ride one closed turn so the log stays validator-clean.
      const promptText = `Routed work order ${String(request.taskId)}: collect the current status.`
      const doneText = `E2E_EXECUTION_DONE ${String(request.taskId)}`
      prepared.append('turn/start', { turn: 1 })
      prepared.append('user/message', createUserMessage({ content: [{ type: 'text', text: promptText }], source: { kind: 'user' } }), { surfaceOp: 'append' })
      prepared.append('assistant/message', {
        turn: 1,
        step: 1,
        message: createAssistantMessage({ content: [{ type: 'text', text: doneText }], source: { provider: 'deepseek', model: 'e2e-fixture' } }),
      }, { surfaceOp: 'append' })
      prepared.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      const detach = ctx.sessions.enter(prepared)
      ctx.sessions.announce(prepared)
      await ctx.sessions.flush(prepared)
      let closed = false
      const close = async (): Promise<void> => {
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
              stopReason: 'completed' as const,
              output: [{ type: 'text' as const, text: doneText }],
            }),
            dispose: close,
          }
        },
        release: close,
      }
    },
  }
}

/**
 * The controller stand-in the owner commands execute against: identity and
 * Session are real (the singleton supervisor session), turns are not — the
 * same shape the headless supervisor snapshot's driver registers. Supervisor
 * commands never run a model turn; they read and write the ledger.
 * @param ctx - the settled scaffold context.
 * @returns the registered stub agent.
 */
export function registerControllerStub(ctx: Context): Agent {
  const session = ctx.supervisorSession.current
  if (session === undefined) throw new Error('supervisor dashboard e2e: the controller session is not live')
  const inbox: UserMessage[] = []
  const queue = (message: UserMessage): void => {
    inbox.push(message)
  }
  const agent = { id: session.id, session, ctx, options: {}, status: 'idle', inbox, send: queue, inject: queue } as unknown as Agent
  ctx.agents.register(agent)
  return agent
}

/** Brand helper re-exported for spec readability. */
export const asSessionId = (value: string): SessionId => brandSessionId(value)
