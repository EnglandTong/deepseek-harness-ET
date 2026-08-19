---
name: agent-loop-engineering
description: Execute an authorized software goal through low-context, bounded-autonomous AI coding loops with persistent state, proactive repair, automatic and functional evidence, layered stage review, independent final acceptance, safe workspace boundaries, and resumable handoffs. Use when a target and acceptance criteria are clear and the user asks to implement, debug, verify, continue autonomously, follow Controller-Developer-QC cycles, resume after context loss, or reduce repeated context and documentation. For vague goals, legacy-state conflicts, requirement discovery, QA acceptance, or target rebaseline, use cms-project-governance first.
---

# Agent Loop Engineering

Version: 2.1.1

Use this skill as the execution plane for authorized software work. Continue by default while useful progress remains inside scope. Make ordinary reversible project-local decisions, diagnose failures, repair them, and verify real behavior without asking the Owner to supervise each loop.

Respond in the user's language. Keep persistent state factual, compact, and free of hidden reasoning.

## Language Files

- For English work, use this file and load only needed files from `{baseDir}/references/en/`.
- For Chinese work, first read `{baseDir}/SKILL.zh-CN.md` and load only needed files from `{baseDir}/references/zh-CN/`.
- Keep machine-readable keys and enum values in English in both languages.

## Entry And Bootstrap

Execution requires:

- a user-visible desired outcome;
- current scope and Non-Goals;
- observable acceptance criteria with delivery classes;
- allowed changes and protected boundaries;
- required evidence;
- exactly one next action.

Prefer `Docs/ACTIVE_PACKET.md` with `contract_version: "2.0"` and the 2.1 policy fields. If no packet exists, use `cms-project-governance` Legacy Bootstrap or run:

```text
node {baseDir}/scripts/bootstrap-active-packet.mjs --workspace <project-path> --json
```

The bootstrap is read-only unless `--write` is supplied. Write only when its report is coherent and conflict-free. If current target, Work Order, decision, or authority is ambiguous, stop as `Invalid State`; do not guess.

Read `{baseDir}/references/en/migration.md` for legacy projects.

## Authority And Workspace

- Owner owns purpose, Non-Goals, and consequential decisions.
- Controller owns size, authorized stages, Work Order scope, and alignment decisions.
- Developer owns implementation and execution evidence.
- Stage Reviewer checks the current stage and may return it for repair.
- Independent QA owns final acceptance for Standard and Full governance.

Treat user wording such as `QC` in a single-agent Controller-Developer-QC cycle as `Stage Reviewer`, not independent final QA.

Resolve the packet workspace and all candidate write paths to real paths. With `write_scope: "."` and `outside_write_policy: Deny`, do not create, modify, move, or delete anything outside the workspace, including through symlinks or junctions. Project rules may narrow this further.

## 2.1 Packet Policy

Keep `contract_version: "2.0"` for compatibility. New packets add:

```yaml
autonomy_mode: "Bounded"
acceptance_mode: "Layered"
delivery_class: "Runtime"
context_profile: "Compact"
write_scope: "."
outside_write_policy: "Deny"
authority_fingerprint: "sha256:..."
agent_strategy: "Isolated"
max_parallel_agents: 3
context_return_policy: "SummaryAndEvidence"
shared_authority_mode: "FingerprintAndExcerpt"
single_writer: true
```

Allowed delivery classes are `Runtime`, `Contract`, `Governance`, `Artifact`, and `Mixed`. A Contract or Governance delivery must not be reported as a working runtime feature. For `Mixed`, label each acceptance criterion with its class.

`Layered` means the same execution agent may perform stage review and repair, but new Standard and Full work must end at `Ready for Independent Acceptance`. `Ready for Review` remains a legacy-compatible input only. Only a different agent, task, or human reviewer using task-local evidence may set final QA acceptance.

Read `{baseDir}/references/en/evidence-and-completion.md`.

## Bounded Autopilot

For `autonomy_mode: Bounded`, run this state machine:

```text
Controller stage dispatch
  -> Developer implementation and focused verification
  -> Stage Reviewer checks criteria, diff, and raw evidence
  -> pass: align and continue the next authorized stage
  -> fail: Needs Fix on the same Packet and Work Order
  -> Developer repair and re-verification
  -> terminal stage: Ready for Independent Acceptance
```

Do not ask the Owner about ordinary reversible implementation choices. Choose the conservative project-consistent default and record material assumptions. Ask only when the decision changes target, Non-Goals, protected architecture/data, production behavior, cost, credentials, destructive effects, or acceptance authority.

After a failed check:

1. identify a failure signature;
2. inspect the narrowest relevant logs and source;
3. form a new evidence-backed hypothesis;
4. make a bounded repair inside scope;
5. rerun the focused check and affected regression;
6. continue when progress is real.

Stop after two consecutive attempts with the same failure signature and no new evidence, narrower scope, root cause, or passing behavior. Re-running the same command unchanged is not progress.

Read `{baseDir}/references/en/execution-loop.md`.

## Stages And Alignment

