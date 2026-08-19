/** Tests for the multi_edit tool: atomic multi-file application, failure rollback, and presentation. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as FsPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import LocalSnapshotService from '@deepseek-ai/dsh-snapshot-local'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as ToolMultiedit from '@deepseek-ai/dsh-tool-multiedit'

let workRoot = ''
let snapRoot = ''

let ctx: Context
let session: Session
let agent: Agent
let callNumber = 0

/** Tool-like read that records the versioned observation the fs-observation-policy gates on. */
async function readThrough(path: string): Promise<string> {
  const target = await ctx.fs.resolve(path)
  const info = await ctx.fs.stat(target)
  const content = await ctx.fs.readText(target)
  ctx.emit('fs/observed', target, info === undefined ? { kind: 'absent' } : { kind: 'present', version: info.version }, { agent })
  return content
}

/** Execute one tool call the way the agent loop does. */
function call(name: string, args: Record<string, unknown>) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`multiedit-${++callNumber}`),
    name,
    arguments: args,
    agent,
  })
}

beforeEach(async () => {
  workRoot = mkdtempSync(join(tmpdir(), 'dsh-multiedit-'))
  snapRoot = mkdtempSync(join(tmpdir(), 'dsh-multiedit-snaps-'))
  ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: workRoot })
  await ctx.plugin(FsPolicy)
  await ctx.plugin(LocalSnapshotService, { rootDir: snapRoot, retention: 20, maxFileBytes: 4 * 1024 * 1024, diffMaxLines: 2_000 })
  await ctx.plugin(ToolMultiedit)
  session = Session.create(SessionId('multiedit-test'))
  agent = { session } as unknown as Agent
})

afterEach(async () => {
  await ctx.fiber.dispose()
  rmSync(workRoot, { recursive: true, force: true })
  rmSync(snapRoot, { recursive: true, force: true })
})

describe('multi_edit', () => {
  it('applies edits across files atomically and reports every path', async () => {
    writeFileSync(join(workRoot, 'a.txt'), 'alpha\n')
    writeFileSync(join(workRoot, 'b.txt'), 'beta\n')
    await readThrough(join(workRoot, 'a.txt'))
    await readThrough(join(workRoot, 'b.txt'))

    const result = await call('multi_edit', {
      edits: [
        { file_path: 'a.txt', old_string: 'alpha', new_string: 'ALPHA' },
        { file_path: 'b.txt', old_string: 'beta', new_string: 'BETA' },
      ],
    })
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result.content)).toContain('2 edit(s)')

    expect(await ctx.fs.readText(await ctx.fs.resolve(join(workRoot, 'a.txt')))).toBe('ALPHA\n')
    expect(await ctx.fs.readText(await ctx.fs.resolve(join(workRoot, 'b.txt')))).toBe('BETA\n')
  })

  it('rolls back every applied edit when a later one fails', async () => {
    writeFileSync(join(workRoot, 'a.txt'), 'alpha\n')
    writeFileSync(join(workRoot, 'b.txt'), 'beta\n')
    await readThrough(join(workRoot, 'a.txt'))
    await readThrough(join(workRoot, 'b.txt'))

    const result = await call('multi_edit', {
      edits: [
        { file_path: 'a.txt', old_string: 'alpha', new_string: 'ALPHA' },
        { file_path: 'b.txt', old_string: 'not-present', new_string: 'BETA' },
      ],
    })
    expect(result.isError).toBe(true)
    const text = JSON.stringify(result.content)
    expect(text).toContain('b.txt')
    expect(text).toContain('rolled back')

    // The first file is back to its pre-edit state: the call is atomic.
    expect(await ctx.fs.readText(await ctx.fs.resolve(join(workRoot, 'a.txt')))).toBe('alpha\n')
    expect(await ctx.fs.readText(await ctx.fs.resolve(join(workRoot, 'b.txt')))).toBe('beta\n')
  })

  it('rejects an empty old_string up front with the offending index', async () => {
    const result = await call('multi_edit', {
      edits: [{ file_path: 'a.txt', old_string: '', new_string: 'x' }],
    })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('edits[0].old_string')
  })

  it('rejects execution without a session-bound agent', async () => {
    writeFileSync(join(workRoot, 'a.txt'), 'alpha\n')
    await readThrough(join(workRoot, 'a.txt'))
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('multiedit-noagent'),
      name: 'multi_edit',
      arguments: { edits: [{ file_path: 'a.txt', old_string: 'alpha', new_string: 'ALPHA' }] },
    })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('session-bound agent')
  })

  it('registers under the plugin name with its service dependencies', () => {
    expect(ToolMultiedit.name).toBe('tool-multiedit')
    expect(ToolMultiedit.inject).toEqual(['tools', 'fs', 'snapshots', 'systemPrompt'])
    expect(ctx.tools.get('multi_edit', agent)).toBeDefined()
  })
})
