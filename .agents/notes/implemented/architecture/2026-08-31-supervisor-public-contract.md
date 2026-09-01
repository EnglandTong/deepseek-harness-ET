# Agent Note: Freeze the Personal Supervisor public contract

Status: implemented

English | [中文](2026-08-31-supervisor-public-contract.zh.md)

## Problem

Downstream Session, registry, routing, orchestration, and client packages need one stable vocabulary for Supervisor identity, project/task/run snapshots, notifications, events, and task transitions. If each package invents its own fields, replay and revision checks cannot provide one authoritative portfolio state.

## Decision

`@deepseek-ai/dsh-supervisor` publishes the contract-only seam. Branded identifiers (`SupervisorId`, `SupervisorProjectId`, `SupervisorTaskId`, `SupervisorRunId`, `SupervisorNotificationId`) prevent accidental cross-domain ids; versioned event payloads (`SUPERVISOR_EVENT_VERSION`) are validated before replay; `foldSupervisor` applies contiguous revisions and the frozen task transition table (`assertTaskTransition`); `SupervisorService` exposes typed provider registries whose registrations return disposers, keeps the central project/task projection, and restores the durable ledger through `restoreLedger`. No provider performs filesystem, model, or agent work in this package.

## Alternatives considered

- Reusing experimental Agent Teams types was rejected because their task lifecycle and shared-checkout assumptions differ from cross-project supervision.
- Keeping status as untyped strings was rejected because illegal transitions and revision gaps would become runtime guesswork.
- Making the Supervisor service own persistence was rejected because WO-02 and WO-09 own lifecycle and projection storage.

## Consequences

Downstream packages share one vocabulary, so replay and revision checks give every consumer the same authoritative portfolio state. The cost is that changing these fields now requires coordinated migration across every downstream package; the event version and revision rules therefore stay explicit. Replay also cannot resume execution, so the transition table hands every interrupted task to the owner as `NeedsOwnerDecision` during restart reconciliation.

## Testing

`packages/supervisor/supervisor/tests/supervisor.spec.ts` pins every documented task edge (skipped and terminal edges fail), deterministic replay with revision-gap rejection, event-version and revision validation at the durable boundary, duplicate identity-event rejection, and duplicate/empty provider-name rejection with disposers that remove only the registration they created.
