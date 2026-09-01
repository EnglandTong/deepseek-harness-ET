# Agent Note: Supervisor dashboard client model

Status: implemented

English | [中文](2026-08-31-supervisor-ui.zh.md)

## Problem

The client needs one dashboard model over the Host API projection whose state never overrides Host authority, and child sessions must be represented only by read-only references — no client-side task inference and no second state authority beside the Host.

## Decision

The client model consumes the Host API projection and groups task cards for one main-assistant dashboard. Child Sessions are represented only by read-only ids; owner review calls carry the displayed task revision. Client state never overrides Host authority.

`packages/client/ui-supervisor` realizes this model: it consumes the runtime's `SupervisorClient` (the observable `SupervisorClientState` over bounded snapshots) and mounts the React `SupervisorDashboard` into the web client's `sidebar.footer.action` slot. Approve, reject, rework, pause, and continue controls send compare-and-set actions with the rendered task revision; a stale revision is reported and does not overwrite the card, and an unavailable Host is shown as an error rather than replaced with fabricated data.

## Testing

`packages/client/ui-supervisor/tests/dashboard.client.spec.tsx` covers the single dashboard render of projects, task state, and notifications, compare-and-set actions carrying the rendered revision, read-only child-session expansion, and the Host-error state without fabricated project state.

## Alternatives considered

- **Bind task state in the client from child titles or conversation content.** Rejected: client state never overrides Host authority, and child sessions are represented only by read-only ids.

## Consequences

- The dashboard renders only what the Host projected: bounded snapshots keep token and KV-cache effects at none, and every action the client sends is CAS-guarded by the displayed revision.
- The model is framework-free, but binding it to a view is per-surface work: the shipped mount is the React dashboard in the DeepSeek web client's sidebar footer, and another client surface would supply its own binding of the same model.
