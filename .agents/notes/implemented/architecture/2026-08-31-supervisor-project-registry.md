# Agent Note: Personal Supervisor project registry

Status: implemented

English | [中文](2026-08-31-supervisor-project-registry.zh.md)

## Problem

Personal Supervisor needs project identity without silently adopting directories or treating aliases as separate projects. Discovery must remain bounded and metadata-only, while explicit enrollment must have one canonical path and removal must not delete project data.

## Decision

`@deepseek-ai/dsh-supervisor-project-registry` accepts explicit discovery roots, enumerates only immediate directory entries, canonicalizes existing directories through `realpath`, and emits versioned `supervisor/project` snapshots after explicit registration. Registration mutations are serialized so concurrent aliases cannot publish duplicate owners. Refresh never follows a changed canonical target and reports missing or non-directory paths as unavailable; permission errors remain failures. It records these observations without writing project files and uses a `.git` file marker to identify linked worktrees. Registrations restored from the central controller ledger stay visible even when the ledger replay lands after registry construction: the registry merges not-yet-observed central projects additively at every public entry point and never republishes them, so a restored real path keeps its original owner.

## Alternatives considered

- Scanning the whole filesystem was rejected because it is unbounded and creates unconfirmed project candidates.
- Using display paths as identity was rejected because symlink and junction aliases would duplicate one project.
- Reading project manifests during discovery was rejected because candidate discovery must remain read-only metadata inspection.
- Deleting project directories on unregister was rejected because central enrollment is separate from user-owned project data.

## Consequences

One canonical path keeps one owner across aliases, concurrent registration, and restart, and removal changes only central enrollment — user-owned project data is never deleted by the supervisor. The cost is that Windows does not expose a portable final-component distinction for every link kind, so the provider reports every Windows link as a `junction` and keeps canonical identity as the safety invariant.

## Testing

`packages/supervisor/supervisor-project-registry/tests/registry.spec.ts` pins immediate-children-only discovery without enrollment, realpath alias dedupe including concurrent canonicalization, dedupe of a real path the central ledger restored after construction, one mutation queue across registration, refresh, and removal, worktree and link metadata reporting, refusal to register missing or non-directory paths, idempotent removal, and refresh that never follows a changed symlink target.
