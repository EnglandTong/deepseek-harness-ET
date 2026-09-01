# Agent Note: Read-only project governance state adapter

Status: implemented

English | [中文](2026-08-31-supervisor-project-state.zh.md)

## Problem

The Personal Supervisor needs current project facts without copying every project document or Skill body into its main conversation. Governance files may use `Docs` or `docs`, may be incomplete, and may disagree. Dispatch must stop when authority cannot be proved instead of guessing from stale text.

## Decision

`@deepseek-ai/dsh-supervisor-project-state` is a bounded, read-only adapter. It resolves one root-level `Docs`/`docs` directory, reads the current Active Packet, Work Order, and a bounded Loop Runs tail, computes the authority fingerprint from normalized relative paths and file bytes, and returns a compact summary with explicit conflicts. `refresh()` performs no write; no atomic writer ships in this seam — a caller that adds one owns it separately, only after the conflict gate passes. Skill handoffs contain only the Skill name, purpose, and a load-on-demand hint.

## Testing

`packages/supervisor/supervisor-project-state/tests/project-state.spec.ts` pins:

- Case-insensitive `Docs`/`docs` discovery, duplicate-directory rejection, and symlinks outside the workspace rejected.
- Packet frontmatter requiring `contract_version: "2.0"`, a non-empty `authority_fingerprint`, and at least one Authority Sources entry.
- Authority sources accepted as backtick paths, Markdown links, and plain list paths; missing or outside sources produce conflicts.
- Loop Runs records required to be JSON objects with the governance fields; malformed or incomplete records are marked corrupt and never promoted to evidence.
- Fingerprint mismatch, duplicate packets or work orders, or missing sources return zero-write conflict results.
- Skill handoffs contain no Skill body, hidden reasoning, or full project history.

## Alternatives considered

- Copy all project Markdown into the Supervisor prompt was rejected because it makes context growth the storage mechanism and hides which file owns a fact.
- Use a vector index as authority was rejected because retrieval ranking cannot prove the current revision or resolve conflicting packets.
- Let the adapter rewrite stale or missing packets automatically was rejected because it could overwrite an Owner decision and violates zero-write-on-conflict.
- Embed complete `cms-project-governance` and `agent-loop-engineering` instructions in every summary was rejected because it wastes tokens and couples project state to Skill revisions.

## Consequences

- Governance facts stay bounded and conflict-explicit: dispatch stops on an unprovable authority source instead of guessing from stale text, and consumers load the named authority files on demand.
- The Markdown projection is intentionally narrow and may omit a legacy fact; the zero-write stance means the adapter can never repair stale or missing packets itself — an authorized composition owns any writer, after the conflict gate passes. Loop summaries remain evidence references, never acceptance decisions.
