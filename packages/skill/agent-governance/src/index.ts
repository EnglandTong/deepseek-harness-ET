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
}

/** Runtime configuration schema. */
export const Config: z<Config> = z.object({
  bundledSkillDir: z.string(),
  providerName: z.string().min(1).default('agent-governance'),
  includeDefaultRoots: z.boolean().default(true),
  watch: z.boolean().default(true),
})

export const name = 'agent-governance'
export const inject = ['skills']

/**
 * Mount the bundled ClawHub skills through the normal filesystem skill
 * provider. Project and user roots remain independently discoverable, while
 * the bundled root is owned by this plugin and is removed with its context.
 * @param ctx - context carrying the shared skill registry.
 * @param config - provider and root options.
 */
export function apply(ctx: Context, config: Config = {}): void {
  ctx.plugin(SkillFileSystem, {
    bundledSkillDir: config.bundledSkillDir ?? bundledSkillRoot,
    providerName: config.providerName ?? 'agent-governance',
    includeDefaultRoots: config.includeDefaultRoots ?? true,
    watch: config.watch ?? true,
  })
}
