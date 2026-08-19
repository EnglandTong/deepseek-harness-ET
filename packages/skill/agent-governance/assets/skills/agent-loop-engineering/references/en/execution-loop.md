# Execution Loop 2.1

## Start Or Resume

1. Resolve the workspace and Docs directory to real paths.
2. Read `Docs/ACTIVE_PACKET.md`.
3. Validate the authority fingerprint and write boundary.
4. Read one current action, affected source/tests, verification config, and the last three loop records.
5. Confirm no stop condition is already active.

If no packet exists, run Legacy Bootstrap. Do not execute from contradictory legacy files.

## Controller Stage Dispatch

Controller sets one stage outcome linked to acceptance criteria. It does not create a stage file. The outcome must fit current scope, include expected evidence, and be reversible or have a recovery path.

Controller auto-continues only while:

- authority fingerprint is unchanged;
- alignment is `Aligned`;
- the next stage is already authorized;
- useful progress exists;
- no Owner or safety boundary is triggered.

## Developer Loop

```text
select one coherent behavior
  -> inspect existing patterns
  -> reproduce or establish baseline
  -> implement within write_scope
  -> focused automatic check
  -> functional check when behavior changed
  -> affected regression
  -> review diff and evidence
```

Prefer a complete vertical slice. Do not add speculative abstractions, unrelated cleanup, or a new feature merely because time remains.

## Failure Repair

Create a stable `failure_signature` from the failing command, test/criterion, and primary error. Before retrying, require at least one progress delta:

- new root-cause evidence;
- narrower failing scope;
- a relevant code/config change;
- a newly passing check;
- a disproved hypothesis.

The same signature with no progress twice becomes `Needs Fix` or `Blocked`. A timed-out full suite may be sharded for diagnosis, but shards are not terminal acceptance unless the gate was formally changed.

## Stage Review

Stage Reviewer receives criteria, changed files/diff, raw command results, functional evidence, and known limits. It ignores the Developer's desired verdict.

Return one of:

- `Passed`: stage outcome and evidence are sufficient;
- `Needs Fix`: an actionable criterion or evidence defect remains;
- `Blocked`: external authority or environment is required.

Stage Reviewer does not set final `qa_decision` in Standard or Full work.

## Alignment

At every stage state:

```text
User-visible change:
Target / criterion link:
Scope or assumption drift:
Evidence against premature completion:
Continue / Needs Fix / Formal Alignment:
```

Formal alignment runs at stages 3, 6, and 10 and on any immediate trigger named in the Skill.

## Loop Record

Append one compact record:

```json
{"record_version":"2.1","contract_version":"2.0","timestamp":"2026-01-01T00:00:00Z","packet_id":"GOAL-001","stage":1,"loop":1,"role":"Developer","result":"Progress","progress_delta":"Focused test now passes","evidence":["work/test.log"],"failure_signature":null,"stage_review":"Not Reviewed","context_stats":{"files":5,"characters":18000,"tool_output_characters":2400,"full_regression_runs":0},"next_action":"Run the affected API flow"}
```

Token fields may be added to `context_stats` only when the platform exposes them. Do not estimate them as facts.

## Terminal States

- `Ready for Independent Acceptance`: authorized implementation and required stage evidence are complete for new Standard/Full work.
- `Needs Fix`: bounded repair remains inside scope.
- `Blocked`: a hard gate or unavailable authority prevents progress.
- `Invalid State`: current authority or state conflicts.
- `Locally Compliant, Globally Misaligned`: local criteria pass but the result no longer serves the desired outcome.

For legacy Layered Standard/Full packets, normalize `Ready for Review` to `Ready for Independent Acceptance`; neither means Accepted.
