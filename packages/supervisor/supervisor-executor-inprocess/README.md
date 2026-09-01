# `@deepseek-ai/dsh-supervisor-executor-inprocess`

English | [中文](README.zh.md)

This package is the first concrete Personal Supervisor executor adapter: it registers on the executor bridge and turns a routed task into one in-process one-shot child run in the routed project's workspace. `prepare()` reserves the child identity only, so the executor bridge admits the project-host lease before any model work starts; `start()` drives the shared in-process driver with that reserved id, the routed provider/model as the child's route, and the project's real path as the child workspace.

The child is a real delegated agent: fresh context, subagent depth stamped, delegation-scope statement and policy pins applied, one terminal result mapped onto the executor bridge's normalized vocabulary. Cancellation, timeout, and disposal ordering stay owned by the bridge.

## Model Experience

### Supervisor in-process executor

#### What the model sees

The main assistant receives the compact normalized run result through the executor bridge. The child sees the routed prompt plus its own delegated composition; the adapter adds no model-visible content beyond the durable one-shot descriptor.

#### Token effect

One child run per dispatch. The adapter does not copy child transcripts into the controller prompt; full output remains in the child Session.

#### KV Cache effect

Stable executor and provider names keep repeated dispatch records prefix-stable until the routing policy changes.

## Known Limitations and Deferred Work

- The route provider allowlist is empty by default, so the adapter is dormant until the owner configures providers in the bundle row.
- Cross-device executors (ACP, DSH SDK, external CLIs) are separate future adapter packages; this package only runs in-process children.
- The routed provider must be resolvable by the deployment's LLM registry; adapter startup fails loud otherwise.
