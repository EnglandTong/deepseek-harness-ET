# Isolated Delegation 2.1.1

## Purpose

Use workers to keep high-volume exploration and tool output out of the coordinating context. Delegation is a context boundary, not a default role ceremony or proof of completion.

## Delegate When

Delegate when the work is separable and one or more conditions apply:

- more than 6 files are likely to be inspected;
- expected useful tool output exceeds about 10,000 characters;
- the task scans logs, history, broad read-only state, or a noisy test suite;
- an independent reviewer needs task-local evidence;
- parallel Work Orders have disjoint write scopes and an authorized integration stage.

Keep work in the main loop when it is small, tightly coupled, likely to need repeated clarification, or would force the worker to reread most of the coordinating context.

## Worker Packet

Send only:

- one bounded question or outcome;
- relevant project-relative paths;
- acceptance criteria needed for that outcome;
- authority fingerprint and required excerpts, not all governing files;
- read/write scope and prohibited boundaries;
- command and output budget;
- required structured return.

Never send the full parent conversation, unrelated history, desired verdict, secrets, or reusable sessions.

## Concurrency And Writes

- Default to at most 3 active workers.
- Keep one coordinating writer for the Active Packet and Loop Runs.
- Give parallel Developers non-overlapping Work Orders and file scopes.
- If scopes overlap, serialize the work or designate one implementation writer.
- Workers do not modify governance authority or sign final acceptance unless independently authorized for that exact role.

## Return Contract

Return no hidden reasoning and no full command output:

```yaml
result: Pass | Fail | Inconclusive
progress_delta: "observable change or finding"
files_read: 0
files_changed: []
evidence: []
failure_signature: null
risks: []
recommended_next_action: "one action"
return_chars: 0
```

Store large raw output in disposable project-local evidence when permitted. Return the command, exit code, concise summary, useful failure tail, and evidence path.

## Cost Check

Delegation is successful only when it reduces retained coordinating context or creates required independence. Record platform-provided usage when available; otherwise compare files read, returned characters, tool-output characters, and repeated reads. If the worker rereads most parent material or returns long narration, use direct execution next time.

