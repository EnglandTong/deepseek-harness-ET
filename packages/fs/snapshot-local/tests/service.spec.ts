/**
 * Integration tests for the local snapshot provider against the real local
 * filesystem backend and the real fs observation policy: broadcast capture,
 * restore (approval gating, rollback, removal), diff, retention, restart
 * survival, and coexistence with the single-slot intent decider.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { FsWriteOutcome } from '@deepseek-ai/dsh-fs'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as FsPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SnapshotId } from '@deepseek-ai/dsh-snapshot'
import LocalSnapshotService from '@deepseek-ai/dsh-snapshot-local'
import type { Config } from '@deepseek-ai/dsh-snapshot-local'

let workRoot = ''
let snapRoot = ''
let ctx: Context
let session: Session
let agent: Agent

const baseConfig: Config = {
  retention: 20,
  maxFileBytes: 4 * 1024 * 1024,
  diffMaxLines: 2_000,
}

/** Tool-like write: record the prior observation, dispatch the intent waterfall, write, then record the new one. */
async function toolWrite(path: string, content: string): Promise<FsWriteOutcome> {
  const target = await ctx.fs.resolve(path)
  const actor = { agent }
  const info = await ctx.fs.stat(target)
  if (info !== undefined) {
    const prior = await ctx.fs.readText(target)
    void prior
    ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, actor)
  } else {
    ctx.emit('fs/observed', target, { kind: 'absent' }, actor)
  }
  const intent = await ctx.waterfall('fs/write-intent', target, actor, () => undefined)
  const outcome = await ctx.fs.writeText(target, content, intent)
  ctx.emit('fs/observed', target, { kind: 'present', version: outcome.version }, actor)
  return outcome
}

async function readTarget(path: string): Promise<string> {
  const target = await ctx.fs.resolve(path)
  return ctx.fs.readText(target)
}

function events(): Array<{ type: string; data: Record<string, unknown> }> {
  return session.snapshotEvents().map(event => ({ type: event.type, data: event.data as Record<string, unknown> }))
}

beforeEach(async () => {
  workRoot = mkdtempSync(join(tmpdir(), 'dsh-snap-work-'))
  snapRoot = mkdtempSync(join(tmpdir(), 'dsh-snap-store-'))
  ctx = new Context()
  await ctx.plugin(LocalFileSystem, { cwd: workRoot })
  await ctx.plugin(FsPolicy)
  await ctx.plugin(LocalSnapshotService, { ...baseConfig, rootDir: snapRoot })
  session = Session.create(SessionId('snap-test'))
  agent = { session } as unknown as Agent
  // Seed one file with prior content so captures have a pre-image.
  writeFileSync(join(workRoot, 'a.txt'), 'alpha\n')
})

afterEach(async () => {
  await ctx.fiber.dispose()
  rmSync(workRoot, { recursive: true, force: true })
  rmSync(snapRoot, { recursive: true, force: true })
})

