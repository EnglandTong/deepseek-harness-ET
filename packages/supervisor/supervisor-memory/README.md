# `@deepseek-ai/dsh-supervisor-memory`

English | [中文](README.zh.md)

This package keeps Personal Supervisor memory in four bounded layers: the raw Supervisor event log, the structured replay projection, provenance-bearing rolling summaries, and question-specific query briefs. The event log and the Supervisor projection remain authoritative; summaries only reduce prompt size and never become acceptance evidence.

`projectSupervisorMemory()` replays contiguous `SupervisorMemoryRecord` values through the WO-01 fold and attaches the latest read-only governance state from `supervisor-project-state`. `summarizeSupervisorMemory()` derives project facts directly from that projection, so an old summary is never summarized again. Every summary records task revisions, source sequence range, event/run/policy/governance references, and the authority fingerprint used to create it.

`reconcileSupervisorMemory()` validates a persisted checkpoint against the current event prefix and governance fingerprints. A matching checkpoint is reused, a longer log receives a tail replay, a changed authority fingerprint invalidates affected summaries, and an altered or truncated prefix forces a full replay. Uncertain or invalid checkpoints are rejected rather than silently trusted.

`SupervisorMemoryService` listens to versioned Supervisor events, replays the existing Supervisor session during initialization, and exposes the same projection and summary functions to orchestration and Host API layers. Its memory sequence is local to the Supervisor event stream because ordinary conversation events can occupy other Session sequence numbers.

`shouldCompactMemory()` only decides whether token pressure should invoke the existing `ctx.compaction` extension point. This package does not rewrite Session surface messages, call a model, write project files, or replace the durable Session log.

## Model Experience

### Supervisor memory brief

#### What the model sees

The main assistant can receive a bounded query brief containing current project state, task status, blockers, unique next steps, pending confirmations, unread notifications, and source references. It does not receive hidden reasoning or complete raw logs unless a caller explicitly requests evidence.

#### Token effect

Summaries are generated from structured projections and bounded by `maxSummaryChars`; briefs are bounded by summary and notification counts. Token pressure is evaluated against the configured context limit and reserved response budget.

#### KV Cache effect

Stable map insertion order, deterministic event digests, and fixed summary field order keep repeated briefs cache-friendly when the authoritative log and governance fingerprints have not changed.

## Known Limitations and Deferred Work

- **No persistence backend:** callers must persist `SupervisorMemoryCheckpoint` through the session or storage owner; this package validates and reconciles records but does not choose a storage domain.
- **No model summarizer:** summaries use deterministic structured facts. A later provider may replace presentation text while preserving source ranges and revision references.
- **No final acceptance authority:** execution reports, review results, and user acceptance remain separate Supervisor events and are never inferred from a summary.
- **No vector authority:** semantic retrieval may be added as an accelerator, but it cannot replace event replay or governance fingerprint checks.
