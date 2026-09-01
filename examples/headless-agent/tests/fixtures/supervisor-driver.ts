#!/usr/bin/env node
/** Snapshot-only Personal Supervisor driver: one governed controller across two boots. */

import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import { SupervisorTaskId, type SupervisorTaskSnapshot, type SupervisorTaskStatus } from '@deepseek-ai/dsh-supervisor'
import { scrub, scrubContext } from './supervisor-scrub.ts'

const NAME = 'supervisor-snapshot-driver'
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

/** Run one owner command through the product command runtime and echo its text. */
async function run(ctx: Context, agent: Agent, line: string): Promise<string> {
  const execution = await ctx.commands.execute(agent, line, [], new AbortController().signal)
  const text = commandText(execution)
  emit({ kind: 'command', input: line, output: text })
  return text
}

/**
 * The controller stands in for the Supervisor preset agent: this snapshot
 * never runs a model turn, so only its identity and Session are real. Owner
 * and notification intake therefore stops in the inbox queue the real agent
 * feeds its next step from.
 */
function controllerAgent(ctx: Context, session: Session): Agent {
  const inbox: UserMessage[] = []
  const queue = (message: UserMessage): void => {
    inbox.push(message)
  }
  return { id: session.id, session, ctx, options: {}, status: 'idle', inbox, send: queue, inject: queue } as unknown as Agent
}

function bootController(ctx: Context): { agent: Agent; session: Session } {
  const session = ctx.supervisorSession.current
  if (session === undefined) throw new Error(`${NAME}: the controller session is not live`)
  const agent = controllerAgent(ctx, session)
  ctx.agents.register(agent)
  return { agent, session }
}

/** Count the Supervisor ledger events currently carried by one controller Session. */
function ledgerCounts(session: Session): Record<string, number> {
  const count = (type: string) => session.events.filter(event => event.type === type).length
  return {
    identityEvents: count('supervisor/identity'),
    projectEvents: count('supervisor/project'),
    taskEvents: count('supervisor/task'),
    runLinkEvents: count('supervisor/run-linked'),
  }
}

function report(session: Session, boot: number): Record<string, number> {
  const counts = ledgerCounts(session)
  emit({ kind: 'boot', boot, sessionId: String(session.id), ...counts })
  return counts
}

async function settle(ctx: Context, taskId: string, expected: SupervisorTaskStatus): Promise<SupervisorTaskSnapshot> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const task = peek(ctx, taskId, 'task')
    if (task.status === expected) return task
    await delay(25)
  }
  throw new Error(`${NAME}: task ${taskId} never reached ${expected}`)
}

function peek(ctx: Context, taskId: string, label: string): SupervisorTaskSnapshot {
  const task = ctx.supervisorOrchestrator.getTask(SupervisorTaskId(taskId))
  if (task === undefined) throw new Error(`${NAME}: ${label} task is not registered`)
  return task
}

function parseProject(text: string, label: string): string {
  const match = /Registered [^(]+\(([^)]+)\) at /u.exec(text)
  if (match?.[1] === undefined) throw new Error(`${NAME}: ${label} registration reported no project id`)
  return match[1]
}

