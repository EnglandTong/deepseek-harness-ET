/**
 * Per-session snapshot storage: JSON manifests plus content-addressed blobs
 * under `<rootDir>/<sessionId>/`. A manifest maps opaque fs target keys to
 * capture entries; blobs are keyed by content sha256 so unchanged files cost
 * nothing across snapshots. Manifest writes go through temp-file + rename so a
 * crash never leaves a half-written manifest, and every mutation funnels
 * through a per-store FIFO queue so parallel tool calls cannot interleave a
 * read-modify-write cycle.
 * @module @deepseek-ai/dsh-snapshot-local/src/store
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SnapshotId } from '@deepseek-ai/dsh-snapshot'
import type { SnapshotEntry, SnapshotInfo } from '@deepseek-ai/dsh-snapshot'

/** One manifest row: the model-facing path plus the capture entry keyed by target key. */
export interface StoredEntry {
  readonly displayPath: string
  readonly entry: SnapshotEntry
}

/** Durable manifest shape; `entries` is keyed by the fs backend's opaque target key. */
export interface StoredManifest {
  readonly id: string
  readonly createdAt: number
  readonly reason: string
  readonly entries: Readonly<Record<string, StoredEntry>>
}

/**
 * Serialize one store mutation behind the FIFO queue.
 * @param queue - the store's serialization chain; extended with the new operation.
 * @param operation - the mutation to run exclusively.
 * @returns the mutation's result.
 */
function enqueue<T>(queue: Promise<unknown>, operation: () => Promise<T>): Promise<T> {
  const run = queue.then(operation, operation)
  return run
}

/**
 * Content-addressed blob + manifest store for one session's snapshots.
 */
export class SnapshotStore {
  private readonly dir: string
  private queue: Promise<unknown> = Promise.resolve()
  /** Manifest cache keyed by id; loaded lazily and invalidated on removal. */
  private readonly manifests = new Map<string, StoredManifest>()

  /**
   * @param rootDir - snapshots root (`dshHomePath('snapshots')` by default).
   * @param sessionId - the session's id; storage is namespaced under it.
   */
  constructor(rootDir: string, sessionId: string) {
    this.dir = join(rootDir, sessionId)
  }

  private manifestPath(id: string): string {
    return join(this.dir, id, 'manifest.json')
  }

  private blobPath(hash: string): string {
    return join(this.dir, 'blobs', hash)
  }

  /** Ensure the session directory exists. */
  async init(): Promise<void> {
    await mkdir(join(this.dir, 'blobs'), { recursive: true })
  }

  /**
   * Derive the next snapshot id from what is already on disk, so numbering
   * survives process restarts.
   * @returns the next id in the provider's `s<n>` sequence.
   */
  async nextId(): Promise<string> {
    return this.exclusive(async () => {
      let max = 0
      for (const name of await readdir(this.dir, { withFileTypes: true })) {
        const match = /^s(\d+)$/.exec(name.name)
        if (name.isDirectory() && match !== null) max = Math.max(max, Number(match[1]))
      }
      return `s${max + 1}`
    })
  }

  /**
   * Extend one manifest with a captured entry when the target key is not yet
   * recorded — the broadcast-capture primitive. Serialized behind the FIFO
   * queue with an in-queue re-read so parallel first-modifications of
   * different files cannot interleave read-modify-write cycles.
   * @param id - the snapshot whose manifest is extended.
   * @param key - the opaque fs target key.
   * @param row - the display path plus capture entry to record.
   * @returns true when the entry was added; false when it already existed or
   *   the manifest is gone.
   */
  async extendEntry(id: string, key: string, row: StoredEntry): Promise<boolean> {
    return this.exclusive(async () => {
      const manifest = await this.readManifest(id)
      if (manifest === undefined || key in manifest.entries) return false
      await this.writeManifestLocked({ ...manifest, entries: { ...manifest.entries, [key]: row } })
      return true
    })
  }

  /**
   * Persist one manifest atomically and cache it.
   * @param manifest - the complete manifest to write.
   */
  async writeManifest(manifest: StoredManifest): Promise<void> {
    await this.exclusive(() => this.writeManifestLocked(manifest))
  }

