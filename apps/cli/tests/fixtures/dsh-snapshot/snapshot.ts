import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { SessionId } from '@deepseek-ai/dsh-session'

const overlayPath = process.argv[2]
if (overlayPath === undefined) throw new Error('dsh-snapshot snapshot requires an overlay path')
const rootConfigPath = fileURLToPath(new URL('../../../../../packages/bundle/base/tests/fixtures/root.cordis.yml', import.meta.url))
const basePatchPath = fileURLToPath(new URL('../../../../../packages/bundle/base/cordis.patch.yml', import.meta.url))
const ctx = await boot('dsh-snapshot-snapshot', rootConfigPath, [
  ...loadOverlayPatches('dsh-snapshot-snapshot', basePatchPath),
  ...loadOverlayPatches('dsh-snapshot-snapshot', overlayPath),
])

/** Replace the isolated temp workspace with a stable token and fold path separators, so the snapshot replays on every platform. */
const normalize = (value: string): string => value.replaceAll(process.cwd(), '{{workspace}}').replaceAll('\\', '/')

/** The first text block of a tool result, normalized; anything else falls back to JSON. */
const textOf = (result: { content: ReadonlyArray<{ type: string; text?: string }> }): string => {
  const block = result.content[0]
  return block !== undefined && block.type === 'text' && block.text !== undefined
    ? normalize(block.text)
    : normalize(JSON.stringify(result.content))
}

try {
  const agentId = SessionId('dsh-snapshot-snapshot')
  const session = ctx.sessions.create(agentId, { meta: { cwd: process.cwd() } })
  const agent: Agent = {
    ctx: new Context(),
    id: agentId,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel: () => {},
    runMaintenance: job => job(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  let callNumber = 0
  const call = (name: string, args: Record<string, unknown>) => ctx.tools.execute({
    callId: ToolCallId(`dsh-snapshot-${++callNumber}`),
    name,
    arguments: args,
    agent,
    signal: new AbortController().signal,
  })

  // World: two fresh files (creation needs no prior observation).
  await call('write', { file_path: 'a.txt', content: 'alpha\n' })
  await call('write', { file_path: 'b.txt', content: 'beta\n' })

  // The rollback point.
  await call('snapshot_create', { reason: 'before refactor' })

  // Read-before-edit, as the observation policy requires.
  await call('read', { file_path: 'a.txt' })
  await call('read', { file_path: 'b.txt' })

  // Atomic multi-file edit: both apply.
  const multiEdit = await call('multi_edit', {
    edits: [
      { file_path: 'a.txt', old_string: 'alpha', new_string: 'ALPHA' },
      { file_path: 'b.txt', old_string: 'beta', new_string: 'BETA' },
    ],
  })

  // What changed since the snapshot.
  const diff = await call('snapshot_diff', { id: 's1' })

  // Roll the workspace back.
  const restore = await call('snapshot_restore', { id: 's1' })
  const readAfterRestore = await call('read', { file_path: 'a.txt' })

  // A failing multi-file edit rolls back its own applied edits.
  await call('read', { file_path: 'a.txt' })
  await call('read', { file_path: 'b.txt' })
  const rollback = await call('multi_edit', {
    edits: [
      { file_path: 'a.txt', old_string: 'alpha', new_string: 'TEMP' },
      { file_path: 'b.txt', old_string: 'not-present', new_string: 'X' },
    ],
  })
  const readAfterRollback = await call('read', { file_path: 'a.txt' })

  process.stdout.write(`${JSON.stringify({
    multiEdit: textOf(multiEdit),
    diff: textOf(diff),
    restore: textOf(restore),
    readAfterRestore: textOf(readAfterRestore),
    rollbackError: rollback.isError ? textOf(rollback) : 'expected an error result',
    readAfterRollback: textOf(readAfterRollback),
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
