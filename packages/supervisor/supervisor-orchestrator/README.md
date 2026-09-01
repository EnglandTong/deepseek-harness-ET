# `@deepseek-ai/dsh-supervisor-orchestrator`

English | [中文](README.zh.md)

This package is the Personal Supervisor control loop. It captures a request, associates it with a registered project, asks a registered routing provider for an explainable decision, groups approval-required tasks, and dispatches approved work through the executor bridge. Project files and production commands remain outside this package.

`SupervisorOrchestratorService` uses optimistic task revisions for owner actions. Execution reports enter `ReadyForReview`; only a later owner or review action may accept them. Non-completed runs use a bounded failure-signature repair loop. A repeated signature stops the loop and emits a blocked notification.

## Model Experience

### Control loop

#### What the model sees

The main assistant receives `supervisor_tasks` snapshots, route reasons, approval batches, terminal status, and a compact failure signature. Child transcripts remain in their child Sessions.

#### Token effect

Capture and follow-up requests retain only the current task prompt and structured references. Repeated execution output is not copied into the controller prompt.

#### KV Cache effect

Stable task fields and policy versions keep routine status updates prefix-stable; a new task revision changes only the affected record.

## Known Limitations and Deferred Work

- Reviewer dispatch and synthesis are represented by routing data but are integrated by later interaction and bundle packages.
- Approval batches are process-local until the memory and Host API packages project them durably.
- This package stops work on dispose and does not run a resident background scheduler.
