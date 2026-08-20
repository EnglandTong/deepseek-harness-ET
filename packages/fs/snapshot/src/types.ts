/**
 * Vocabulary for the workspace-snapshot Service Definition (`ctx.snapshots`):
 * the opaque snapshot identity, manifest metadata, per-path capture state, the
 * line-diff projection, and the restore outcome. The word "checkpoint" stays
 * reserved for session-log persistence checkpoints
 * (`@deepseek-ai/dsh-session-checkpoint-policy`); this seam snapshots workspace
 * files.
 * @module @deepseek-ai/dsh-snapshot/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * Opaque identity of one workspace snapshot within a session. A consumer
 * receives it from {@link SnapshotService.create} or {@link SnapshotService.list}
 * and MUST NOT parse it or assume any ordering.
 */
export type SnapshotId = Branded<'SnapshotId'>

/**
 * Brand a string as a {@link SnapshotId}. For provider use only — a consumer
 * never manufactures an id, it receives one from `create()`/`list()`.
 * @param id - the provider's raw id string.
 * @returns the same string, branded; no validation is performed.
 */
export function SnapshotId(id: string): SnapshotId {
  return id as SnapshotId
}

/**
 * One path's capture state inside a snapshot manifest.
 *
 * - `captured` — the pre-change content is materialized as a content-addressed
 *   blob; the path is restorable.
 * - `unmanaged` — the path's content was NOT captured (the write raced ahead,
 *   the file exceeded the configured size cap, or the blob write failed). The
 *   snapshot reports it honestly instead of silently dropping it; restore and
 *   diff list these paths so the model knows the boundary.
 * - `absent` — the path did not exist when the intent fired; restoring means
 *   removing the file created since.
 */
export type SnapshotEntry =
  | { readonly kind: 'captured'; readonly blob: string; readonly bytes: number }
  | { readonly kind: 'unmanaged'; readonly reason: 'too-large' | 'capture-failed' }
  | { readonly kind: 'absent' }

/**
 * Metadata about one snapshot — what {@link SnapshotService.create} returns and
 * every {@link SnapshotService.list} entry carries. Content never travels here:
 * the manifest on the provider's storage maps paths to entries.
 */
export interface SnapshotInfo {
  /** Opaque snapshot identity. */
  readonly id: SnapshotId
  /** Non-negative Unix epoch milliseconds when the snapshot was created. */
  readonly createdAt: number
  /** Free-form creator-supplied reason recorded with the snapshot. */
  readonly reason: string
  /** Number of paths the manifest tracks (captured + unmanaged + absent). */
  readonly entryCount: number
  /**
   * True when at least one path is `unmanaged`: capture raced or capped. The
   * fact is part of the model-visible contract — a partial snapshot restores
   * and diffs only what it actually captured.
   */
  readonly partial: boolean
}

/**
 * One hunk of a unified line diff, in standard `@@ -a,b +c,d @@` coordinates.
 * `lines` carries the raw unified lines: context lines prefixed with a space,
 * removals with `-`, additions with `+`.
 */
export interface SnapshotHunk {
  /** Start line in the snapshot content (1-based; 0 when the side is empty). */
  readonly oldStart: number
  /** Line count on the snapshot side of the hunk. */
  readonly oldLines: number
  /** Start line in the current content (1-based; 0 when the side is empty). */
  readonly newStart: number
  /** Line count on the current side of the hunk. */
  readonly newLines: number
  /** Unified diff lines for this hunk without the `@@` header. */
  readonly lines: readonly string[]
}

/**
 * One file's difference between a snapshot and the current workspace content,
 * from the snapshot's perspective: `modified` when both sides exist and differ,
 * `added` when only the current side exists, `removed` when only the snapshot
 * side exists. The full side texts ride along so tool presentations can build
 * diff cards without re-reading storage.
 */
export interface SnapshotFileDiff {
  /** Model/UI-facing path as the fs backend reports it. */
  readonly displayPath: string
  /** How the current content relates to the snapshot content. */
  readonly kind: 'modified' | 'added' | 'removed'
  /** Hunks in file order; empty when the absent side makes them vacuous. */
  readonly hunks: readonly SnapshotHunk[]
  /** Snapshot-side content; `null` for `added` (no snapshot side). */
  readonly oldText: string | null
  /** Current-side content; `null` for `removed` (no current side). */
  readonly newText: string | null
}

/**
 * The full workspace difference between a snapshot and now.
 */
export interface SnapshotDiff {
  /** The snapshot this diff is against. */
  readonly id: SnapshotId
  /** Per-file differences in stable path order. */
  readonly files: readonly SnapshotFileDiff[]
  /** True when the diff output hit the provider's configured cap and was cut. */
  readonly truncated: boolean
  /** Paths whose capture was unmanaged, in stable path order. */
  readonly unmanagedPaths: readonly string[]
}

/**
 * The outcome of a restore: what changed and what was honestly left alone.
 */
export interface SnapshotRestoreOutcome {
  /** The snapshot that was restored. */
  readonly id: SnapshotId
  /** Paths whose current content was rewritten from captured blobs. */
  readonly restored: readonly string[]
  /** Paths removed because they were absent in the snapshot. */
  readonly removed: readonly string[]
  /** Unmanaged paths the snapshot cannot restore, reported verbatim. */
  readonly unmanaged: readonly string[]
}
