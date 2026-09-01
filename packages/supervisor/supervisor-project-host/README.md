# `@deepseek-ai/dsh-supervisor-project-host`

English | [中文](README.zh.md)

This package owns one hidden, durable Session per explicitly registered project. Its Session header uses the registry's exact `realPath` as `cwd`; it neither changes normal subagent cwd inheritance nor creates Git worktrees.

Before an executor creates a child, it calls `admit()`. A write lease is exclusive within that one project, while any number of read-only review leases may run beside it. The resulting `SupervisorRunLink` associates the task, project host and exact child Session. The executor attaches its child lifecycle to the lease; public release is refused until that child settles. Settlement, successful cancellation and plugin disposal release exactly that run. If cancellation throws while the child has not settled, the host retains the writer gate and Session as recovery-required until the attached `done` promise settles; it never risks a concurrent writer.

After restart, the central projection supplies durable links to `reconcile()`. Each confirmed live child returns a recovered lease so its provider can attach the exact lifecycle and eventually release the writer gate. The recovered lease remains locked before that attachment: liveness is not settlement. An unresolved writer without proof that its child remains live raises `SupervisorProjectHostRecoveryRequiredError`; this package never silently repeats or releases uncertain work.

## Model Experience

### Project execution host

#### What the model sees

Nothing is added to the main assistant prompt. The host is a non-model Session lifecycle owner; later executor packages use `supervisorProjectHost` to supply an isolated project cwd and admission lease.

#### Token effect

Host metadata and run links are structured runtime records. They do not copy project files or child transcripts into the controller context.

#### KV Cache effect

The stable host Session identity avoids re-describing a project's cwd each time an executor resumes work. Task briefs and conversation compaction remain the responsibility of later packages.

## Known Limitations and Deferred Work

- This package does not start models, invoke CLI providers or decide routing; WO-07 attaches concrete child lifecycles.
- Durable link projection and safe restart policy are supplied by the orchestrator and memory packages. This package refuses an uncertain recovered writer instead of guessing.
- A host Session is hidden infrastructure only; Host API and read-only child UI are later Work Orders.
