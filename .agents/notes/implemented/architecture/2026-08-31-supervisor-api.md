# Agent Note: Supervisor Host API projection

Status: implemented

English | [中文](2026-08-31-supervisor-api.zh.md)

## Problem

Client surfaces need read and control access to the Supervisor's project, task, run, and notification facts without a second transport beside the existing API carrier, and without exposing hidden reasoning, credentials, raw stderr, or project-file mutation. Dispatch and approval authority must stay with the orchestrator and interaction services.

## Decision

`@deepseek-ai/dsh-supervisor-api` provides the Host-facing projection service (`ctx.supervisorApi`) over Supervisor-owned project, task, run, and notification facts. `packages/host/apiproxy` projects it to clients as the optional `supervisor.*` domain on the existing ApiProxy four-quadrant RPC carrier: mounting happens by supplying a host-owned read/control port (`SupervisorApiProvider`) to `createApiProxy`, and when the Personal Supervisor bundle is absent every supervisor method fails closed with `supervisor-unavailable`. The API gateway owns no orchestration state or child Session lifecycle.

Responses are versioned with `version: 1`. Read endpoints expose the singleton identity and project/task/run/notification snapshots with status, project, task, and unread filters. Owner review is guarded by optimistic revision checks: every action carries `expectedRevision`, and a stale task revision that reaches the control port returns `supervisor-conflict` with the expected and actual revisions. A client child reference is explicitly `readOnly: true`; transcript reads and writes remain owned by the existing Session APIs. The projection does not expose hidden reasoning, credentials, raw stderr, or project-file mutation.

For cross-plugin executor adapters (CDH Phase A), the package also **re-exports the executor seam types** (`SupervisorExecutorProvider`, request/prepare/result types) from `@deepseek-ai/dsh-supervisor-executor-subagent` via `export type` on the package root and the `@deepseek-ai/dsh-supervisor-api/executor` subpath. Foreign packages implement the seam with a types-only import and must not reverse-depend on this plugin's runtime registry; this package adds no runtime executor symbols.

## Testing

`packages/host/apiproxy/tests/api-proxy-supervisor.spec.ts` covers versioned request/response parsing (unversioned and malformed values are rejected at the client boundary), the fails-closed absent-bundle composition, project/task/run/notification filters, read-only child references, and stale-revision `supervisor-conflict` preservation from the control port.

`packages/supervisor/supervisor-api/tests/executor-export.spec.ts` pins that a structural `SupervisorExecutorProvider` is assignable through the types-only export.

## Alternatives considered

The transport and state-authority alternatives below are the same decision domain as [Personal Supervisor Host API and client runtime](2026-08-31-supervisor-host-api-client-runtime.md), which records them for the pair.

- **A second HTTP endpoint.** Rejected: the existing carrier already provides envelope correlation, boundary schemas, cancellation, and client projection rules.
- **A client-side task state machine.** Rejected: task revisions and lifecycle authority belong to the Host Supervisor composition.
- **Returning child transcript content from the Supervisor endpoint.** Rejected: it would duplicate Session history and weaken the existing read-only subagent boundary.
- **Emit one notification row per event.** Rejected: ordinary progress would create a notification storm; repeated events for the same project/task/kind are coalesced into one row with a count.

## Consequences

- A client dashboard gets one typed, versioned read/control face on the carrier it already speaks, and owner actions are compare-and-set against the task revision, so a stale client cannot act on a changed task.
- The domain is a projection only: transcript content and dispatch/approval stay behind the Session APIs and the orchestrator/interaction services, and an unmounted Supervisor reports `supervisor-unavailable` instead of degrading into partial or fabricated data.
