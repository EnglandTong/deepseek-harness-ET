/**
 * Local workspace-snapshot provider (`ctx.snapshots`): lazy capture through the
 * `fs/write-intent` and `fs/edit-intent` waterfalls, content-addressed storage
 * under `dshHomePath('snapshots')/<sessionId>/`, restore through the standard
 * fs write path, and line diffs via the `diff` package.
 *
 * Capture listeners register with `prepend: true` so they run before the
 * single-slot intent deciders (the observation policy occupies the slot
 * without delegating); they ALWAYS call `next()` — capture annotates, it never
 * decides. Restore dispatches the same write-intent waterfall with a synthetic
 * `{ agent }` actor after priming observations with its own reads, so the
 * observation policy and sandbox fencing both participate normally.
 *
 * The lazy capture model: `create` records a manifest header (inheriting the
 * previous head's entries), and a file's pre-change content is materialized
 * only when the first mutation intent for it fires. Paths never mutated cost
 * nothing; paths that cannot be captured record an honest `unmanaged` entry.
 * @module @deepseek-ai/dsh-snapshot-local
 */

import { rm } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SnapshotId, SnapshotService } from '@deepseek-ai/dsh-snapshot'
import type { SnapshotDiff, SnapshotId as SnapshotIdType, SnapshotInfo, SnapshotRestoreOutcome } from '@deepseek-ai/dsh-snapshot'
import type { FsInfo, FsTarget } from '@deepseek-ai/dsh-fs'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { computeHunks, truncateDiff } from './diff.ts'
import { SnapshotStore } from './store.ts'
import type { StoredEntry, StoredManifest } from './store.ts'

/**
 * Minimal structural view of the intent-event actor the provider needs to
 * derive a session owner — the same narrowing `fs-observation-policy` uses, so
 * the tool's `exec` passes straight through and a synthetic `{ agent }` works
 * for provider-initiated writes.
 */
interface SnapshotActor {
  agent?: { session?: object }
}

/**
 * Minimal structural view of the approval service the provider consults for
 * destructive restores. `@deepseek-ai/dsh-user-approval`'s `ApprovalService`
 * satisfies it; the provider keeps no compile-time edge on the interaction
 * group.
 */
interface ApprovalAskable {
  request(req: { agent: unknown; toolName: string; reason?: string; signal?: AbortSignal }): Promise<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'>
}

/** One capture entry, mirrored from the public vocabulary. */
type ProviderEntry = StoredEntry['entry']

/** Provider configuration. */
export interface Config {
  /** Snapshots root; defaults to `dshHomePath('snapshots')`. */
  rootDir?: string
  /** Maximum snapshots kept per session; oldest are dropped on create. */
  retention: number
  /** Per-file capture cap in bytes; larger files record as unmanaged. */
  maxFileBytes: number
  /** Line budget across one diff result before truncation. */
  diffMaxLines: number
}

/** Default per-file capture cap: 4 MiB. */
const DEFAULT_MAX_FILE_BYTES = 4 * 1024 * 1024

/** Default diff line budget. */
const DEFAULT_DIFF_MAX_LINES = 2_000

/** Per-session runtime state: the store and its FIFO serialization queue. */
class SessionCapture {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(readonly store: SnapshotStore) {}

  /**
   * Serialize one capture step (one manifest extension) behind the session's
   * FIFO queue so parallel tool calls cannot interleave.
   * @param operation - the exclusive step.
   * @returns the step's result.
   */
  enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation)
    this.queue = run.catch(() => undefined)
    return run
  }
}

/**
 * The local snapshot provider. One instance per context; session state is
 * held weakly by session object, so a collected session frees its capture
 * head while its on-disk snapshots stay listable, restorable, and diffable.
 */
export class LocalSnapshotService extends SnapshotService {
  static inject = ['fs']

  static Config: z<Config> = z.object({
    rootDir: z.string(),
    retention: z.number().min(1).default(20),
    maxFileBytes: z.number().min(1).default(DEFAULT_MAX_FILE_BYTES),
    diffMaxLines: z.number().min(1).default(DEFAULT_DIFF_MAX_LINES),
  })

