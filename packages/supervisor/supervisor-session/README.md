# `@deepseek-ai/dsh-supervisor-session`

English | [中文](README.zh.md)

This package owns the Personal Supervisor's one durable controller Session. On first enable it reserves the stable `supervisor-main` id, appends and flushes one `supervisor/identity` event, then persists the id in the settings namespace `supervisor-session`. Later boots list the configured persistence backend, prepare the exact stored Session, validate its identity event, and publish it through the normal Session lifecycle.

The final-flush disposer stops new work, calls `ctx.sessions.flush()` and only then detaches the Session. JSONL and SQLite behavior is supplied by the existing `SessionPersistence` seam; this package does not inspect backend files or create a second persistence format.

## Model Experience

### Supervisor session

#### What the model sees

Later Supervisor consumers see one stable controller Session and its durable `supervisor/identity` event. This package exposes no project files, shell, model routing, or executor tools.

#### Token effect

Only the singleton identity marker is added to the controller conversation; project history remains in later projections.

#### KV Cache effect

The controller prefix stays stable across restart because the settings id and identity event are restored before consumers attach.

## Known Limitations and Deferred Work

- Project registration, routing, dispatch, and memory projections are provided by later Work Orders.
- A settings write failure after the durable identity flush leaves a recoverable log under the stable first-boot id; the next boot reconciles that log before creating anything else.
