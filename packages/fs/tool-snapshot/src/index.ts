/**
 * Workspace-snapshot tool Consumer: `snapshot_create`, `snapshot_list`,
 * `snapshot_restore`, and `snapshot_diff` over `ctx.snapshots`. Restore and
 * diff results render as multi-file diff cards (the diff payload rides in the
 * canonical value, projected by `presentationMeta` — the same replayable-meta
 * pattern tool-fs uses); create and list render as generic cards. All
 * presentation is pure in (args, value).
 * @module @deepseek-ai/dsh-tool-snapshot
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { SnapshotId } from '@deepseek-ai/dsh-snapshot'
import type { SnapshotFileDiff } from '@deepseek-ai/dsh-snapshot'

/** Cordis plugin name. */
export const name = 'tool-snapshot'
/** The tool registry, system prompt, and snapshot seam the tools project onto. */
export const inject = ['tools', 'snapshots', 'systemPrompt']

/**
 * The session-bound agent every snapshot tool operates through.
 * @param exec - the tool run context.
 * @returns the executing agent.
 */
function agentOf(exec: { agent?: unknown }) {
  if (exec.agent === undefined) throw new Error('snapshot tools require a session-bound agent')
  return exec.agent as Parameters<Context['snapshots']['create']>[0]
}

/**
 * Project the service diff files onto the presentation `FileDiff` payload.
 * @param files - per-file differences in the service's stable order.
 * @returns one presentation entry per file.
 */
function toFileDiffs(files: readonly SnapshotFileDiff[]) {
  return files.map(file => ({ path: file.displayPath, oldText: file.oldText, newText: file.newText ?? '' }))
}

/**
 * Human-readable diff block for the model-facing content.
 * @param files - per-file differences in the service's stable order.
 * @param truncated - whether the service capped the hunk budget.
 * @param unmanagedPaths - paths the snapshot cannot restore.
 * @returns the unified-diff text block.
 */
function renderDiffText(files: readonly SnapshotFileDiff[], truncated: boolean, unmanagedPaths: readonly string[]): string {
  if (files.length === 0) return '(no differences)'
  const blocks = files.map((file) => {
    const header = `${file.displayPath} (${file.kind})`
    if (file.hunks.length === 0) return header
    const hunks = file.hunks.map((hunk) => {
      const head = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
      return [head, ...hunk.lines].join('\n')
    })
    return `${header}\n${hunks.join('\n')}`
  })
  const suffix = truncated ? '\n(diff truncated)' : ''
  const unmanaged = unmanagedPaths.length === 0 ? '' : `\nunmanaged (cannot restore): ${unmanagedPaths.join(', ')}`
  return blocks.join('\n') + suffix + unmanaged
}

