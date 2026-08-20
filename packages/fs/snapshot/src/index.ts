/**
 * Workspace-snapshot Service Definition (`ctx.snapshots`): creation, listing,
 * restoration, and diffing of workspace file snapshots per session. Providers
 * own capture timing, storage, and restore mechanics; the definition fixes the
 * model-visible vocabulary — a snapshot's identity, its honest partial/capture
 * state, and the two session events that make snapshot facts replayable
 * (`snapshot/create`, `snapshot/restore`).
 *
 * The service deliberately takes the calling {@link Agent}: storage is keyed by
 * the agent's session, restore re-enters the fs write path under that agent's
 * sandbox policy, and the two session events land on the agent's own log.
 * @module @deepseek-ai/dsh-snapshot
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SnapshotId } from './types.ts'
import type { SnapshotDiff, SnapshotInfo, SnapshotRestoreOutcome } from './types.ts'

export type {
  SnapshotDiff,
  SnapshotEntry,
  SnapshotFileDiff,
  SnapshotHunk,
  SnapshotInfo,
  SnapshotRestoreOutcome,
} from './types.ts'
export { SnapshotId }

declare module '@deepseek-ai/cordis' {
  interface Context {
    snapshots: SnapshotService
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * A workspace snapshot was created for this session. Log-only,
     * non-surface, whole-value event: replay folds the set of known snapshot
     * ids from the log alone. The honest capture boundary (unmanaged paths)
     * is runtime state, not a creation-time fact, so it lives on
     * `SnapshotInfo.partial` instead of this event.
     * @param id - the provider-assigned snapshot identity (opaque string).
     * @param reason - the creator-supplied free-form reason.
     */
    'snapshot/create': { id: string; reason: string }
    /**
     * The workspace was restored to snapshot `id`. Log-only, non-surface,
     * whole-value event: the model can reconstruct "the workspace returned to
     * snapshot N" from the log without live provider state.
     * @param id - the restored snapshot's identity (opaque string).
     * @param restored - how many paths were rewritten from captured blobs.
     * @param removed - how many paths were deleted because the snapshot lacked them.
     */
    'snapshot/restore': { id: string; restored: number; removed: number }
  }
}

/** Options for {@link SnapshotService.create}. */
export interface SnapshotCreateOptions {
  /** Free-form reason recorded on the snapshot and its session event. */
  readonly reason?: string
  /** Aborts the snapshot creation. */
  readonly signal?: AbortSignal
}

/** Options for {@link SnapshotService.restore}. */
export interface SnapshotRestoreOptions {
  /**
   * Skip the destructive-change approval gate. Reserved for atomic rollback
   * paths that restore to a snapshot captured within the same tool call —
   * never a model-supplied value.
   */
  readonly rollback?: boolean
  /** Aborts the restore before the next file write. */
  readonly signal?: AbortSignal
}

/** Options for {@link SnapshotService.diff}. */
export interface SnapshotDiffOptions {
  /** Aborts the diff computation. */
  readonly signal?: AbortSignal
}

/**
 * Abstract workspace-snapshot provider. One instance serves one session scope
 * (`ctx.snapshots`); the local provider captures lazily through fs
 * write/edit-intent waterfalls and stores content-addressed blobs. Restore is
 * destructive-change-guarded by default: it discards current content the
 * snapshot predates, so providers route it through the approval seam unless
 * {@link SnapshotRestoreOptions.rollback} marks an atomic self-rollback.
 */
export abstract class SnapshotService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'snapshots')
  }

  /**
   * Create a snapshot of the workspace state for the agent's session.
   * @param agent - the agent whose workspace and session the snapshot belongs to.
   * @param opts - reason and cancellation signal.
   * @returns the created snapshot's metadata; content capture itself is lazy
   *   and ownership stays with the provider.
   */
  abstract create(agent: Agent, opts?: SnapshotCreateOptions): Promise<SnapshotInfo>

  /**
   * List the session's snapshots, oldest first.
   * @param agent - the agent whose session's snapshots are listed.
   * @returns snapshot metadata in creation order.
   */
  abstract list(agent: Agent): Promise<SnapshotInfo[]>

  /**
   * Restore the workspace to a snapshot. Rewrites files whose captured content
   * differs, removes files the snapshot predates, and reports unmanaged paths
   * verbatim. Destructive by default — providers gate it on approval unless
   * the caller marks an atomic rollback.
   * @param agent - the agent whose workspace is restored.
   * @param id - the snapshot to restore.
   * @param opts - rollback marker and cancellation signal.
   * @returns what was rewritten, removed, and honestly left unmanaged.
   */
  abstract restore(agent: Agent, id: SnapshotId, opts?: SnapshotRestoreOptions): Promise<SnapshotRestoreOutcome>

  /**
   * Compute the line diff between a snapshot and the current workspace content.
   * @param agent - the agent whose workspace is compared.
   * @param id - the snapshot to diff against.
   * @param opts - cancellation signal.
   * @returns per-file differences plus the unmanaged-path boundary.
   */
  abstract diff(agent: Agent, id: SnapshotId, opts?: SnapshotDiffOptions): Promise<SnapshotDiff>
}

export default SnapshotService
