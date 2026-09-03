# `@deepseek-ai/dsh-supervisor-api`

English | [中文](README.zh.md)

This package provides the Host-facing projection used by a Supervisor dashboard. It exposes projects, task revisions, linked runs, and coalesced notifications without exposing hidden reasoning, raw stderr, credentials, or project-file operations. Owner review is guarded by the task revision observed by the client.

The API is a Cordis service (`ctx.supervisorApi`) and remains read-only for project data. Dispatch, approval, and follow-up continue through the orchestrator and interaction services so permission and lifecycle gates cannot be bypassed by a client.

Foreign executor adapters import the provider seam as types only:

```ts
import type { SupervisorExecutorProvider } from '@deepseek-ai/dsh-supervisor-api/executor'
```

The same types are also re-exported from the package root. No runtime executor registry ships from this package.

## Model Experience

### Supervisor API projection

#### What the model sees

The `supervisorApi` service is a Host projection and does not assemble prompts or copy child transcripts into the main assistant.

#### Token effect

None. API responses are bounded snapshots.

#### KV Cache effect

None. The projection does not rewrite model prompt prefixes.

## Known Limitations and Deferred Work

- This package does not provide a transport by itself; the Host API proxy mounts its versioned domain.
- Child-session references remain read-only and do not expose transcript mutation.