/**
 * Register the four snapshot tools and their system-prompt section.
 * @param ctx - Cordis context carrying the tool registry and snapshots service.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'snapshot_create',
    description: 'Snapshot the workspace state so later changes can be rolled back or compared. Cheap: only files that change after creation are captured. Do this before risky multi-step changes.',
    parameters: {
      reason: { type: 'string', required: true, description: 'Short free-form reason recorded with the snapshot, e.g. "before refactor of auth flow".' },
    },
    async execute(args, exec) {
      return await ctx.snapshots.create(agentOf(exec), { reason: args.reason, signal: exec.signal })
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          createdAt: { type: 'number', required: true },
          reason: { type: 'string', required: true },
          entryCount: { type: 'number', required: true },
          partial: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => {
        const partial = value.partial ? ' (partial: some paths cannot be restored)' : ''
        return [{ type: 'text', text: `Snapshot ${value.id} created (${value.entryCount} tracked path(s))${partial}. Use snapshot_restore with id ${value.id} to roll back to this point.` }]
      },
    },
    presentCall(args) {
      return { card: 'generic', title: `Create snapshot: ${args.reason}` }
    },
    presentResult(_args, result) {
      return { card: 'generic', title: `Snapshot ${result.meta !== undefined && typeof result.meta === 'object' && result.meta !== null && 'id' in result.meta ? String((result.meta as { id: unknown }).id) : 'created'}` }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'snapshot_list',
    description: 'List this session\'s workspace snapshots, oldest first, with their ids, reasons, and honest partial flags.',
    parameters: {},
    async execute(_args, exec) {
      return await ctx.snapshots.list(agentOf(exec))
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            createdAt: { type: 'number', required: true },
            reason: { type: 'string', required: true },
            entryCount: { type: 'number', required: true },
            partial: { type: 'boolean', required: true },
          },
        },
      },
      render: (_args, value) => {
        if (value.length === 0) {
          return [{ type: 'text', text: 'No snapshots yet. Create one with snapshot_create before risky changes.' }]
        }
        const rows = value.map(info => `${info.id}: ${info.reason || '(no reason)'} — ${info.entryCount} tracked path(s)${info.partial ? ' [partial]' : ''}`)
        return [{ type: 'text', text: `Snapshots (oldest first):\n${rows.join('\n')}` }]
      },
    },
    presentCall() {
      return { card: 'generic', title: 'List snapshots' }
    },
    presentResult() {
      return { card: 'generic', title: 'Snapshots' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'snapshot_restore',
    description: 'Restore workspace files to a snapshot\'s state: rewrites files that differ, removes files created after the snapshot. Destructive — asks for approval when it would discard changes. Unmanaged paths (capture failed or oversized) are reported, not restored.',
    parameters: {
      id: { type: 'string', required: true, description: 'Snapshot id from snapshot_create or snapshot_list.' },
    },
    async execute(args, exec) {
      const agent = agentOf(exec)
      const id = SnapshotId(args.id)
      // The pre-restore diff doubles as the approval preview and the diff card.
      const diff = await ctx.snapshots.diff(agent, id, { signal: exec.signal })
      const outcome = await ctx.snapshots.restore(agent, id, { signal: exec.signal })
      return {
        id: outcome.id,
        restored: [...outcome.restored],
        removed: [...outcome.removed],
        unmanaged: [...outcome.unmanaged],
        diffs: toFileDiffs(diff.files),
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          restored: { type: 'array', items: { type: 'string' }, required: true },
          removed: { type: 'array', items: { type: 'string' }, required: true },
          unmanaged: { type: 'array', items: { type: 'string' }, required: true },
          diffs: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                oldText: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
                newText: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const parts = [`Workspace restored to snapshot ${value.id}.`]
        if (value.restored.length > 0) parts.push(`Rewritten: ${value.restored.join(', ')}`)
        if (value.removed.length > 0) parts.push(`Removed: ${value.removed.join(', ')}`)
        if (value.unmanaged.length > 0) parts.push(`Unmanaged (left untouched): ${value.unmanaged.join(', ')}`)
        return [{ type: 'text', text: parts.join('\n') }]
      },
      presentationMeta: (_args, value) => ({ diffs: value.diffs }),
    },
    presentCall(args) {
      return { card: 'generic', title: `Restore snapshot ${args.id}` }
    },
    presentResult(_args, result) {
      const meta = result.meta
      if (meta !== undefined && typeof meta === 'object' && meta !== null && 'diffs' in meta && Array.isArray(meta.diffs)) {
        return { card: 'diff', title: 'Restored', diffs: meta.diffs as { path: string; oldText: string | null; newText: string }[] }
      }
      return { card: 'generic', title: 'Restored' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'snapshot_diff',
    description: 'Line diff between a snapshot and the current workspace. Shows modified, added, and removed files among the snapshot\'s tracked paths.',
    parameters: {
      id: { type: 'string', required: true, description: 'Snapshot id from snapshot_create or snapshot_list.' },
    },
    async execute(args, exec) {
      const diff = await ctx.snapshots.diff(agentOf(exec), SnapshotId(args.id), { signal: exec.signal })
      return {
        id: diff.id,
        truncated: diff.truncated,
        files: diff.files.map(file => ({
          displayPath: file.displayPath,
          kind: file.kind,
          hunks: file.hunks.map(hunk => ({
            oldStart: hunk.oldStart,
            oldLines: hunk.oldLines,
            newStart: hunk.newStart,
            newLines: hunk.newLines,
            lines: [...hunk.lines],
          })),
          oldText: file.oldText,
          newText: file.newText,
        })),
        unmanagedPaths: [...diff.unmanagedPaths],
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          truncated: { type: 'boolean', required: true },
          files: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                displayPath: { type: 'string', required: true },
                kind: { type: 'string', required: true, enum: ['modified', 'added', 'removed'] },
                hunks: { type: 'json', required: true },
                oldText: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
                newText: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
              },
            },
          },
          unmanagedPaths: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
      render: (_args, value) => {
        const files = value.files as unknown as SnapshotFileDiff[]
        return [{ type: 'text', text: `Diff against snapshot ${value.id}:\n${renderDiffText(files, value.truncated, value.unmanagedPaths)}` }]
      },
      presentationMeta: (_args, value) => ({ diffs: toFileDiffs(value.files as unknown as SnapshotFileDiff[]) }),
    },
    presentCall(args) {
      return { card: 'generic', title: `Diff vs snapshot ${args.id}` }
    },
    presentResult(_args, result) {
      const meta = result.meta
      if (meta !== undefined && typeof meta === 'object' && meta !== null && 'diffs' in meta && Array.isArray(meta.diffs)) {
        return { card: 'diff', title: 'Diff', diffs: meta.diffs as { path: string; oldText: string | null; newText: string }[] }
      }
      return { card: 'generic', title: 'Diff' }
    },
  }))

  ctx.systemPrompt.section({
    name: 'tool:snapshot',
    order: 102,
    text: 'Workspace snapshots are cheap rollback points: call snapshot_create before risky or multi-step changes, then snapshot_restore to undo. snapshot_diff previews what a restore would change. Snapshots only capture files that change after creation — restoring cannot recover files that existed before the snapshot but were never modified.',
  })
}
