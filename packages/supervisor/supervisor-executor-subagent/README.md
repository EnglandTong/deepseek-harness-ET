# `@deepseek-ai/dsh-supervisor-executor-subagent`

English | [中文](README.zh.md)

This package is the Personal Supervisor executor seam. It registers adapters for in-process models, Codex, Claude Code, DSH SDK, or ACP and turns a routed request into a project-host admission. An adapter reserves the child Session identity before starting provider work; this lets the host's single-writer gate cover startup, execution, cancellation, and cleanup.

`SupervisorExecutorService.dispatch()` rejects non-dispatchable routes, unsupported providers, permissions above the adapter ceiling, unsupported background execution, and adapters without cancellation. A provider startup failure releases the lease. A published run retains its exact host lease until its result and disposal settle, and cancellation addresses only that run.

## Model Experience

### Executor bridge

#### What the model sees

The main assistant receives a compact `supervisor` executor result: status, provider/model identity, diagnostic, and evidence references supplied by later reporters. It does not receive hidden reasoning or raw credentials.

#### Token effect

The bridge does not copy a child transcript into the controller prompt. It normalizes one terminal result and leaves full output in the child Session.

#### KV Cache effect

Stable executor names, provider names, and route versions keep repeated dispatch records prefix-stable until the route changes.

## Known Limitations and Deferred Work

- Provider packages must implement `prepare()` so the child Session identity is reserved before startup; this package does not reimplement external CLIs.
- The integration Bundle registers the in-process model adapter (`@deepseek-ai/dsh-supervisor-executor-inprocess`); concrete Codex, Claude Code, DSH SDK, and ACP adapters remain future packages behind the same seam. Authentication remains owned by each native provider.
- Result normalization records independent timeout, signal, and exit-code facts; it does not infer acceptance from a completed execution.
