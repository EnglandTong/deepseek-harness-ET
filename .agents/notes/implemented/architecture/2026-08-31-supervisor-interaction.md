# Agent Note: Supervisor interaction adapter

Status: implemented

English | [中文](2026-08-31-supervisor-interaction.zh.md)

## Problem

The main assistant needs human command entry into the Supervisor portfolio, `@总控` intake forwarded from other conversations, and critical notifications deduplicated before they reach the controller — without modifying the agent loop and without this package gaining project state or acceptance authority of its own.

## Decision

`@deepseek-ai/dsh-tool-supervisor` owns human command registration, singleton `@总控` intake delivery, and critical notification coalescing. It consumes the frozen Supervisor service and the orchestrator's public behavior; it does not add project state or modify the agent loop.

## Testing

`packages/supervisor/tool-supervisor/tests/interaction.spec.ts` covers command registration with a real status dispatch, revision arguments on dispatch, intake deduplication, cold-session delivery, notification coalescing, and invalid intake rejection.

## Alternatives considered

- **Emit one notification row per event.** Rejected: ordinary progress would create a notification storm; repeated events for the same project/task/kind are presented as one row with a count.
- **Write the unread/read cursor durably in this package.** Rejected for now: unread acknowledgement is intentionally process-local until a later durable notification projection owns the read cursor.

## Consequences

The thirteen command handlers use revision-safe orchestrator methods and return bounded human results. A stable intake message id is recorded before delivery; a live singleton Agent receives one relay message, while a cold singleton Session receives one durable `user/message` relay for later resume. Repeated notification events for the same project/task/kind are presented as one row with a count, so ordinary progress cannot create a notification storm.

Unread acknowledgement stays process-local: the durable Supervisor event remains unchanged until a later durable notification projection owns the read cursor. Review remains optional because this package cannot claim acceptance when the orchestrator has no review method.
