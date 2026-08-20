/**
 * Line-diff projection between captured snapshot content and current content,
 * on the `diff` package's unified hunks.
 * @module @deepseek-ai/dsh-snapshot-local/src/diff
 */

import { structuredPatch } from 'diff'
import type { SnapshotFileDiff, SnapshotHunk } from '@deepseek-ai/dsh-snapshot'

/** Context lines carried on each side of a hunk. */
const DIFF_CONTEXT = 3

/**
 * Compute the hunks between two texts. Pure; content basis is whatever the
 * caller captured (the fs backend's text).
 * @param before - the snapshot-side text.
 * @param after - the current-side text.
 * @returns hunks in file order; empty for identical texts.
 */
export function computeHunks(before: string, after: string): SnapshotHunk[] {
  const patch = structuredPatch('', '', before, after, undefined, undefined, { context: DIFF_CONTEXT })
  return patch.hunks.map(hunk => ({
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
    lines: hunk.lines.filter(line => !line.startsWith('\\')),
  }))
}

/**
 * Truncate a file-diff list to a line budget.
 * @param files - the computed per-file diffs, in stable path order.
 * @param maxLines - the inclusive line budget across every hunk.
 * @returns the kept files and whether the budget was exhausted.
 */
export function truncateDiff(files: readonly SnapshotFileDiff[], maxLines: number): { files: SnapshotFileDiff[]; truncated: boolean } {
  const kept: SnapshotFileDiff[] = []
  let budget = maxLines
  for (const file of files) {
    if (budget <= 0) return { files: kept, truncated: true }
    const lines = file.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0)
    if (lines <= budget) {
      kept.push(file)
      budget -= lines
      continue
    }
    // Keep a prefix of this file's hunks within the remaining budget.
    const hunks: SnapshotHunk[] = []
    for (const hunk of file.hunks) {
      if (hunk.lines.length > budget) break
      hunks.push(hunk)
      budget -= hunk.lines.length
    }
    kept.push({ ...file, hunks })
    return { files: kept, truncated: true }
  }
  return { files: kept, truncated: false }
}
