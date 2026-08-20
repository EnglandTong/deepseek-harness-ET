/**
 * Multi-file atomic edit tool Consumer: `multi_edit` applies a list of literal
 * edits across files in one call. Any failure rolls the workspace back to a
 * snapshot captured within this same tool call (`rollback: true`, no approval
 * gate) — the snapshot seam is the rollback mechanism, not a new transaction
 * layer. Per-file edit semantics reuse `ctx.fs.editText` exactly as the
 * single-file `edit` tool does; the diff card aggregates every file's
 * before/after.
 * @module @deepseek-ai/dsh-tool-multiedit
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { DiffCallView, DiffResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-snapshot'

/** Cordis plugin name. */
export const name = 'tool-multiedit'
/** The tool registry, fs seam, snapshot seam, and system prompt. */
export const inject = ['tools', 'fs', 'snapshots', 'systemPrompt']

/** One literal edit in a `multi_edit` call, after schema validation. */
interface MultiEditItem {
  readonly file_path: string
  readonly old_string: string
  readonly new_string: string
  readonly replace_all: boolean
}

/** Schema-level shape of one edit item (escalation fields stay per-tool, not per-item). */
interface MultiEditItemArgs {
  file_path: string
  old_string: string
  new_string: string
  replace_all?: boolean
}

/**
 * Validate value constraints the schema DSL can't express, mirroring the
 * single-file `edit` tool: non-blank paths, non-empty old strings, and edits
 * that actually change something. Fails on the first invalid item, naming it.
 * @param items - the schema-validated raw edit items.
 * @returns camelCased items with `replace_all` defaulted to false.
 */
export function parseMultiEditArgs(items: readonly MultiEditItemArgs[]): MultiEditItem[] {
  return items.map((item, index) => {
    if (item.file_path.trim().length === 0) throw new Error(`edits[${index}].file_path must be a non-empty string`)
    if (item.old_string.length === 0) throw new Error(`edits[${index}].old_string must be a non-empty string`)
    if (item.old_string === item.new_string) throw new Error(`edits[${index}].old_string and new_string must differ`)
    return { file_path: item.file_path, old_string: item.old_string, new_string: item.new_string, replace_all: item.replace_all ?? false }
  })
}

/**
 * Register the `multi_edit` tool and its system-prompt section.
 * @param ctx - Cordis context carrying the tool registry, fs, and snapshots services.
 */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:multi-edit',
    order: 103,
    text: 'Use multi_edit to apply several literal edits across files in one atomic call: either every edit applies or the workspace rolls back to its pre-edit state. Prefer it over repeated single-file edit calls when the changes belong together. Read each file first (the default fs-observation-policy requires it), and note that a failed call reports which file failed and that the rollback completed.',
  })

  ctx.tools.register(defineTool({
    name: 'multi_edit',
    description: 'Apply multiple literal text edits across files atomically: every edit applies, or a failure rolls the whole call back to the pre-edit state. Each edit replaces literal old_string with new_string in one file (same semantics as the single-file edit tool).',
    parameters: {
      edits: {
        type: 'array',
        required: true,
        description: 'Edits to apply, in order. Each entry targets one file with one literal replacement.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            file_path: { type: 'string', required: true, description: 'Path to edit, resolved by the filesystem backend.' },
            old_string: { type: 'string', required: true, description: 'Literal text to replace. Must match exactly.' },
            new_string: { type: 'string', required: true, description: 'Literal replacement text. Use an empty string to delete the match.' },
            replace_all: { type: 'boolean', description: 'Replace all matches in this file. Defaults to false; when false, old_string must appear exactly once in that file.' },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          applied: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                before: { type: 'string', required: true },
                after: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Applied ${value.applied.length} edit(s): ${value.applied.map(edit => edit.path).join(', ')}`,
      }],
      presentationMeta: (_args, value) => ({
        diffs: value.applied.map(edit => ({ path: edit.path, oldText: edit.before, newText: edit.after })),
      }),
    },
    async execute(args, exec: ToolRunContext) {
      const raw = args as unknown as { edits?: MultiEditItemArgs[] }
      if (raw.edits === undefined || !Array.isArray(raw.edits)) throw new Error('multi_edit requires an edits array')
      const items = parseMultiEditArgs(raw.edits)
      if (exec.agent === undefined) throw new Error('multi_edit requires a session-bound agent')
      const agent = exec.agent

      // The rollback point this same tool call restores to. Its snapshot/create
      // session event fires, keeping the rollback fact replayable; capture is
      // lazy, so files untouched by this call cost nothing.
      const rollbackPoint = await ctx.snapshots.create(agent, { reason: 'multi_edit rollback point', signal: exec.signal })

      const applied: Array<{ path: string; before: string; after: string }> = []
      try {
        for (const item of items) {
          const target = await ctx.fs.resolve(item.file_path)
          // Same single-slot decision as the single-file edit tool; exec is the
          // actor the observation policy and snapshot capture key off.
          const intent = await ctx.waterfall('fs/edit-intent', target, exec, () => undefined)
          const outcome = await ctx.fs.editText(
            target,
            { oldString: item.old_string, newString: item.new_string, replaceAll: item.replace_all },
            intent,
            exec.signal,
          )
          ctx.emit('fs/observed', target, { kind: 'present', version: outcome.version }, exec)
          applied.push({ path: target.displayPath, before: outcome.before, after: outcome.after })
        }
      } catch (error: unknown) {
        // Roll back to the pre-edit state under this same tool call, then fail
        // loud: the model sees which file failed and that the rollback ran.
        const failedPath = items[applied.length]?.file_path ?? 'unknown'
        await ctx.snapshots.restore(agent, rollbackPoint.id, { rollback: true, signal: exec.signal })
        throw new Error(`multi_edit failed at ${failedPath}: ${String(error)}. The workspace was rolled back to its pre-edit state.`)
      }

      return { applied }
    },
    // Pure display: the requested edits as a multi-file diff card.
    presentCall(args): DiffCallView {
      const raw = args as unknown as { edits?: MultiEditItemArgs[] }
      const edits = raw.edits ?? []
      return {
        card: 'diff',
        title: `Multi-edit ${edits.length} file(s)`,
        diffs: edits.map(item => ({ path: item.file_path, oldText: item.old_string || null, newText: item.new_string })),
        locations: [...new Set(edits.map(item => item.file_path))].map(path => ({ path })),
      }
    },
    presentResult(args, result: ToolResult): DiffResultView | undefined {
      const raw = args as unknown as { edits?: MultiEditItemArgs[] }
      const edits = raw.edits ?? []
      if (result.isError) return undefined
      const meta = result.meta
      if (meta === undefined || meta === null || typeof meta !== 'object' || !('diffs' in meta) || !Array.isArray(meta.diffs)) return undefined
      return {
        card: 'diff',
        title: `Multi-edited ${edits.length} file(s)`,
        diffs: meta.diffs as { path: string; oldText: string | null; newText: string }[],
      }
    },
  }))
}
