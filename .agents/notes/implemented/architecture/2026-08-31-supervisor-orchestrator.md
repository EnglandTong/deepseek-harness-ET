# Agent Note: Personal Supervisor orchestration loop

Status: implemented

English | [中文](2026-08-31-supervisor-orchestrator.zh.md)

## Problem

The controller needs a bounded task loop that cannot auto-accept work and cannot loop forever on repeated failures. Owner decisions, stale revisions, and repair attempts need one owner that keeps prompts and child output out of its structured state.

## Decision

`@deepseek-ai/dsh-supervisor-orchestrator` owns the controller's bounded task loop. It captures requests, resolves a registered route, groups owner approvals, and dispatches through the executor bridge. Task snapshots are emitted as versioned Supervisor events and every owner action checks the task revision it observed.

Completed execution enters `ReadyForReview`; the service never promotes an execution result to `Accepted` — `Accepted` is published only by the owner's explicit `review()` decision. Failed executions are classified with a deterministic signature and receive at most the configured number of new repair attempts. A repeated signature emits a blocked notification and stops automatic repair. Disposal cancels exact active handles and clears process-local control state.

Startup replays the restored controller ledger into task state and reconciles tasks that cannot resume execution to the owner as `NeedsOwnerDecision`.

## Testing

`packages/supervisor/supervisor-orchestrator/tests/orchestrator.spec.ts` covers capture, approval batches, stale-revision rejection, single repair with a repeated-signature stop, and revision-guarded follow-ups.

## Alternatives considered

- **Emit `Accepted` directly from executor completion.** Executor reports may only reach `ReadyForReview`; acceptance is a separate owner action through `review()`.
- **Retry repairs indefinitely on failure.** Repeated failure signatures must block automatic repair and notify the owner instead of spending further attempts.

## Consequences

- The loop is bounded on both edges: only policy-approved low-risk routes can auto-dispatch, and repeated failures notify the owner instead of consuming unlimited attempts.
- Approval batches are process-local and rebuilt from the restored ledger at startup; failure signatures are not durable, so the attempts bound caps automatic repair after restart. A durable approval projection and child review pipelines remain future work.
- Host API exposure and bundle composition shipped downstream in `@deepseek-ai/dsh-supervisor-api` and the `@deepseek-ai/dsh-personal-supervisor` bundle; prompts and child output stay out of the controller's published task snapshots.
