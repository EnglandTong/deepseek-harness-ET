# `@deepseek-ai/dsh-supervisor-routing-policy`

English | [中文](README.zh.md)

The routing-policy package validates a Personal Supervisor YAML policy and resolves one deterministic, explainable provider route. It covers executor/provider/model selection, task selectors, capabilities, cost and run ceilings, concurrency, time windows (including windows that cross midnight), approval disposition, permission ceilings, project allowlists, fallback targets, and reviewer pipelines.

Credentials never belong in this document. Unknown fields and credential-like keys are rejected before a policy can be compiled. A route result contains the public `RouteDecision` plus dispatch controls (`dispatchable`, approval mode, permission ceiling, timeout, review pipeline, and fallback evidence).

`RoutingPolicyStore.preview()` produces a stable route diff and hash. `apply()` requires explicit confirmation and rejects a stale preview, so a conversation cannot silently change the active policy.

## Minimal YAML

```yaml
version: 1
timezone: Asia/Shanghai
timeWindows:
  - { start: "09:00", end: "23:00" }
routes:
  - id: software-review
    domain: software
    taskType: review
    language: typescript
    capabilities: [read, test]
    executor: codex
    provider: openai
    model: coding-review
    costTier: medium
    approval: auto
    permissionCeiling: read
    timeoutMs: 120000
    projectAllowlist: [project-a]
    fallback:
      - { executor: claude-code, provider: anthropic, model: review, costTier: high }
    review:
      strategy: single
      condition: always
      reviewer: { executor: codex, provider: openai, model: second-pass, costTier: medium }
```

The full YAML schema is represented by the exported TypeScript types and is validated strictly at load time.

## Model Experience

### Routing policy

#### What the model sees

The model sees `RouteDecision` candidates, provider availability, policy version/hash, approval gates, cost tier, and a compact reason. It does not see credentials or hidden provider state.

#### Token effect

The router emits one compact decision and a route-level diff. It does not load project transcripts or embed full YAML in every task request.

#### KV Cache effect

Stable policy versions keep repeated decisions prefix-stable until an explicitly confirmed update changes the policy hash.

## Known Limitations and Deferred Work

- Provider authentication and model availability remain owned by the selected executor/provider bundle.
- Policy evaluation is process-local; durable policy history is recorded by the Supervisor memory layer.
