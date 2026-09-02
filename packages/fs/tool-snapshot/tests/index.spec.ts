/** Tests for the snapshot tool consumer: registration, execution against a stub snapshots service, and presentation. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SnapshotId } from '@deepseek-ai/dsh-snapshot'
import SnapshotService from '@deepseek-ai/dsh-snapshot'
import type { SnapshotInfo } from '@deepseek-ai/dsh-snapshot'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as ToolSnapshot from '@deepseek-ai/dsh-tool-snapshot'

const restoreCalls: Array<{ id: string }> = []

/**
 * Stub snapshot provider: a SnapshotService subclass mounted as the real
 * service plugin, so inject resolution and ctx.snapshots access run through
 * cordis's actual service mechanism.
 */
class StubSnapshots extends SnapshotService {
  readonly create = vi.fn(async (_agent: Agent, opts?: { reason?: string }): Promise<SnapshotInfo> =>
    ({ id: SnapshotId('s1'), createdAt: 1_000, reason: opts?.reason ?? '', entryCount: 0, partial: false }))

  readonly list = vi.fn(async (): Promise<SnapshotInfo[]> => [
    { id: SnapshotId('s1'), createdAt: 1_000, reason: 'first', entryCount: 2, partial: false },
    { id: SnapshotId('s2'), createdAt: 2_000, reason: 'second', entryCount: 1, partial: true },
  ])

  readonly restore = vi.fn(async (_agent: Agent, id: ReturnType<typeof SnapshotId>) => {
    restoreCalls.push({ id })
    return { id, restored: ['a.txt'], removed: ['b.txt'], unmanaged: ['c.bin'] }
  })

  readonly diff = vi.fn(async (_agent: Agent, id: ReturnType<typeof SnapshotId>) => ({
    id,
    truncated: false,
    files: [{
      displayPath: 'a.txt',
      kind: 'modified' as const,
      hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-old', '+new'] }],
      oldText: 'old\n',
      newText: 'new\n',
    }],
    unmanagedPaths: ['c.bin'],
  }))
}

let ctx: Context
let session: Session
let agent: Agent
let stub: StubSnapshots

beforeEach(async () => {
  restoreCalls.length = 0
  ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(StubSnapshots)
  await ctx.plugin(ToolSnapshot)
  stub = ctx.snapshots as StubSnapshots
  session = Session.create(SessionId('tool-snapshot-test'))
  agent = { session } as unknown as Agent
})

describe('tool-snapshot registration', () => {
  it('registers under the plugin name with its service dependencies', () => {
    expect(ToolSnapshot.name).toBe('tool-snapshot')
    expect(ToolSnapshot.inject).toEqual(['tools', 'snapshots', 'systemPrompt'])
  })

  it('registers the four tools and the system-prompt section', async () => {
    for (const tool of ['snapshot_create', 'snapshot_list', 'snapshot_restore', 'snapshot_diff']) {
      expect(ctx.tools.get(tool, agent)).toBeDefined()
    }
    const prompt = await ctx.systemPrompt.assemble()
    const text = prompt.sections.map(section => section.text).join('\n')
    expect(text).toContain('snapshot_create')
  })
})

/** Execute one tool call the way the agent loop does. */
function call(name: string, args: Record<string, unknown>, withAgent: boolean = true) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`snapshot-tool-${++callNumber}`),
    name,
    arguments: args,
    ...withAgent ? { agent } : {},
  })
}

let callNumber = 0

describe('snapshot tools', () => {
  it('snapshot_create forwards the reason and reports the id', async () => {
    const result = await call('snapshot_create', { reason: 'before refactor' })
    expect(result.isError).toBe(false)
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('s1') })
    expect(stub.create).toHaveBeenCalledWith(agent, expect.objectContaining({ reason: 'before refactor' }))
  })

  it('snapshot_list renders every snapshot with its partial flag', async () => {
    const result = await call('snapshot_list', {})
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('s2: second') })
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('[partial]') })
  })

  it('snapshot_restore previews with a diff, restores, and renders the outcome', async () => {
    const result = await call('snapshot_restore', { id: 's1' })
    expect(result.isError).toBe(false)
    expect(stub.diff).toHaveBeenCalled()
    expect(restoreCalls).toEqual([{ id: 's1' }])
    const text = JSON.stringify(result.content)
    expect(text).toContain('Rewritten: a.txt')
    expect(text).toContain('Removed: b.txt')
  })

  it('snapshot_diff renders hunks and unmanaged paths', async () => {
    const result = await call('snapshot_diff', { id: 's1' })
    const text = JSON.stringify(result.content)
    expect(text).toContain('a.txt (modified)')
    expect(text).toContain('-old')
    expect(text).toContain('unmanaged (cannot restore): c.bin')
  })

  it('rejects execution without a session-bound agent', async () => {
    const result = await call('snapshot_list', {}, false)
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('session-bound agent')
  })
})
