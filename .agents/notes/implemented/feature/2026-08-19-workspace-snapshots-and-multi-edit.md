# Agent Note: Workspace snapshots and the atomic multi-file edit

Status: implemented

English | [中文](2026-08-19-workspace-snapshots-and-multi-edit.zh.md)

## Problem

The harness had no workspace rollback story. Every edit tool is single-file, none is atomic across files, and a model that half-applies a five-file refactor before failing leaves the workspace in a state its own session log describes but nothing can undo — the user's recovery path was `git checkout` or manual repair. The gap is the one Cursor Checkpoints and Trae snapshots fill in comparable products: a cheap, session-scoped point-in-time the agent can return to. Two prior names were already taken: `dsh-session-checkpoint-policy` owns "checkpoint" for log durability, and "snapshot" in the fs seam reads as an instantaneous tree copy — neither matched a lazily-captured, restore-through-the-write-path capability.

## Decision

Ship a `ctx.snapshots` capability seam plus one local provider and two tool consumers, all as ordinary plugins over existing fs machinery — no new transaction layer, no fs Service Definition changes.

- **Capture rides the `fs/write-intent`/`fs/edit-intent` waterfalls.** The provider registers `prepend: true` listeners; on a target's first mutation after a snapshot's creation, the pre-change content is read before `next()` and recorded into **every** live snapshot that does not yet track the target. The pre-image equals each such snapshot's creation-time state, so there is no inheritance step and no head pointer to recover after a crash. Listeners always call `next()`; capture failure degrades to an honest `unmanaged` entry instead of vetoing the mutation.
- **Storage is content-addressed** (sha256 blobs deduplicated across snapshots, one JSON manifest per snapshot under `dshHomePath('snapshots')/<sessionId>/`), with temp-file + rename manifest writes queued per session so parallel tool calls cannot interleave a read-modify-write cycle.
- **Restore re-enters the fs write path** — it primes `fs/observed` from its own reads, dispatches the `fs/write-intent` waterfall under a synthetic `{ agent }` actor, and passes the per-call sandbox policy — so capture, observation policy, and sandbox fencing participate exactly as for tool writes. Destructive restores require the approval service; `rollback: true` (the atomic self-rollback marker reserved for non-model callers) skips it.
- **`multi_edit` is atomic because the snapshot is the rollback mechanism**: the tool captures its own rollback-point snapshot before applying, and on any failure restores it with `rollback: true` and fails loud, naming the failing file and the completed rollback. `snapshot/create` and `snapshot/restore` are required-on-read session events, so the model can reconstruct "the workspace returned to snapshot N" from the log alone.
- **Presentation**: restore/diff/multi_edit results render as multi-file diff cards whose payload rides `presentationMeta` replayed from the canonical value (the tool-fs pattern); create/list render generic cards.

## Alternatives considered

- **Whole-tree copy at creation time** — eagerly hardlink/copy the workspace per snapshot. Rejected: cost scales with tree size, not with mutation count, so the "snapshot before every risky change" behavior the system prompt steers toward becomes expensive; the lazy waterfall capture charges only files that actually change.
- **An explicit transaction layer for multi_edit** — stage writes, journal, commit/rollback inside the tool. Rejected: it would duplicate what the snapshot seam already provides and add a second durability story to maintain; the failure case is identical (restore pre-state), so the snapshot is the transaction.
- **Capture by polling or fs watchers** — rejected: watchers are platform-flaky, polling is either lossy or busy, and the intent waterfalls already fire exactly at the mutation boundary with the actor attached.
- **Per-snapshot inheritance chain** (child snapshots referencing a parent plus deltas, with a movable head). Rejected: crash recovery of the head pointer and the copy-on-adopt semantics add failure modes the broadcast model avoids outright — each live snapshot holds its own full entry set, and deduplication happens at blob storage anyway.
- **Naming it "checkpoint"** — rejected: collides with `dsh-session-checkpoint-policy`'s log-durability meaning; "workspace snapshot" names the user-facing capability the products being matched expose.

## Consequences

- The lazy model tracks only mutated paths: a file created after a snapshot and never mutated again is invisible to `diff` and to restore's rewrite set. Creation-time tree enumeration is out of scope, and the system prompt says so honestly — restoring cannot recover files that predate the snapshot but were never modified.
- Deleted manifests leave orphan blobs until the session's snapshot directory itself is removed; retention is a per-session count, not a byte budget. Session-end cleanup is deployment concern, recorded as a provider Known Limitation.
- One provider per filesystem: the synthetic actor and session-keyed storage assume one fs backend per context; cross-agent workspace merging is explicitly out of scope.
- `snapshot_restore` recomputes the diff inside `execute` so the approval preview and the diff card share one source; the double read is the cost of presentation being a pure function of the logged value.
- Windows and POSIX run the same capture path — the waterfalls are platform-neutral — so the suites are not win32-excluded, unlike the PTY families.
