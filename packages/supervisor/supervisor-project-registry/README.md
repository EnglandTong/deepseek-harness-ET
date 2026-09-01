# `@deepseek-ai/dsh-supervisor-project-registry`

English | [中文](README.zh.md)

This package supplies the Personal Supervisor's explicit project enrollment and bounded candidate discovery. `suggestProjects()` inspects only caller-provided parent directories, reads metadata and directory entry names, and never enrolls a project. `registerProject()` is the user-confirmed operation and canonicalizes the path through `realpath`, so symlink and junction aliases cannot create a second project.

An enrolled path is represented by the versioned `supervisor/project` snapshot from [`@deepseek-ai/dsh-supervisor`](../supervisor/README.md). Missing projects can be observed as `unavailable`; `removeProject()` removes only the central enrollment relation and leaves project files, sessions, and governance records untouched.

## Model Experience

### Project discovery and enrollment

#### What the model sees

The model sees bounded candidate metadata, canonical paths, worktree markers, enrollment ids, and explicit registration failures. It does not receive project file contents from this package.

#### Token effect

Candidate results are compact and bounded by `maxCandidatesPerRoot`; no project history is loaded.

#### KV Cache effect

Stable candidate ordering keeps repeated discovery prefixes deterministic for the same roots.

## Known Limitations and Deferred Work

- **Durable replay belongs to later packages** — the Supervisor event/session projection owns restart persistence; this registry keeps the live enrollment cache and hydrates from `ctx.supervisor` when present.
- **Link classification follows host metadata** — Windows junctions are surfaced as `junction`; platform-specific filesystem providers remain responsible for remote path semantics.