Authorize at most ten stages:

| Size | Stage ceiling | Review horizon |
| --- | ---: | ---: |
| Small | 30 minutes | 5 hours |
| Medium | 60 minutes | 10 hours |
| Large | 120 minutes | 20 hours |

A stage is an outcome checkpoint, not a document. Run a lightweight target-link check at every stage. Run formal alignment after stages 3, 6, and 10, and immediately when:

- the authority fingerprint changes;
- scope grows more than 20 percent;
- a primary user flow fails despite green automatic checks;
- the target link cannot be explained in one sentence;
- a protected boundary or new product idea appears.

At stage 10, return `Ready for Independent Acceptance`, `Needs Fix`, `Blocked`, `Invalid State`, or a split/rebaseline recommendation. Never silently start another ten stages.

## Evidence And Verification Cost

No evidence means no completion. A runtime claim normally requires:

1. automatic evidence;
2. functional or user-flow evidence;
3. target-environment evidence when required;
4. independent evidence for final Standard/Full acceptance.

Use the verification ladder:

- run the focused reproduction or test in each loop;
- run affected regression at integration points and after repairs;
- run full regression at terminal review, when acceptance requires it, or after a material risk trigger;
- do not repeatedly run an unchanged expensive suite without a new hypothesis or change.

Successful commands record command, exit code, concise result, timestamp, and evidence path. Failed commands retain the useful failure tail and raw-log path, not complete stdout in project state.

When evidence conflicts, keep the weaker result. Builds and unit tests do not overrule a broken user flow.

## Compact Context

`context_profile: Compact` reads by default:

1. Active Packet;
2. current Work Order or one current action;
3. affected source and tests;
4. verification configuration;
5. the last three loop records.

Do not reread TARGET, ACCEPTANCE, or the Work Order when their recorded authority fingerprint is unchanged. Do not load historical Milestones, handoffs, QA files, or full logs unless diagnosing a named conflict.

Use soft context ceilings by size: Small 6 files / 30,000 characters, Medium 10 / 60,000, Large 16 / 100,000. Exceed only for named evidence, record why, and compact before continuing. These are context controls, not proof of completion.

Read `{baseDir}/references/en/safety-and-context.md`.

## Isolated Delegation

Delegate work to reduce retained context only when it is separable and expected to produce substantial reading or tool output. Keep small, tightly coupled work in the main loop. Give each worker a bounded task packet, disjoint write scope, authority fingerprint plus required excerpts, and a structured return capped to conclusions and evidence. Never send the full parent conversation.

Use one coordinating writer per Packet and normally no more than three active workers. Isolate log review, broad read-only discovery, noisy validation, and independent QA first. Parallel Developers require non-overlapping Work Orders and an authorized integration stage.

Read `{baseDir}/references/en/isolated-delegation.md`. For host-specific session, cache, attachment, compaction, and rewind controls, read `{baseDir}/references/en/host-cost-controls.md` only when that host is in use.

## State Updates

At loop end:

1. update execution and stage state;
2. update only affected acceptance criteria and concise evidence links;
3. keep blockers and material assumptions;
4. keep exactly one next action;
5. append one record to `Docs/LOOP_RUNS.jsonl`.

New records use `record_version: "2.1"` and may include `role`, `progress_delta`, `stage_review`, `failure_signature`, and `context_stats`. Never copy the same status into several Markdown files. Prefer the packet and loop log over per-stage dispatch, handoff, or QA files.

## Hard Stops

Stop before:

- secrets, credentials, account login, or reusable sessions;
- production or non-sanitized customer data;
- paid resources or public/production deployment;
- system-level installation, privileges, drivers, or host security changes;
- destructive Git, migration, overwrite, reset, force push, or irreversible deletion;
- protected architecture, data boundary, technology-stack, target, or Non-Goal change;
- any write outside the resolved workspace;
- unavailable authority or exhausted stage, failure, or context budget.

Diagnostic sharding may narrow a long or timed-out suite, but it cannot replace an authorized full-suite gate unless Controller or Owner formally changes that gate.

## Automation And Handoff

An outer runner may repeat bounded loops only with a single-writer lock, fresh state, enforced budgets, and a stop on any terminal or invalid state. It must not invent scope, auto-answer Owner gates, accept governed work, or hide failures.

Give Stage Reviewer and independent QA raw criteria, diff, commands, and evidence. Do not give them the Developer's desired verdict as proof.

Read `{baseDir}/references/en/automation-and-handoff.md`.

## Validation

Run compact validation without changing the project:

```text
node {baseDir}/scripts/validate-loop-state.mjs --workspace <project-path> --summary --max-findings 20
```

Add `--json` for machine output or `--strict-history` only when old log migration itself is under review. Validator success proves state consistency, not product correctness.

## User Report

Report only the current delta:

```text
Execution state:
Stage and role:
Target link:
Progress delta:
Automatic verification:
Functional verification:
Stage review:
Risks or blockers:
Next action:
Independent QA needed:
```

Do not claim final acceptance unless the current acceptance authority permits it.
