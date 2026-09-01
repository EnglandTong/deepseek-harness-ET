# Agent Note: Personal Supervisor Host API and client runtime

Status: implemented

English | [中文](2026-08-31-supervisor-host-api-client-runtime.zh.md)

## Problem

The Personal Supervisor needed one projection path from Host facts to a browser dashboard: read access to project, task, run, and notification snapshots plus a control path for owner actions — without a second transport, without the client becoming a task-state authority, and without child transcript content flowing through the Supervisor surface.

## Decision

The Personal Supervisor is projected through the existing ApiProxy four-quadrant RPC carrier. The `supervisor.*` domain is optional and is mounted by supplying a host-owned read/control port to `createApiProxy`; the API gateway does not own orchestration state or child Session lifecycles.

Responses carry `version: 1`. Read endpoints expose the singleton identity, project/task/run snapshots, critical notifications, and a read-only child-session reference. User actions carry `expectedRevision`; the host returns `supervisor-conflict` when a stale task revision reaches the control port. A client child reference is explicitly `readOnly: true`; transcript reads and writes remain owned by the existing Session APIs.

The browser runtime exposes `SupervisorRuntime` and one observable `SupervisorClientState`. It refreshes bounded snapshots, retains transport/business errors for presentation, and sends actions only through the typed API client. It does not fold task state from titles or copy conversation history into a model request.

## Testing

`packages/host/apiproxy/tests/api-proxy-supervisor.spec.ts` covers versioned request/response parsing, the unavailable optional composition, project/task/run/notification filters, read-only child references, and stale revision rejection. `packages/client/runtime/tests/supervisor.client.spec.ts` covers refresh replacement, retained error state, refresh after an action, and the read-only child reference.

## Alternatives considered

- **A second HTTP endpoint** was rejected because the existing carrier already provides envelope correlation, boundary schemas, cancellation, and client projection rules.
- **A client-side task state machine** was rejected because task revisions and lifecycle authority belong to the Host Supervisor composition.
- **Returning child transcript content from the Supervisor endpoint** was rejected because it would duplicate Session history and weaken the existing read-only subagent boundary.

## Consequences

- Supervisor traffic rides the carrier the client already uses, and owner conflicts surface as explicit `supervisor-conflict` errors instead of silent divergence between client and Host views.
- The browser runtime stays a thin revisioned cache: it holds only the latest received snapshots and refreshes after each action, so no task reasoning happens client-side and an unavailable Supervisor presents an error rather than stale or invented state.
