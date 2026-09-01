# Agent Note: Persist the singleton Supervisor Session

Status: implemented

English | [中文](2026-08-31-supervisor-session.zh.md)

## Problem

The Personal Supervisor needs one controller Session that survives a Harness restart. A process-local id or a settings write before the Session log is durable can create a second controller or hide a valid first-boot log after a crash.

## Decision

`@deepseek-ai/dsh-supervisor-session` registers one `supervisor-session` settings namespace and uses the existing `SessionStore` and `SessionPersistence` seams. First boot reserves `supervisor-main`, appends the versioned identity event, waits for `ctx.sessions.flush()`, and only then persists the settings id. Resume lists the configured backend, prepares the exact Session, validates one matching identity event, and re-emits that event for the Supervisor projection. Disposal closes admission, flushes, and detaches in that order.

## Alternatives considered

- Keeping the id only in memory was rejected because restart would not identify the controller.
- Writing settings before the identity flush was rejected because a crash could leave a configured id with no durable identity.
- Scanning and importing every persisted Session was rejected because an explicit settings id is the authority and broad history reads are unnecessary.
- Creating a private file beside JSONL/SQLite was rejected because it would duplicate persistence semantics and break backend parity.

## Consequences

A restart can always choose between a valid log and first boot: a settings write failure never hides a valid first-boot log, and a configured id with no durable identity fails loud as `SUPERVISOR_SESSION_INVALID_STATE` instead of creating a second controller. The cost is that the two-resource first-boot sequence cannot atomically commit a Session log and settings document; the stable id and deterministic recovery rule make the only crash window recoverable, and a future multi-process coordinator may tighten this further.

## Testing

`packages/supervisor/supervisor-session/tests/session.spec.ts` pins first-boot flush-before-settings, restore from the configured persistence backend, and every `SUPERVISOR_SESSION_INVALID_STATE` rejection (missing configured Session, duplicate live id, duplicate or malformed identity event) plus flush-before-detach disposal. `jsonl-persistence.spec.ts` pins JSONL durability across restart and the same singleton on SQLite. The restart leg of `examples/headless-agent/tests/supervisor.snapshot.ts` pins controller-ledger replay across two process boots in the assembled product.
