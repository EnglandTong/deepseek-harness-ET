# Safety And Context 2.1

## Real-Path Write Boundary

Resolve the workspace with `realpath`. Resolve every existing target and the nearest existing parent of every new target. Reject the operation when the relative real path escapes the workspace, including symlinks and junctions.

`write_scope: "."` never authorizes a path outside the workspace. Reads of installed skill instructions or explicitly referenced public documentation do not expand write authority.

## Hard Stops

Stop before secrets, account sessions, production/customer data, paid resources, public/production changes, system-level installs, privilege changes, destructive or irreversible actions, protected architecture/data/stack changes, or action outside current authority.

Ask for exact scope, impact, rollback, and evidence plan only when such a gate is genuinely reached.

## Project-Local Autonomy

Unless project rules prohibit it, Bounded Autopilot may inspect files, edit authorized source/tests, install declared project dependencies, create disposable fixtures, start local development services, run project-local checks, and repair defects caused or exposed by current scope.

Do not confuse project-local dependency installation with host-wide installation.

## Context Profiles

| Profile | Typical use | Soft ceiling |
| --- | --- | --- |
| `Compact` Small | narrow local behavior | 6 files / 30k characters |
| `Compact` Medium | subsystem or important flow | 10 files / 60k characters |
| `Compact` Large | cross-subsystem authorized work | 16 files / 100k characters |
| `Audit` | read-only whole-project review | explicit per-audit budget |

Normal execution reads the packet, current action, affected source/tests, verification config, and last three loop records. Reuse authority by fingerprint; do not reload unchanged governing files.

When a soft ceiling is exceeded, state the named evidence need, summarize current facts into the packet, discard duplicate output, and continue only with the smaller working set. Budget exhaustion is not completion.

## Tool Output

- Use quiet reporters where trustworthy.
- Record full output to disposable evidence only when required.
- Return concise success summaries.
- Return the useful failure tail, not thousands of repeated warnings.
- Aggregate validation findings by code; expand with `--strict-history` only for migration audits.

## Persistent Data

Never store secrets, private customer data, full private documents, transcripts, hidden reasoning, full command logs, or unnecessary absolute machine paths. Store evidence references, hashes, concise observable summaries, and optional usage metrics exposed by the platform.
