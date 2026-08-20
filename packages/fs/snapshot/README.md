# @deepseek-ai/dsh-snapshot

English | [中文](README.zh.md)

Abstract workspace-snapshot capability seam (`ctx.snapshots`): the vocabulary types (opaque `SnapshotId`, manifest metadata with an honest `partial`/capture boundary, line-diff projection, restore outcome), the `SnapshotService` (create / list / restore / diff), and the two session events (`snapshot/create`, `snapshot/restore`) that keep snapshot facts replayable from the session log alone.

The name is deliberately "snapshot", not "checkpoint": [dsh-session-checkpoint-policy](../session/session-checkpoint-policy/) already owns "checkpoint" for session-log persistence checkpoints.

## Capability seam

| Role | Package |
|---|---|
| Service Definition | `@deepseek-ai/dsh-snapshot` (this package) |
| Provider | `@deepseek-ai/dsh-snapshot-local` — lazy capture through fs write/edit-intent waterfalls, content-addressed blob storage, restore through the fs write path |
| Consumer | `@deepseek-ai/dsh-tool-snapshot` (`snapshot_create` / `snapshot_list` / `snapshot_restore` / `snapshot_diff`), `@deepseek-ai/dsh-tool-multiedit` (atomic multi-file edit with automatic snapshot rollback) |

## Service contract

`SnapshotService` is abstract; one instance serves one session scope. Methods take the calling `Agent` — storage is keyed by the agent's session, restore re-enters the fs write path under that agent's sandbox policy, and the session events land on the agent's own log.

- `create(agent, { reason, signal })` — snapshot the workspace state; returns metadata. Content capture is lazy and owned by the provider.
- `list(agent)` — the session's snapshots, oldest first.
- `restore(agent, id, { rollback, signal })` — rewrite files whose captured content differs, remove files the snapshot predates, and report unmanaged paths verbatim. Destructive by default: providers gate it on approval unless `rollback` marks an atomic self-rollback (a snapshot captured within the same tool call).
- `diff(agent, id, { signal })` — per-file line differences between a snapshot and now, plus the unmanaged-path boundary.

## Capture states

A manifest entry is exactly one of:

- `captured` — the pre-change content is a content-addressed blob; restorable.
- `unmanaged` — not captured (write raced ahead, file exceeded the configured cap, or the blob write failed). Reported honestly by `restore` and `diff`; never silently dropped.
- `absent` — the path did not exist when the intent fired; restoring removes the file created since.

## Session events

| Event | Payload | Semantics |
|---|---|---|
| `snapshot/create` | `{ id, reason, partial }` | log-only, whole-value; replay folds the set of known snapshot ids |
| `snapshot/restore` | `{ id, restored, removed }` | log-only, whole-value; the model reconstructs "workspace returned to snapshot N" from the log |

Both are required-on-read members of `SessionEventMap`; the [invariant companion](src/invariant.ts) validates their payloads on replay and dispatch (`@deepseek-ai/dsh-snapshot/invariant`).
