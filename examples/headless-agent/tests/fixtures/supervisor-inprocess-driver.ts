#!/usr/bin/env node
/** Snapshot driver for the real in-process executor: one routed child in the project workspace. */

import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import { SupervisorTaskId } from '@deepseek-ai/dsh-supervisor'
import { scrub, scrubContext } from './supervisor-scrub.ts'

const NAME = 'supervisor-inprocess-driver'
const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error(`${NAME}: expected <config-path>`)

const identity = scrubContext()

function emit(value: unknown): void {
  process.stdout.write(`${scrub(identity, value, process.cwd())}\n`)
}

function commandText(execution: unknown): string {
  const record = execution as { result?: { text?: unknown }; text?: unknown } | undefined
  if (record === undefined) return '<no matching command>'
  const text = record.result?.text ?? record.text
  return typeof text === 'string' ? text : scrub(identity, execution, process.cwd())
}

async function run(ctx: Context, agent: Agent, line: string): Promise<string> {
  const execution = await ctx.commands.execute(agent, line, [], new AbortController().signal)
  const text = commandText(execution)
  emit({ kind: 'command', input: line, output: text })
  return text
}

/** Same controller stand-in as the durable-ledger driver: identity and Session are real, turns are not. */
function controllerAgent(ctx: Context, session: Session): Agent {
  const inbox: UserMessage[] = []
  const queue = (message: UserMessage): void => {
    inbox.push(message)
  }
  return { id: session.id, session, ctx, options: {}, status: 'idle', inbox, send: queue, inject: queue } as unknown as Agent
}

async function settle(ctx: Context, taskId: string, expected: string): Promise<{ status: string; revision: number }> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const task = ctx.supervisorOrchestrator.getTask(SupervisorTaskId(taskId))
    if (task === undefined) throw new Error(`${NAME}: task '${taskId}' is not registered`)
    if (task.status === expected) {
      emit({ kind: 'settled', task: taskId, status: task.status, revision: task.revision })
      return { status: task.status, revision: task.revision }
    }
    await delay(25)
  }
  throw new Error(`${NAME}: task '${taskId}' never reached '${expected}'`)
}

function parseProject(text: string): string {
  const match = /Registered [^(]+\(([^)]+)\) at /u.exec(text)
  if (match?.[1] === undefined) throw new Error(`${NAME}: registration reported no project id`)
  return match[1]
}

function parseTask(text: string): string {
  const match = /^Captured (\S+) \[/u.exec(text)
  if (match?.[1] === undefined) throw new Error(`${NAME}: capture reported no task id`)
  return match[1]
}

const uninstallFailLoud = installFailLoud(NAME)
let ctx: Context | undefined
try {
  loadEnv(NAME)
  const root = process.cwd()
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))
  const links: unknown[] = []
  ctx.on('supervisor/run-linked', (event) => {
    const { hostSessionId, childSessionId } = event.snapshot
    links.push({
      ...event.snapshot,
      hostCwd: ctx?.sessions.get(hostSessionId)?.header.cwd,
      childCwd: ctx?.sessions.get(childSessionId)?.header.cwd,
    })
  })
  ctx.on('supervisor/task', (event) => {
    emit({ kind: 'task-event', status: event.snapshot.status, revision: event.snapshot.revision, blocker: event.snapshot.blocker })
  })
  const session = ctx.supervisorSession.current
  if (session === undefined) throw new Error(`${NAME}: the controller session is not live`)
  const agent = controllerAgent(ctx, session)
  ctx.agents.register(agent)

  const alpha = parseProject(await run(ctx, agent, `/supervisor_register_project ${join(root, 'project-alpha')} Alpha`))
  const captured = await run(ctx, agent, `/supervisor_capture ${alpha} Summarize the ledger :: Collect the current status of every registered project. :: Report the summary for owner review`)
  const taskId = parseTask(captured)
  const settled = await settle(ctx, taskId, 'ReadyForReview')
  emit({ kind: 'run-links', links })
  emit({ kind: 'final', task: taskId, status: settled.status, revision: settled.revision })
  await ctx.fiber.dispose()
  ctx = undefined
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
