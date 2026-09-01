# Agent Note: Project-bound Supervisor execution hosts

Status: implemented

English | [中文](2026-08-31-supervisor-project-host.zh.md)

## Problem

A child Session cannot safely operate a foreign project from the controller: the controller's context has no project cwd, so a directly forked child would inherit the wrong workspace or require prompt-level cwd discipline with no durable admission control. Project execution needs a project-bound hidden host whose per-project admission survives restart.

## Decision

`@deepseek-ai/dsh-supervisor-project-host` owns hidden, durable project Sessions and admission leases. It obtains an exact registered project snapshot from `ctx.supervisor`, creates or restores a Session whose header `cwd` equals that project's canonical `realPath` under the stable hidden identity `supervisor-project-host:<projectId>`, and emits a versioned `supervisor/run-linked` record only after accepting the admission.

The host does not create an Agent, call a model, select a provider, change cwd inheritance, or create a Git worktree. The executor bridge (`@deepseek-ai/dsh-supervisor-executor-subagent`) receives a lease before it creates a child and attaches an exact cancellation-and-settlement lifecycle afterwards. A project has one writer and concurrent read-only reviewers. Once a child is attached, public lease release refuses to unlock the project before settlement. Teardown is child-first: cancel, await child settlement, release leases, flush and detach hosts. A cancellation failure before settlement retains the writer gate and host as recovery-required; attached child settlement later performs the safe release and detach.

## Recovery

`reconcile()` is the service's restart entry: it consumes the central durable projection's observations of previously linked runs. A confirmed live child reclaims its writer slot and returns a lease for its provider to bind the exact lifecycle. That recovered lease is unsettled before binding, so it cannot be released or displaced by another writer. An uncertain writer throws a recovery-required error and is never automatically repeated or released.

## Testing

`packages/supervisor/supervisor-project-host/tests/gate.spec.ts` covers stable host identity, same-project write exclusion, forged-release resistance, read-only parallelism, cross-project concurrency, recovered host-link validation, recovered live-child binding, timeout/failure settlement release, uncertain-writer refusal, cancellation-failure writer retention until child settlement, restored hosts across contexts, and disposal closing admission before child drain and host detachment.

## Alternatives considered

- **Fork subagents directly from the controller.** The controller has no project cwd, so a directly forked child would inherit the wrong workspace or require prompt-level cwd discipline with no durable admission control.
- **Let the host create Agents and call providers itself.** The host deliberately does not create an Agent, call a model, or select a provider; that responsibility stays with the executor bridge, keeping the host a pure admission and lifetime owner.

## Consequences

- The per-project writer lock is enforced by an owned gate instead of a task-label convention, and it covers admission, execution, cancellation, and teardown rather than dispatch alone.
- Hidden hosts are durable and restore across restarts, but they add per-project durable state that must flush and detach, and a recovery-required state holds the writer gate until explicit recovery or child settlement — a stuck writer blocks its project until then.
- `reconcile()` is exercised directly by the package tests; the central durable projection's production restart feed into it is owned by later recovery work.
