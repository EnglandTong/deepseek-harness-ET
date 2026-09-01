# Agent Note: Supervisor memory uses event replay plus bounded provenance summaries

Status: implemented

English | [中文](2026-08-31-supervisor-memory.zh.md)

## Problem

Supervisor state must survive compaction and restart without recursive summaries: a summary that becomes the input to the next summary loses its invalidation path, and unbounded context growth cannot be the storage mechanism.

## Decision

`@deepseek-ai/dsh-supervisor-memory` keeps raw Supervisor events as the reconstruction source, folds them into structured project and task state, and derives bounded summaries and query briefs from that projection. A summary never becomes an authority source and is never used as the input to a later summary.

## Mechanism

Each raw record has a contiguous sequence number. A checkpoint stores the sequence watermark, a SHA-256 digest of the exact records it covers, summaries with source ranges and evidence references, and the governance authority fingerprint for each project. Startup reconciliation reuses an unchanged checkpoint, replays only an appended tail, invalidates summaries whose governance fingerprint changed, or performs a full replay when the saved prefix no longer matches.

`shouldCompactMemory()` reports token pressure for the existing compaction capability. The package does not mutate Session surface history, write project files, call a model, or infer acceptance from execution output.

## Testing

`packages/supervisor/supervisor-memory/tests/memory.spec.ts` covers deterministic replay, contiguous sequence rejection, summary bounds and provenance, token-pressure thresholds, digest mismatch, authority fingerprint invalidation, tail replay, and full restart replay.

## Alternatives considered

- Vector retrieval was rejected as authority because it cannot prove revision continuity or detect changed governance files.
- Recursive summary compression was rejected because stale decisions and source provenance would become difficult to invalidate.
- A second durable event format was rejected because the shared `supervisor/*` event vocabulary already provides the replay vocabulary; the package stores only memory checkpoint metadata.

## Consequences

- Reconstruction always starts from raw events, so summaries can be invalidated and rebuilt when governance changes; bounded summary and brief sizes keep the main-assistant view affordable, and token pressure is reported separately from compaction execution.
- The first release keeps the raw log in-process: no durable storage-domain adapter persists checkpoints yet, and no main-assistant prompt wiring consumes the briefs — the `@deepseek-ai/dsh-personal-supervisor` bundle loads the service, whose only external consumer today is `@deepseek-ai/dsh-supervisor-api`'s folded run-link read. Checkpoint persistence and prompt wiring remain owned by later composition and orchestration work orders.