  /**
   * Manifest write without queue serialization — callers already hold the
   * FIFO queue (or accept the interleaving risk on a fresh id).
   * @param manifest - the complete manifest to write.
   */
  private async writeManifestLocked(manifest: StoredManifest): Promise<void> {
    await mkdir(join(this.dir, manifest.id), { recursive: true })
    const target = this.manifestPath(manifest.id)
    const temp = `${target}.tmp-${process.pid}-${Date.now()}`
    await writeFile(temp, JSON.stringify(manifest), 'utf8')
    await rename(temp, target)
    this.manifests.set(manifest.id, manifest)
  }

  /**
   * Load one manifest, preferring the in-memory cache.
   * @param id - the snapshot id.
   * @returns the manifest, or undefined when no such snapshot exists.
   */
  async readManifest(id: string): Promise<StoredManifest | undefined> {
    const cached = this.manifests.get(id)
    if (cached !== undefined) return cached
    try {
      const raw = await readFile(this.manifestPath(id), 'utf8')
      const manifest = JSON.parse(raw) as StoredManifest
      this.manifests.set(id, manifest)
      return manifest
    } catch {
      return undefined
    }
  }

  /**
   * Cached manifest lookup without disk access; `undefined` means unknown (a
   * not-yet-loaded manifest), not absent. Capture's quick check only.
   * @param id - the snapshot id.
   * @returns the cached manifest, or undefined when not yet loaded.
   */
  manifestOf(id: string): StoredManifest | undefined {
    return this.manifests.get(id)
  }

  /**
   * List snapshot infos in creation (id) order.
   * @returns metadata for every manifest currently on disk.
   */
  async listInfos(): Promise<SnapshotInfo[]> {
    const infos: SnapshotInfo[] = []
    for (const name of await readdir(this.dir, { withFileTypes: true })) {
      const match = /^s(\d+)$/.exec(name.name)
      if (!name.isDirectory() || match === null) continue
      const manifest = await this.readManifest(name.name)
      if (manifest === undefined) continue
      infos.push(toInfo(manifest))
    }
    infos.sort((a, b) => idNumber(a.id) - idNumber(b.id))
    return infos
  }

  /**
   * Write one content blob (deduplicated by sha256) and return its hash.
   * @param content - the captured file content.
   * @returns the hex sha256 of the content, usable as the blob reference.
   */
  async writeBlob(content: string): Promise<string> {
    const hash = createHash('sha256').update(content, 'utf8').digest('hex')
    await this.exclusive(async () => {
      try {
        await writeFile(this.blobPath(hash), content, { encoding: 'utf8', flag: 'wx' })
      } catch (error) {
        // EEXIST means the deduplicated blob is already durable.
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    })
    return hash
  }

  /**
   * Read one content blob.
   * @param hash - the blob reference from a manifest entry.
   * @returns the captured content.
   */
  async readBlob(hash: string): Promise<string> {
    return readFile(this.blobPath(hash), 'utf8')
  }

  /**
   * Delete one snapshot's manifest directory. Blobs stay: they are shared
   * content-addressed storage; orphans persist until the session directory
   * itself is removed.
   * @param id - the snapshot to drop.
   */
  async remove(id: string): Promise<void> {
    await this.exclusive(async () => {
      await rm(join(this.dir, id), { recursive: true, force: true })
      this.manifests.delete(id)
    })
  }

  /**
   * Enforce the retention cap: drop the oldest snapshots beyond `retention`.
   * @param retention - the maximum number of snapshots to keep.
   */
  async enforceRetention(retention: number): Promise<void> {
    const infos = await this.listInfos()
    for (const info of infos.slice(0, Math.max(0, infos.length - retention))) {
      await this.remove(info.id)
    }
  }

  /**
   * Run one mutation behind the store's FIFO queue.
   * @param operation - the exclusive mutation.
   * @returns the mutation's result.
   */
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = enqueue(this.queue, operation)
    this.queue = run.catch(() => undefined)
    return run
  }
}

/**
 * Parse the numeric part of a provider id (`s<n>`); unknown shapes sort last.
 * @param id - the opaque snapshot id string.
 * @returns the sequence number for ordering.
 */
function idNumber(id: string): number {
  const match = /^s(\d+)$/.exec(id)
  return match === null ? Number.MAX_SAFE_INTEGER : Number(match[1])
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
