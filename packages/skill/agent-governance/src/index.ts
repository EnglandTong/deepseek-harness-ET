/**
 * Bundled governance and execution skills for DeepSeek Harness.
 *
 * The plugin owns the distribution and lifecycle of the two complementary
 * ClawHub skills while the filesystem provider owns discovery and loading.
 * Full skill bodies remain on demand through the normal skill tool.
 *
 * @module @deepseek-ai/dsh-agent-governance
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import type {} from '@deepseek-ai/dsh-subagent'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { GovernanceService, type GovernanceRuntimeConfig } from './service.ts'

const bundledSkillRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'skills')

/** Configuration for the bundled governance skill provider. */
export interface Config {
  /** Override the bundled skill directory, primarily for tests and packaging. */
  bundledSkillDir?: string
  /** Provider name registered in the shared skill registry. */
  providerName?: string
  /** Include project and user skills alongside the bundled skills. */
  includeDefaultRoots?: boolean
  /** Watch local skill roots for changes. */
  watch?: boolean
  /** Require explicit approval before write-capable delegation. */
  requireApproval?: boolean
  /** Maximum nested governance delegation depth. */
  maxNestedDepth?: number
  /** Default permission for routed work. */
  defaultPermission?: GovernanceRuntimeConfig['defaultPermission']
  /** Maximum wall-clock time for one delegated task. */
  taskTimeoutMs?: number
}

/** Runtime configuration schema. */
export const Config: z<Config> = z.object({
  bundledSkillDir: z.string(),
  providerName: z.string().min(1).default('agent-governance'),
  includeDefaultRoots: z.boolean().default(true),
  watch: z.boolean().default(true),
  requireApproval: z.boolean().default(true),
  maxNestedDepth: z.number().min(0).default(1),
  defaultPermission: z.union(['read-only', 'workspace-write', 'full-access']).default('workspace-write'),
  taskTimeoutMs: z.number().min(1).default(30 * 60 * 1000),
})

export const name = 'agent-governance'
export const inject = ['skills', 'tools', 'subagents', 'systemPrompt']

/**
 * Mount the bundled ClawHub skills through the normal filesystem skill
 * provider. Project and user roots remain independently discoverable, while
 * the bundled root is owned by this plugin and is removed with its context.
 * @param ctx - context carrying the shared skill registry.
 * @param config - provider and root options.
 */
