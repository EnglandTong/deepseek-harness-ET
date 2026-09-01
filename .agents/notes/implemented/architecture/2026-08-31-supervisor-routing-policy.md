# Agent Note: Deterministic Personal Supervisor routing policy

Status: implemented

[中文](2026-08-31-supervisor-routing-policy.zh.md) | English

## Problem

The Supervisor must select among heterogeneous model and CLI executors without embedding credentials, silently changing policy, or reducing risk decisions to keyword-only routing. Provider availability, project scope, cost, time, and approval requirements must remain reviewable facts.

## Decision

`@deepseek-ai/dsh-supervisor-routing-policy` is a pure policy compiler and router. Strict YAML validation produces an immutable policy with a stable SHA-256 hash. Matching uses explicit selectors and deterministic specificity/id ordering. Risk, permission, time, budget, concurrency, allowlist, and provider availability gates can only narrow automatic dispatch. Policy edits produce a hash-bound diff and require explicit confirmation before replacement.

The route request carries one `failed` and one `reviewRequested` field that reviewer conditions evaluate, and fallback route references must exist and must not be self-referential.

## Package roles

- Schema parser: rejects unknown fields and credential-like keys at the durable/config boundary.
- Policy compiler: materializes security defaults and canonicalizes the policy for hashing.
- Router provider: returns public `RouteDecision` plus dispatch controls and review topology.
- Update store: exposes preview/apply with stale-preview protection.

## Testing

`packages/supervisor/supervisor-routing-policy/tests/routing-policy.spec.ts` covers the stable hash and frozen immutability across equal recompilations, explicit selectors with risk gates and cross-midnight windows, fallback selection when the primary provider is unavailable, allowlist/concurrency/deny/conditional-reviewer gates, confirmation for unknown routes, exhausted budgets, and stale update previews, and rejection of unknown, credential-like, and missing-or-self fallback references before compilation.

## Alternatives considered

- Hard-coded keyword routing: rejected because it cannot express provider capabilities, budgets, or explainable precedence.
- Passing YAML directly to every executor: rejected because malformed policy would be discovered after dispatch and credentials could leak.
- First-match rules without ordering evidence: rejected because reordering a file would silently change behavior; specificity then stable id ordering is deterministic.
- Silent hot replacement: rejected because policy changes require an owner-visible diff and confirmation.

## Consequences

- Equal inputs and policy content produce the same route ordering and hash, so a reordered file cannot silently change behavior.
- The package never logs in, purchases quota, or writes credentials; unmatched routes and unavailable providers fail closed as a non-dispatchable decision that requires confirmation, never a guessed availability.
- Provider capability catalogs are supplied by the executor integrations that fill the route request; a missing or unavailable catalog is treated as a gate rather than guessed availability.
- A project allowlist uses exact registered identifiers/paths; no registry normalization happens inside this package.