  private readonly sessions = new WeakMap<Session, SessionCapture>()
  private readonly config: Config
  private approval: ApprovalAskable | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.config = config
    // Optional dependency: the approval service gates destructive restores
    // whenever the composition provides one.
    ctx.inject(['approval'], (scope: Context) => {
      this.approval = scope.get('approval') as unknown as ApprovalAskable
      return () => { this.approval = undefined }
    })
    // Prepend so capture observes every intent before the single-slot deciders
    // (the observation policy occupies the slot without delegating). The
    // listener always delegates through next().
    ctx.on('fs/write-intent', (target, actor, next) => this.captureIntent(target, actor, next), { prepend: true })
    ctx.on('fs/edit-intent', (target, actor, next) => this.captureIntent(target, actor, next), { prepend: true })
  }

  /**
   * Capture the pre-change content of a target into every live snapshot that
   * does not yet track it, then delegate. The broadcast model keeps every
   * snapshot correct without inheritance: a file's first modification after a
   * snapshot's creation records the pre-image — which equals that snapshot's
   * state — into every snapshot lacking an entry for it. Every capture
   * failure degrades to an honest `unmanaged` entry; capture never vetoes the
   * mutation it observes.
   * @param target - the resolved target about to be written or edited.
   * @param actor - the opaque intent-event actor.
   * @param next - the rest of the waterfall chain; always invoked.
   * @returns the delegated chain's result.
   */
  private async captureIntent<T>(target: FsTarget, actor: object | undefined, next: () => T | Promise<T>): Promise<T> {
    try {
      const session = (actor as SnapshotActor | undefined)?.agent?.session
      if (session === undefined) return await next()
      const state = this.sessions.get(session as Session)
      if (state === undefined) return await next()
      await state.store.init()
      const infos = await state.store.listInfos()
      const lacking = infos.filter((info) => {
        const manifest = state.store.manifestOf(info.id)
        return manifest === undefined || !(target.targetKey in manifest.entries)
      })
      if (lacking.length === 0) return await next()
      const entry = await this.captureEntry(target, state.store)
      for (const info of lacking) {
        await state.enqueue(() => state.store.extendEntry(info.id, target.targetKey, { displayPath: target.displayPath, entry }))
      }
      return await next()
    } catch {
      // Capture bookkeeping must never break the mutation it observes.
      return await next()
    }
  }

  /**
   * Read a target's current content and produce its capture entry.
   * @param target - the target about to be mutated.
   * @param store - the acting session's store for the blob write.
   * @returns the honest entry: captured, unmanaged (too-large or
   *   capture-failed), or absent.
   */
  private async captureEntry(target: FsTarget, store: SnapshotStore): Promise<ProviderEntry> {
    const info = await this.ctx.fs.stat(target)
    if (info === undefined) return { kind: 'absent' }
    if (info.type !== 'file') return { kind: 'unmanaged', reason: 'capture-failed' }
    if ((info.size ?? 0) > this.config.maxFileBytes) return { kind: 'unmanaged', reason: 'too-large' }
    try {
      const content = await this.ctx.fs.readText(target)
      const blob = await store.writeBlob(content)
      return { kind: 'captured', blob, bytes: Buffer.byteLength(content, 'utf8') }
    } catch {
      return { kind: 'unmanaged', reason: 'capture-failed' }
    }
  }

  /**
   * Resolve (and cache) the per-session capture state.
   * @param session - the calling agent's session.
   * @returns the session's capture state.
   */
  private stateFor(session: Session): SessionCapture {
    let state = this.sessions.get(session)
    if (state === undefined) {
      state = new SessionCapture(new SnapshotStore(this.config.rootDir ?? dshHomePath('snapshots'), session.id))
      this.sessions.set(session, state)
    }
    return state
  }

  async create(agent: Agent, opts?: { reason?: string; signal?: AbortSignal }): Promise<SnapshotInfo> {
    const session = agent.session
    const state = this.stateFor(session)
    await state.store.init()
    const info = await state.enqueue(async () => {
      const id = await state.store.nextId()
      const createdAt = Date.now()
      const reason = opts?.reason ?? ''
      // An empty manifest: the broadcast-capture model fills entries lazily
      // from the first modification of each file after this point.
      const entries: Record<string, StoredEntry> = {}
      await state.store.writeManifest({ id, createdAt, reason, entries })
      return toInfo({ id, createdAt, reason, entries })
    })
    await state.store.enforceRetention(this.config.retention)
    session.append('snapshot/create', { id: info.id, reason: info.reason })
    return info
  }

  async list(agent: Agent): Promise<SnapshotInfo[]> {
    const state = this.stateFor(agent.session)
    await state.store.init()
    return state.store.listInfos()
  }

  async restore(agent: Agent, id: SnapshotIdType, opts?: { rollback?: boolean; signal?: AbortSignal }): Promise<SnapshotRestoreOutcome> {
    const session = agent.session
    const state = this.stateFor(session)
    await state.store.init()
    const manifest = await state.store.readManifest(id)
    if (manifest === undefined) throw new Error(`snapshot ${id} does not exist`)

    type Step =
      | { kind: 'write'; target: FsTarget; content: string; info?: FsInfo }
      | { kind: 'remove'; target: FsTarget }
    const steps: Step[] = []
    for (const row of Object.values(manifest.entries)) {
      // Resolve fresh: the manifest's displayPath is the only identity the
      // provider can act on, and resolve() re-canonicalizes it.
      const target = await this.ctx.fs.resolve(row.displayPath, opts?.signal === undefined ? {} : { signal: opts.signal })
      const info = await this.ctx.fs.stat(target, opts?.signal)
      if (row.entry.kind === 'absent') {
        if (info !== undefined && info.type === 'file') steps.push({ kind: 'remove', target })
        continue
      }
      if (row.entry.kind === 'unmanaged') continue
      const snapshotContent = await state.store.readBlob(row.entry.blob)
      if (info === undefined) {
        steps.push({ kind: 'write', target, content: snapshotContent })
        continue
      }
      if (info.type !== 'file') continue
      const current = await this.ctx.fs.readText(target, opts?.signal)
      if (current !== snapshotContent) steps.push({ kind: 'write', target, content: snapshotContent, info })
    }

    if (steps.length > 0 && opts?.rollback !== true) {
      // The destructive gate follows the deployment's sandbox stance: under
      // `danger-full-access` the session already accepts arbitrary mutation
      // (the write tool asks nothing there), so restore asks nothing either.
      // Every other mode routes through the approval seam inside the caller's
      // open turn.
      const policy = this.ctx.get('sandboxPolicy') as { resolve(req: { session: object }): { mode?: string } | undefined } | undefined
      const mode = policy?.resolve({ session })?.mode
      if (mode !== 'danger-full-access') {
        const approval = this.approval
        if (approval === undefined) {
          throw new Error('restore discards workspace changes but no approval service is composed; compose @deepseek-ai/dsh-user-approval or mark the restore as an atomic rollback')
        }
        const outcome = await approval.request({
          agent,
          toolName: 'snapshot_restore',
          reason: `Restore workspace to snapshot ${id}: ${steps.length} file(s) change.`,
          ...(opts?.signal === undefined ? {} : { signal: opts.signal }),
        })
        if (outcome !== 'allowed-once') throw new Error(`restore of snapshot ${id} was ${outcome}`)
      }
    }

    const restored: string[] = []
    const removed: string[] = []
    const actor = { agent }
    for (const step of steps) {
      if (step.kind === 'remove') {
        // The fs seam has no delete; the local provider removes natively,
        // confined to the same sandbox workspace root its writes honor.
        await this.containedRemove(session, step.target)
        removed.push(step.target.displayPath)
        continue
      }
      // Prime the observation record, then dispatch the standard write-intent
      // waterfall so capture, the observation policy, and sandbox fencing all
      // participate exactly as they do for tool writes.
      this.ctx.emit('fs/observed', step.target, step.info === undefined ? { kind: 'absent' } : { kind: 'present', version: step.info.version }, actor)
      const intent = await this.ctx.waterfall('fs/write-intent', step.target, actor, () => undefined)
      await this.ctx.fs.writeText(step.target, step.content, intent, opts?.signal)
      restored.push(step.target.displayPath)
    }

    const unmanaged = Object.values(manifest.entries)
      .filter(row => row.entry.kind === 'unmanaged')
      .map(row => row.displayPath)
    session.append('snapshot/restore', { id, restored: restored.length, removed: removed.length })
    return { id, restored, removed, unmanaged }
  }

  /**
   * Remove one file natively, honoring the sandbox workspace root when a
   * sandbox policy service is composed.
   * @param session - the session whose policy resolves the workspace root.
   * @param target - the file target to remove.
   */
  private async containedRemove(session: Session, target: FsTarget): Promise<void> {
    const policy = this.ctx.get('sandboxPolicy') as { resolve(req: { session: object }): { workspaceRoot?: string } | undefined } | undefined
    const root = policy?.resolve({ session })?.workspaceRoot
    if (root !== undefined) {
      const rootTarget = await this.ctx.fs.resolve(root)
      if (!this.ctx.fs.contains(rootTarget, target)) {
        throw new Error(`refusing to remove ${target.displayPath}: outside the sandbox workspace root`)
      }
    }
    await rm(this.ctx.fs.processPath(target), { force: true })
  }

  async diff(agent: Agent, id: SnapshotIdType, opts?: { signal?: AbortSignal }): Promise<SnapshotDiff> {
    const state = this.stateFor(agent.session)
    await state.store.init()
    const manifest = await state.store.readManifest(id)
    if (manifest === undefined) throw new Error(`snapshot ${id} does not exist`)

    const files: SnapshotDiff['files'][number][] = []
    const unmanagedPaths: string[] = []
    for (const row of Object.values(manifest.entries)) {
      if (row.entry.kind === 'unmanaged') {
        unmanagedPaths.push(row.displayPath)
        continue
      }
      const target = await this.ctx.fs.resolve(row.displayPath, opts?.signal === undefined ? {} : { signal: opts.signal })
      const info = await this.ctx.fs.stat(target, opts?.signal)
      if (row.entry.kind === 'absent') {
        // The file did not exist at snapshot time; one that exists now was
        // created after it and shows as a whole-file addition.
        if (info !== undefined && info.type === 'file') {
          const current = await this.ctx.fs.readText(target, opts?.signal)
          files.push({ displayPath: row.displayPath, kind: 'added', hunks: computeHunks('', current), oldText: null, newText: current })
        }
        continue
      }
      const snapshotContent = await state.store.readBlob(row.entry.blob)
      if (info === undefined) {
        files.push({ displayPath: row.displayPath, kind: 'removed', hunks: [], oldText: snapshotContent, newText: null })
        continue
      }
      if (info.type !== 'file') continue
      const current = await this.ctx.fs.readText(target, opts?.signal)
      if (current === snapshotContent) continue
      files.push({ displayPath: row.displayPath, kind: 'modified', hunks: computeHunks(snapshotContent, current), oldText: snapshotContent, newText: current })
    }
    // The lazy model tracks only manifest rows: paths created after the
    // snapshot and never mutated since stay invisible to diff (and to
    // restore's rewrite set) — creation-time tree enumeration is out of scope.
    const truncated = truncateDiff(files, this.config.diffMaxLines)
    return { id, files: truncated.files, truncated: truncated.truncated, unmanagedPaths }
  }
}

/**
 * Project a stored manifest onto the public metadata shape.
 * @param manifest - the stored manifest.
 * @returns its `SnapshotInfo` projection, including the honest partial flag.
 */
function toInfo(manifest: StoredManifest): SnapshotInfo {
  const entries = Object.values(manifest.entries)
  return {
    id: SnapshotId(manifest.id),
    createdAt: manifest.createdAt,
    reason: manifest.reason,
    entryCount: entries.length,
    partial: entries.some(row => row.entry.kind === 'unmanaged'),
  }
}

export default LocalSnapshotService
