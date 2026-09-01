# Agent Note: Supervisor executor bridge

Status: implemented

English | [中文](2026-08-31-supervisor-executor-subagent.zh.md)

## Problem

The Personal Supervisor dispatches work to heterogeneous model and CLI providers, each with its own lifecycle vocabulary. Without one normalization seam the controller would see raw provider behavior, and a child could start model or CLI work before the project writer gate covers it.

## Decision

The Personal Supervisor executor package (`@deepseek-ai/dsh-supervisor-executor-subagent`) owns provider registration, capability admission, and lifecycle normalization. A provider adapter must reserve a child Session identity before starting model or CLI work. The bridge acquires the project host lease before invoking the provider, attaches the exact child lifecycle, and releases the lease only after result settlement and disposal.

## Boundaries

This package does not reimplement Codex, Claude Code, DSH SDK, or ACP protocols. Those providers remain responsible for authentication and native process behavior and register adapters through `SupervisorExecutorProvider`. The bridge never grants a child more permission than the route and adapter capability ceiling allow.

## Testing

`packages/supervisor/supervisor-executor-subagent/tests/executor.spec.ts` covers completed, cancelled, timeout, max-token, provider error, refusal, unknown-reason, diagnostics, signal, and exit-code normalization, route-gate rejection before invocation, permission-ceiling rejection, lease retention through settlement, exact child cancellation, provider-preparation release when admission or startup fails, child-identity mismatch rejection, and executor disposal. The package tests exercise the seam with in-memory provider adapters.

## Alternatives considered

- **Reimplement Codex/Claude Code/ACP protocols inside the bridge.** Providers own authentication and native process behavior; the bridge normalizes lifecycle only, so duplicating the protocols would fork behavior the providers must keep owning.
- **Let providers attach their own child lifecycles without a lease.** The bridge requires lease-before-invoke and never releases before settlement, protecting the single-writer gate; unleased provider lifecycles would open a window where a second writer could enter a live project.

## Consequences

- The controller sees one normalized result vocabulary (status, output, diagnostic, timedOut, signal, exitCode), and permission ceilings are enforced in the operation that dispatches rather than trusted from the route alone.
- The package ships the registry and normalization seam; no concrete provider adapter is registered in the first release, and bundle-level provider integration remains downstream.
