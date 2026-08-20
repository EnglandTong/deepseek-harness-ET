# Automation And Handoff 2.1

## Runner Contract

An outer runner may invoke one bounded loop repeatedly. Each run acquires one writer lock, reloads state, validates authority/fingerprint/budgets, executes one role phase, appends one record, releases the lock, and stops on terminal or invalid state.

It must not construct scope, answer Owner gates, retry an unchanged failure indefinitely, accept Standard/Full work, or hide failed verification.

## Role Rotation

The same agent may rotate Controller, Developer, and Stage Reviewer when `acceptance_mode: Layered`, but each phase uses only its needed artifacts:

- Controller: target projection, criteria, constraints, current evidence.
- Developer: authorized stage, relevant source/tests, verification commands.
- Stage Reviewer: criteria, diff, raw results, functional evidence, limits.

Stage Reviewer writes `stage_review`, not final QA acceptance. Independent QA must be another agent/task or human and receive task-local evidence.

## Budgets

Enforce stage/time ceiling, two no-progress failures per signature, context profile, single next action, and optional tool/cost budget. A budget stop is not completion.

## Handoff

Prefer Active Packet plus Loop Runs. Create a separate handoff only for a real cross-team boundary that cannot safely resume from them.

A handoff contains packet/stage, current states, progress delta, passing/failing checks, root cause, changed files, blockers, Owner decisions, one next action, and evidence paths. It excludes transcript and hidden reasoning.

## Multiple Agents

Use one writer per packet. Parallel agents need disjoint Work Orders and an authorized integration stage. Reviewers receive raw artifacts, not the desired verdict.