export function apply(ctx: Context, config: Config = {}): void {
  ctx.plugin(GovernanceService)
  ctx.inject(['governance'], (configCtx: Context) => {
    configCtx.governance.configure({
      requireApproval: config.requireApproval ?? true,
      maxNestedDepth: config.maxNestedDepth ?? 1,
      defaultPermission: config.defaultPermission ?? 'workspace-write',
      taskTimeoutMs: config.taskTimeoutMs ?? 30 * 60 * 1000,
    })
  })
  ctx.plugin(SkillFileSystem, {
    bundledSkillDir: config.bundledSkillDir ?? bundledSkillRoot,
    providerName: config.providerName ?? 'agent-governance',
    includeDefaultRoots: config.includeDefaultRoots ?? true,
    watch: config.watch ?? true,
  })

  ctx.systemPrompt.section({
    name: 'governance:routing',
    order: 118,
    text: 'Governance routing recommends a suitable Agent but does not grant execution authority. '
      + 'Always inspect the recommendation, approve before delegation, and do not treat a child report as acceptance.',
  })

  ctx.tools.register(defineTool({
    name: 'governance_list_agents',
    description: 'List the configured Codex, Claude Code, and DeepSeek Harness Agent providers and their current availability. This is diagnostic data, not execution authorization.',
    parameters: {},
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (_args, exec) => {
      if (exec.agent === undefined) throw new Error('governance_list_agents requires an agent')
      return Promise.resolve([...ctx.governance.listAgentsFor(exec.agent.session)] as unknown as JsonValue)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'governance_check_agents',
    description: 'Check Agent Provider availability and persist diagnostics in the Session. This does not start a child Agent.',
    parameters: {},
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (_args, exec) => {
      if (exec.agent === undefined) throw new Error('governance_check_agents requires an agent')
      return Promise.resolve([...ctx.governance.listAgentsFor(exec.agent.session)] as unknown as JsonValue)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'governance_delegate',
    description: 'Delegate an approved routed task to its selected Agent. Approval is mandatory, workspace and nested-depth checks apply, and completion still requires governance_accept.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'The task id from governance_route_task.' },
      prompt: { type: 'string', required: true, description: 'The bounded task prompt for the selected child Agent.' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('governance_delegate requires an agent')
      if (!ctx.governance.isApproved(args.task_id)) throw new Error(`governance task ${args.task_id} is not approved`)
      const report = await ctx.governance.delegate(args.task_id, [{ type: 'text', text: args.prompt }] as ContentBlock[], exec.agent, exec.agent.session, exec.signal)
      return report as unknown as JsonValue
    },
  }))

  ctx.tools.register(defineTool({
    name: 'governance_cancel',
    description: 'Cancel a running delegated task and record the cancellation. Cancellation does not accept the task.',
    parameters: { task_id: { type: 'string', required: true, description: 'The governance task id.' }, reason: { type: 'string', description: 'Optional cancellation reason.' } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('governance_cancel requires an agent')
      await ctx.governance.cancel(args.task_id, exec.agent.session, args.reason)
      return { task_id: args.task_id, status: 'cancelled' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'governance_route_task',
    description: 'Recommend which Agent should handle a task. This only records a recommendation; it does not delegate work.',
    parameters: { task: { type: 'string', required: true, description: 'The task to classify and route.' } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (args, exec) => {
      if (exec.agent === undefined) throw new Error('governance_route_task requires an agent')
      return Promise.resolve(ctx.governance.routeFor(exec.agent.session, args.task) as unknown as JsonValue)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'governance_reject',
    description: 'Reject an unapproved governance route. Rejection prevents delegation until a new route is created.',
    parameters: { task_id: { type: 'string', required: true, description: 'The task id from governance_route_task.' }, reason: { type: 'string', required: true, description: 'Reason for rejecting the route.' } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (args, exec) => {
      if (exec.agent === undefined) throw new Error('governance_reject requires an agent')
      ctx.governance.reject(args.task_id, args.reason, exec.agent.session)
      return Promise.resolve({ task_id: args.task_id, decision: 'rejected', reason: args.reason })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'governance_report',
    description: 'Record a child Agent report with file and test evidence. A report is not an acceptance decision.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'The governance task id.' },
      harness: { type: 'string', required: true, enum: ['codex', 'claude-code', 'deepseek-harness'] },
      status: { type: 'string', required: true, enum: ['completed', 'failed', 'cancelled'] },
      summary: { type: 'string', required: true },
      changed_files_json: { type: 'string', required: true, description: 'JSON array of changed file paths.' },
      tests_json: { type: 'string', required: true, description: 'JSON array of objects with command and exitCode fields.' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (args, exec) => {
      if (exec.agent === undefined) throw new Error('governance_report requires an agent')
      const changedFiles = JSON.parse(args.changed_files_json) as unknown
      const tests = JSON.parse(args.tests_json) as unknown
      if (!Array.isArray(changedFiles) || !changedFiles.every(file => typeof file === 'string')) throw new Error('changed_files_json must be a JSON string array')
      if (!Array.isArray(tests) || !tests.every(test => typeof test === 'object' && test !== null && 'command' in test && 'exitCode' in test)) throw new Error('tests_json must be a JSON array of test evidence')
      const report = {
        taskId: args.task_id,
        harness: args.harness,
        status: args.status,
        summary: args.summary,
        changedFiles,
        tests: tests as { command: string; exitCode: number }[],
      }
      ctx.governance.report(report, exec.agent.session)
      return Promise.resolve(report as unknown as JsonValue)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'governance_approve',
    description: 'Approve a previously recommended governance task so delegation may proceed.',
    parameters: { task_id: { type: 'string', required: true, description: 'The task id from governance_route_task.' } },
    output: { schema: { type: 'json' }, render: () => [{ type: 'text', text: 'approved' }] },
    execute: (args, exec) => {
      if (exec.agent === undefined) throw new Error('governance_approve requires an agent')
      ctx.governance.approve(args.task_id, exec.agent.session)
      return Promise.resolve({ task_id: args.task_id, decision: 'approved' })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'governance_accept',
    description: 'Record whether a delegated task is accepted, rejected, or needs follow-up. Child completion is not acceptance.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'The governance task id.' },
      decision: { type: 'string', required: true, enum: ['accepted', 'rejected', 'needs-follow-up'] },
      reason: { type: 'string', description: 'Reason for the decision.' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (args, exec) => {
      if (exec.agent === undefined) throw new Error('governance_accept requires an agent')
      ctx.governance.accept(args.task_id, args.decision, args.reason, exec.agent.session)
      return Promise.resolve({ task_id: args.task_id, decision: args.decision })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'governance_handoff',
    description: 'Record a file-based handoff reference. The referenced file remains outside model context and must contain the bounded next-step packet.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'The governance task id.' },
      path: { type: 'string', required: true, description: 'The handoff file path.' },
      summary: { type: 'string', required: true, description: 'Short handoff summary.' },
      sha256: { type: 'string', description: 'Optional SHA-256 of the handoff file.' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (args, exec) => {
      if (exec.agent === undefined) throw new Error('governance_handoff requires an agent')
      ctx.governance.handoff(args.task_id, args.path, args.summary, exec.agent.session, args.sha256)
      return Promise.resolve({ task_id: args.task_id, path: args.path, recorded: true })
    },
  }))
}

export { GovernanceService } from './service.ts'
export * from './types.ts'