describe('LocalSnapshotService', () => {
  it('creates empty manifests, lists them, and appends the session event', async () => {
    const first = await ctx.snapshots.create(agent, { reason: 'before refactor' })
    const second = await ctx.snapshots.create(agent, { reason: 'second' })

    expect(first.id).toEqual(SnapshotId('s1'))
    expect(second.id).toEqual(SnapshotId('s2'))
    expect(first.entryCount).toBe(0)
    expect(first.partial).toBe(false)

    const infos = await ctx.snapshots.list(agent)
    expect(infos.map(info => info.reason)).toEqual(['before refactor', 'second'])

    const logged = events().filter(event => event.type === 'snapshot/create')
    expect(logged).toEqual([
      { type: 'snapshot/create', data: { id: 's1', reason: 'before refactor' } },
      { type: 'snapshot/create', data: { id: 's2', reason: 'second' } },
    ])
  })

  it('broadcasts the pre-image to every snapshot and restores exactly', async () => {
    const s1 = await ctx.snapshots.create(agent, { reason: 'one' })
    const s2 = await ctx.snapshots.create(agent, { reason: 'two' })

    // First modification of a.txt after both snapshots: both get the pre-image.
    await toolWrite(join(workRoot, 'a.txt'), 'changed\n')
    // First creation of b.txt after both snapshots: both get absent.
    await toolWrite(join(workRoot, 'b.txt'), 'new\n')

    for (const info of await ctx.snapshots.list(agent)) {
      expect(info.entryCount).toBe(2)
    }

    // Restore s2 with approval auto-granted through a stub approval service.
    await mountGrantingApproval()
    const outcome = await ctx.snapshots.restore(agent, s2.id)
    expect(outcome.restored).toEqual([join(workRoot, 'a.txt')])
    expect(outcome.removed).toEqual([join(workRoot, 'b.txt')])
    expect(await readTarget(join(workRoot, 'a.txt'))).toBe('alpha\n')
    expect(existsSync(join(workRoot, 'b.txt'))).toBe(false)

    expect(events().filter(event => event.type === 'snapshot/restore')).toEqual([
      { type: 'snapshot/restore', data: { id: 's2', restored: 1, removed: 1 } },
    ])
    expect(s1.id).toEqual(SnapshotId('s1'))
  })

  it('restore without changes is a no-op that skips approval', async () => {
    const snap = await ctx.snapshots.create(agent, { reason: 'noop' })
    // No approval service composed: a no-op restore must still succeed.
    const outcome = await ctx.snapshots.restore(agent, snap.id)
    expect(outcome).toEqual({ id: snap.id, restored: [], removed: [], unmanaged: [] })
  })

  it('restore that discards changes fails loud without an approval service', async () => {
    const snap = await ctx.snapshots.create(agent, { reason: 'r' })
    await toolWrite(join(workRoot, 'a.txt'), 'discarded\n')
    await expect(ctx.snapshots.restore(agent, snap.id)).rejects.toThrow(/no approval service is composed/)
  })

  it('restore that discards changes propagates a rejection', async () => {
    const snap = await ctx.snapshots.create(agent, { reason: 'r' })
    await toolWrite(join(workRoot, 'a.txt'), 'discarded\n')
    await mountRejectingApproval()
    await expect(ctx.snapshots.restore(agent, snap.id)).rejects.toThrow(/was rejected/)
    // The workspace is untouched by the refused restore.
    expect(await readTarget(join(workRoot, 'a.txt'))).toBe('discarded\n')
  })

  it('rollback restore skips approval and undoes a multi-file batch', async () => {
    const snap = await ctx.snapshots.create(agent, { reason: 'multi_edit' })
    await toolWrite(join(workRoot, 'a.txt'), 'edited\n')
    await toolWrite(join(workRoot, 'c.txt'), 'created\n')

    const outcome = await ctx.snapshots.restore(agent, snap.id, { rollback: true })
    expect(outcome.restored).toEqual([join(workRoot, 'a.txt')])
    expect(outcome.removed).toEqual([join(workRoot, 'c.txt')])
    expect(await readTarget(join(workRoot, 'a.txt'))).toBe('alpha\n')
    expect(existsSync(join(workRoot, 'c.txt'))).toBe(false)
  })

  it('captures only the first modification; later writes do not re-capture', async () => {
    await ctx.snapshots.create(agent, { reason: 'r' })
    await toolWrite(join(workRoot, 'a.txt'), 'once\n')
    await toolWrite(join(workRoot, 'a.txt'), 'twice\n')
    const infos = await ctx.snapshots.list(agent)
    expect(infos[0]?.entryCount).toBe(1)

    // Restore returns to the snapshot-time state, not the intermediate write.
    await mountGrantingApproval()
    await ctx.snapshots.restore(agent, infos[0]!.id)
    expect(await readTarget(join(workRoot, 'a.txt'))).toBe('alpha\n')
  })

  it('diff reports modified, added, removed, and unmanaged paths', async () => {
    ctx = new Context()
    await ctx.plugin(LocalFileSystem, { cwd: workRoot })
    await ctx.plugin(FsPolicy)
    // 20 bytes admits the 6-byte a.txt pre-image while rejecting big.txt's 39.
    await ctx.plugin(LocalSnapshotService, { ...baseConfig, rootDir: snapRoot, maxFileBytes: 20 })
    session = Session.create(SessionId('snap-diff'))
    agent = { session } as unknown as Agent

    const snap = await ctx.snapshots.create(agent, { reason: 'diff basis' })
    // big.txt predates the snapshot at 39 bytes, over the 20-byte capture cap.
    writeFileSync(join(workRoot, 'big.txt'), 'this content is longer than four bytes')
    await toolWrite(join(workRoot, 'a.txt'), 'alpha\nbeta\n')
    await toolWrite(join(workRoot, 'big.txt'), 'this content is longer than four bytes, edited')
    await toolWrite(join(workRoot, 'gone.txt'), 'temporary\n')

    const diff = await ctx.snapshots.diff(agent, snap.id)
    const byPath = new Map(diff.files.map(file => [file.displayPath, file]))
    const modified = byPath.get(join(workRoot, 'a.txt'))
    expect(modified?.kind).toBe('modified')
    expect(modified?.hunks[0]?.lines).toContain('+beta')

    const added = byPath.get(join(workRoot, 'gone.txt'))
    expect(added?.kind).toBe('added')
    expect(diff.unmanagedPaths).toEqual([join(workRoot, 'big.txt')])

    // A captured file deleted since the snapshot reads as removed; a created-
    // then-deleted file returns to the snapshot state and drops out entirely.
    const fs = await import('node:fs')
    fs.rmSync(join(workRoot, 'gone.txt'))
    fs.rmSync(join(workRoot, 'a.txt'))
    const rediff = await ctx.snapshots.diff(agent, snap.id)
    expect(rediff.files.find(file => file.displayPath === join(workRoot, 'a.txt'))?.kind).toBe('removed')
    expect(rediff.files.find(file => file.displayPath === join(workRoot, 'gone.txt'))).toBeUndefined()
  })

  it('enforces the retention cap by dropping the oldest snapshots', async () => {
    ctx = new Context()
    await ctx.plugin(LocalFileSystem, { cwd: workRoot })
    await ctx.plugin(FsPolicy)
    await ctx.plugin(LocalSnapshotService, { ...baseConfig, rootDir: snapRoot, retention: 2 })
    session = Session.create(SessionId('snap-retain'))
    agent = { session } as unknown as Agent

    for (let index = 1; index <= 3; index++) {
      await ctx.snapshots.create(agent, { reason: `r${index}` })
    }
    const infos = await ctx.snapshots.list(agent)
    expect(infos.map(info => info.id)).toEqual([SnapshotId('s2'), SnapshotId('s3')])
    await expect(ctx.snapshots.restore(agent, SnapshotId('s1'))).rejects.toThrow(/does not exist/)
  })

  it('survives a provider restart with on-disk manifests', async () => {
    const snap = await ctx.snapshots.create(agent, { reason: 'durable' })
    await toolWrite(join(workRoot, 'a.txt'), 'after\n')
    await ctx.fiber.dispose()

    // A fresh composition over the same store root and session id.
    ctx = new Context()
    await ctx.plugin(LocalFileSystem, { cwd: workRoot })
    await ctx.plugin(FsPolicy)
    await ctx.plugin(LocalSnapshotService, { ...baseConfig, rootDir: snapRoot })
    const session2 = Session.create(SessionId('snap-test'))
    const agent2 = { session: session2 } as unknown as Agent
    await mountGrantingApproval()

    const infos = await ctx.snapshots.list(agent2)
    expect(infos.map(info => info.id)).toEqual([snap.id])
    const outcome = await ctx.snapshots.restore(agent2, snap.id)
    expect(outcome.restored).toEqual([join(workRoot, 'a.txt')])
    expect(await readTarget(join(workRoot, 'a.txt'))).toBe('alpha\n')
  })

  it('capture is inert without a session actor', async () => {
    await ctx.snapshots.create(agent, { reason: 'r' })
    // An actorless create (no agent) skips capture entirely; a fresh path
    // keeps the observation policy's createIfAbsent decision satisfiable.
    const target = await ctx.fs.resolve(join(workRoot, 'd.txt'))
    const intent = await ctx.waterfall('fs/write-intent', target, undefined, () => undefined)
    await ctx.fs.writeText(target, 'actorless\n', intent)
    const infos = await ctx.snapshots.list(agent)
    expect(infos[0]?.entryCount).toBe(0)
  })

  it('coexists with the observation policy: guarded writes still succeed', async () => {
    // The observation policy requires a read before an edit; exercise the
    // edit-intent waterfall end to end with capture prepended.
    await toolWrite(join(workRoot, 'a.txt'), 'first\n')
    await ctx.snapshots.create(agent, { reason: 'r' })
    const target = await ctx.fs.resolve(join(workRoot, 'a.txt'))
    const actor = { agent }
    const guard = await ctx.waterfall('fs/edit-intent', target, actor, () => undefined)
    await ctx.fs.editText(target, { oldString: 'first', newString: 'second', replaceAll: false }, guard)
    expect(await readTarget(join(workRoot, 'a.txt'))).toBe('second\n')
    const infos = await ctx.snapshots.list(agent)
    expect(infos[0]?.entryCount).toBe(1)
  })
})

/** Compose a stub approval service that grants every request. */
async function mountGrantingApproval(): Promise<void> {
  const { default: ApprovalService } = await import('@deepseek-ai/dsh-user-approval')
  class GrantingApproval extends ApprovalService {
    override async request(): Promise<'allowed-once'> {
      return 'allowed-once'
    }
  }
  await ctx.plugin(GrantingApproval, { policy: 'ask' })
}

/** Compose a stub approval service that rejects every request. */
async function mountRejectingApproval(): Promise<void> {
  const { default: ApprovalService } = await import('@deepseek-ai/dsh-user-approval')
  class RejectingApproval extends ApprovalService {
    override async request(): Promise<'rejected'> {
      return 'rejected'
    }
  }
  await ctx.plugin(RejectingApproval, { policy: 'ask' })
}
