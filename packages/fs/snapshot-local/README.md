# @deepseek-ai/dsh-snapshot-local

English | [中文](README.zh.md)

Local workspace-snapshot provider for `ctx.snapshots` ([dsh-snapshot](../snapshot/) is the Service Definition). One plugin instance per context; snapshots are keyed by session under `dshHomePath('snapshots')/<sessionId>/`.

## How it works

**Broadcast capture.** The provider registers `prepend: true` listeners on the `fs/write-intent` and `fs/edit-intent` waterfalls. On a target's first mutation after a snapshot's creation, the pre-change content is read *before* `next()` delegates and recorded into **every** live snapshot that does not yet track the target — the pre-image equals each such snapshot's state at its creation, so no inheritance step exists and no head pointer needs crash recovery. Listeners always call `next()`; capture annotates, it never decides, and any capture failure degrades to an honest `unmanaged` entry instead of vetoing the mutation.

Files never mutated cost nothing. Files over `maxFileBytes` record `unmanaged: too-large`; unreadable ones record `unmanaged: capture-failed`; both surface verbatim in `restore` and `diff`.

**Storage.** Content-addressed blobs (`sha256`, deduplicated across snapshots) plus one JSON manifest per snapshot. Manifest writes go through temp-file + rename and a per-session FIFO queue, so parallel tool calls cannot interleave a read-modify-write cycle and a crash never leaves a half-written manifest.

**Restore.** Rewrites differing files through the standard fs write path — it primes `fs/observed` from its own reads, dispatches the `fs/write-intent` waterfall with a synthetic `{ agent }` actor, and passes the per-call sandbox policy — so capture, the observation policy, and sandbox fencing participate exactly as they do for tool writes. Files the snapshot predates are removed natively, confined to the sandbox workspace root when a policy service is composed (the fs seam has no delete). A destructive restore requires the approval service unless the caller marks an atomic `rollback` (a snapshot captured within the same tool call); without any approval service, destructive restores fail loud.

## Config

| Field | Default | Description |
|---|---|---|
| `rootDir` | `dshHomePath('snapshots')` | Snapshots root |
| `retention` | `20` | Snapshots kept per session; oldest dropped on create |
| `maxFileBytes` | `4194304` | Per-file capture cap; larger files record as unmanaged |
| `diffMaxLines` | `2000` | Line budget across one diff result before truncation |

## Known boundaries

- **The lazy model tracks only mutated paths.** A file created after a snapshot and never mutated again is invisible to `diff` and to restore's rewrite set; creation-time tree enumeration is out of scope. The atomic multi-file edit (`@deepseek-ai/dsh-tool-multiedit`) is unaffected: its own writes fire the intents that capture the pre-images.
- **Orphan blobs persist per session.** Deleting an old manifest under retention keeps its blobs; they are reclaimed only when the session's snapshot directory itself is removed. Session-end cleanup is a deployment concern (dshHome data management), not a provider behavior.
- **One provider per filesystem.** The synthetic `{ agent }` actor and the session-keyed storage assume one fs backend per context; cross-agent workspace merging is explicitly out of scope.
