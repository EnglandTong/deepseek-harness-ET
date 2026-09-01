# Agent Note: Personal Supervisor as an optional plugin capability

Status: implemented

English | [中文](2026-08-30-personal-supervisor-plugin.zh.md)

## Problem

A user who develops several projects through separate model conversations must reconstruct each conversation's goal, progress, blockers, evidence, and next action before coordinating more work. Extending one conversation indefinitely does not solve this problem: context compaction reduces model input but does not create an authoritative cross-project task record, route work into the correct workspace, or distinguish an executor's report from user acceptance.

## Decision

Personal Supervisor ships as an optional Cordis capability composed through a profile bundle. The capability owns one durable supervisor Session, explicit project enrollment, a revisioned cross-project task ledger, configurable model routing, project-bound execution hosts, bounded follow-up, compact state projections, critical notifications, Host API projection, and one main-assistant client view.

The supervisor Session has no project working directory and receives no production filesystem or shell tools. A hidden host Session binds each registered project's validated real path to existing subagent providers. One project admits at most one write-capable run; read-only reviewers may run concurrently. The central event log owns enrollment and dispatch facts, project governance files own goals and execution evidence, and child Sessions own complete model conversations.

Project-state reads reference the installed `cms-project-governance` skill for target, authority, and acceptance work and `agent-loop-engineering` for authorized project execution; their complete instructions load only when the current role requires them. Conversation compaction may summarize the supervisor transcript, while durable projections and source references reconstruct project state independently of that summary.

The first release runs only while the Harness host is running. Restart reconciliation resumes only work whose durable state proves that another execution will not duplicate an accepted or uncertain run. The public packages do not depend on experimental Agent Teams; they may reuse its revision, mailbox, and recovery patterns through stable services.

## Package roles

`supervisor/supervisor` declares the service and durable data. Session, project registry, project host, project-state, routing, executor, orchestration, memory, tool, Host API, client UI, and bundle packages implement independent roles so providers, presentation, and policy can evolve without changing the agent loop.

## Alternatives considered

**Keep all project context in one long supervisor prompt.** This makes token pressure the storage mechanism, loses typed state and evidence ownership, and cannot safely recover dispatch after restart.

**Use one supervisor per project and aggregate them later.** Multiple controllers create competing authority, duplicate user decisions, and require another synchronization layer to answer portfolio questions.

**Build on experimental Agent Teams directly.** That domain assumes one root Team and one shared checkout, while Personal Supervisor requires stable release packages, explicit multi-project roots, and user-facing Host/client projection.

**Run a separate HTTP service or background daemon.** A separate process duplicates Harness persistence, permissions, provider discovery, and lifecycle ownership. Offline execution also expands the first release's installation and security scope.

## Consequences

The design bought an authoritative cross-project record that survives compaction and restart: enabling the bundle creates or resumes exactly one supervisor Session, two registered projects run concurrently without crossing working directories, one project cannot admit two write-capable runs, and executor completion reaches review state only — independent acceptance remains a separate owner action.

The cost is that cross-project control expands lifecycle and recovery concurrency beyond ordinary parent-child delegation. The implementation serializes central writes, uses project-level write admission, fails on ambiguous recovery, and keeps complete project evidence outside rolling summaries.

The package set and client work are large enough to drift across independent contributors. Public event and API types therefore froze before parallel implementation, generated catalogs have one integration owner, and downstream work waits for dependency review.

External CLI providers retain their native authentication and model-selection behavior. Routing reports those limitations rather than claiming a model override that the provider cannot enforce.

## Testing

Focused Vitest suites under `packages/supervisor/*/tests/` pin the public contract, the singleton session, and the project registry; `packages/bundle/personal-supervisor/tests/personal-supervisor.spec.ts` pins the bundle manifest, its mounted rows, and the controller-only preset. The keyless assembled-product snapshot in `examples/headless-agent/tests/supervisor.snapshot.ts` boots `examples/headless-agent/supervisor.cordis.snapshot.yml` through the Loader across two process boots and pins creation, routing, approval, execution, review, notification intake, and restart ledger replay.

## Related

- [Optional Personal Supervisor bundle assembly](2026-08-31-personal-supervisor-bundle.md)
- [Freeze the Personal Supervisor public contract](2026-08-31-supervisor-public-contract.md)
- [Persist the singleton Supervisor Session](2026-08-31-supervisor-session.md)
- [Personal Supervisor orchestration loop](2026-08-31-supervisor-orchestrator.md)
- [Deterministic Personal Supervisor routing policy](2026-08-31-supervisor-routing-policy.md)