function parseTask(text: string, label: string): string {
  const match = /^Captured (\S+) \[/u.exec(text)
  if (match?.[1] === undefined) throw new Error(`${NAME}: ${label} capture reported no task id`)
  return match[1]
}

function parseBatch(text: string): string {
  const match = /\/supervisor_approve (\S+)/u.exec(text)
  if (match?.[1] === undefined) throw new Error(`${NAME}: no approval batch was offered`)
  return match[1]
}

function capture(projectId: string, title: string, description: string, nextAction: string, flags: string): string {
  return `/supervisor_capture ${projectId} ${title} :: ${description} :: ${nextAction}${flags}`
}

/** @returns names of the model-facing tools the controller scope resolves. */
function modelFacingTools(ctx: Context, agent: Agent): string[] {
  return ctx.tools.schemas(agent).map(schema => schema.name).sort()
}

const uninstallFailLoud = installFailLoud(NAME)
let ctx: Context | undefined
try {
  loadEnv(NAME)
  const root = process.cwd()
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))
  const links: unknown[] = []
  const first = ctx
  // The durable link records the association; the live Session header records
  // the working directory the execution actually ran in.
  first.on('supervisor/run-linked', (event) => {
    const { hostSessionId, childSessionId } = event.snapshot
    links.push({
      ...event.snapshot,
      hostCwd: first.sessions.get(hostSessionId)?.header.cwd,
      childCwd: first.sessions.get(childSessionId)?.header.cwd,
    })
  })
  const { agent, session } = bootController(first)
  report(session, 1)

  const alpha = parseProject(await run(first, agent, `/supervisor_register_project ${join(root, 'project-alpha')} Alpha`), 'alpha')
  const beta = parseProject(await run(first, agent, `/supervisor_register_project ${join(root, 'project-beta')} Beta`), 'beta')

  // The policy-approved route dispatches without an owner turn, so both projects
  // execute at once, each inside its own host and real cwd.
  const alphaReport = parseTask(await run(first, agent, capture(alpha, 'Summarize the ledger', 'Collect the current status of every registered project.', 'Report the summary for owner review', '')), 'alpha report')
  const betaReport = parseTask(await run(first, agent, capture(beta, 'Audit the deployment targets', 'List every environment that publishes this service.', 'Report the audit for owner review', '')), 'beta report')
  const alphaReady = await settle(first, alphaReport, 'ReadyForReview')
  emit({ kind: 'auto-route', task: alphaReport, status: alphaReady.status, revision: alphaReady.revision })
  const betaReady = await settle(first, betaReport, 'ReadyForReview')
  emit({ kind: 'auto-route', task: betaReport, status: betaReady.status, revision: betaReady.revision })

  // A high-risk task stays gated until the owner answers its confirmation batch.
  const highRiskText = await run(first, agent, capture(alpha, 'Rewrite the release pipeline', 'Replace the publish job end to end.', 'Wait for the owner approval decision', ' --high-risk'))
  const highRisk = parseTask(highRiskText, 'high-risk')
  const gated = await settle(first, highRisk, 'AwaitingApproval')
  emit({ kind: 'gate', task: highRisk, status: gated.status, revision: gated.revision })

  await run(first, agent, '/supervisor_status')
  await run(first, agent, `/supervisor_approve ${parseBatch(highRiskText)}`)
  const highRiskReady = await settle(first, highRisk, 'ReadyForReview')

  // An executor report is only a review request; acceptance is a separate owner action.
  await run(first, agent, `/supervisor_review ${alphaReport} ${alphaReady.revision} accept`)

  // A repair request rides the revision the owner viewed and returns to the same
  // task, project, and execution host.
  await run(first, agent, `/supervisor_followup ${highRisk} ${highRiskReady.revision} Return the corrected report :: Add the regression test the first report omitted.`)
  const repaired = await settle(first, highRisk, 'ReadyForReview')
  emit({ kind: 'repaired', task: highRisk, status: repaired.status, revision: repaired.revision })

  // The owner can also record a fix decision and dispatch the rework explicitly.
  await run(first, agent, `/supervisor_review ${betaReport} ${betaReady.revision} needs-fix`)
  const flagged = await settle(first, betaReport, 'NeedsFix')
  await run(first, agent, `/supervisor_dispatch ${betaReport} ${flagged.revision}`)
  await settle(first, betaReport, 'ReadyForReview')

  // A permission request above the route ceiling is refused even after the owner
  // approves, so the task never starts an execution that outranks the policy.
  const adminText = await run(first, agent, capture(beta, 'Rotate the production credential', 'Replace the live signing secret in the deployment target.', 'Wait for the owner approval decision', ' --perm=admin'))
  const admin = parseTask(adminText, 'admin')
  const ceiling = await settle(first, admin, 'AwaitingApproval')
  emit({ kind: 'gate', task: admin, status: ceiling.status, revision: ceiling.revision })
  await run(first, agent, `/supervisor_approve ${parseBatch(adminText)}`)
  const refused = peek(first, admin, 'admin')
  emit({ kind: 'ceiling-refused', task: admin, status: refused.status, revision: refused.revision })

  // One gated task stays unanswered when the process closes, so the restore
  // must recreate its approval batch instead of losing the pending decision.
  const pendingText = await run(first, agent, capture(beta, 'Migrate the storage layer', 'Move the archives to the new volume.', 'Wait for the owner approval decision', ' --high-risk'))
  const pending = parseTask(pendingText, 'pending')
  await settle(first, pending, 'AwaitingApproval')

  await run(first, agent, '/supervisor_status')
  await run(first, agent, '/supervisor_tasks')
  await run(first, agent, '/supervisor_projects')
  emit({ kind: 'controller-tools', tools: modelFacingTools(first, agent) })
  emit({ kind: 'run-links', links })

  // The process closes and opens again over the same durable state.
  const live = ledgerCounts(session)
  await first.fiber.dispose()
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))
  const second = ctx
  const restored = bootController(second)
  const persisted = report(restored.session, 2)
  // Every event the live ledger appended must survive one close and one restore.
  if (JSON.stringify(live) !== JSON.stringify(persisted)) {
    throw new Error(`${NAME}: the durable ledger lost events across restart, live ${JSON.stringify(live)} but restored ${JSON.stringify(persisted)}`)
  }
  await run(second, restored.agent, '/supervisor_status')
  // The restored batch answers, but its work order was never durable: approve
  // refuses to execute the half-restored task, and rejection cancels it instead.
  await run(second, restored.agent, `/supervisor_approve approval:${pending}`)
  await run(second, restored.agent, `/supervisor_reject approval:${pending}`)
  // Re-registering a known real path returns the existing project unchanged.
  await run(second, restored.agent, `/supervisor_register_project ${join(root, 'project-alpha')} Alpha Again`)
  await run(second, restored.agent, `/supervisor_register_project ${join(root, 'project-gamma')} Gamma`)
  await run(second, restored.agent, '/supervisor_projects')
  await second.fiber.dispose()
  ctx = undefined
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
