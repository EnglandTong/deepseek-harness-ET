# `@deepseek-ai/dsh-tool-supervisor`

English | [中文](README.zh.md)

This package is the human interaction adapter for Personal Supervisor. It registers the eleven `supervisor_*` commands, renders bounded project/task status, forwards route approvals and owner follow-ups to the orchestrator, and coalesces critical notifications for the main assistant and UI consumers.

The command set is `supervisor_status`, `supervisor_projects`, `supervisor_tasks`, `supervisor_register_project`, `supervisor_route`, `supervisor_approve`, `supervisor_reject`, `supervisor_dispatch`, `supervisor_followup`, `supervisor_interrupt`/`supervisor_cancel`, and `supervisor_review`.

`SupervisorInteractionRuntime.receiveIntake()` is the single `@总控` handoff. It validates the source session and caller message id, deduplicates retries, sends an admitted message to the singleton Agent when live, and appends a relay message to the singleton Session when the Agent is cold. It never copies the source conversation history.

The notification projection only consumes critical `supervisor/notification` events. Repeated events for one project/task/kind are coalesced and counted; ordinary task progress is not turned into a notification. Child execution output remains a report and cannot be accepted by these commands.

## Model Experience

### Supervisor interaction

#### What the model sees

The main assistant sees compact `supervisor_status` command results, explicit intake relay messages, and critical notices. It does not receive source conversation history, hidden provider reasoning, credentials, or child stderr through this adapter.

#### Token effect

Status and task commands return bounded lines. Intake contains only the caller id and submitted text. Repeated critical notices are represented by one row with a count.

#### KV Cache effect

Stable command names and compact notification rows keep the controller prefix predictable while project-specific details remain in the task and memory projections.

## Known Limitations and Deferred Work

- The route command evaluates the current task route; task capture remains owned by the orchestrator.
- Review recording is delegated to an optional orchestrator method and reports an explicit error when that provider is not mounted.
- Unread acknowledgement is process-local; the durable notification event remains authoritative for restart reconciliation.
- Bundle composition, Host API projection, and Dashboard rendering are owned by later Work Orders.
