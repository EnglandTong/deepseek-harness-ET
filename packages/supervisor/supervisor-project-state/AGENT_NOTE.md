# Agent Note: Project governance state adapter

Status: proposed

English | [中文](AGENT_NOTE.zh.md)

## Problem

The Supervisor must recover current project facts without copying every project document or Skill body into the main conversation. Existing governance files can use `Docs` or `docs`, can be incomplete, and may disagree. Guessing through a conflict would let stale state drive dispatch.

## Proposal

`ProjectStateAdapter` performs bounded, path-contained reads and returns a compact projection with source paths, fingerprint, recent Loop records, and explicit conflict status. Reads are the default. `refresh()` is deliberately non-writing until a later authorized composition adds an atomic writer. Skill handoff values contain only the Skill name, purpose, and a load-on-demand hint.

## Acceptance criteria

- Docs lookup is case-insensitive and rejects duplicate or outside symlink targets.
- Packet, Work Order, and recent Loop Runs are bounded reads.
- Fingerprints use normalized relative paths plus raw bytes and detect stale authority.
- Missing, malformed, duplicate, or outside sources produce a conflict and zero writes.
- Returned summaries do not contain full Skill text, hidden reasoning, or complete history.

## Risks

The narrow Markdown projection may omit a legacy fact; the explicit conflict and source references allow governance consumers to request the relevant authority on demand. Loop records are evidence summaries, not acceptance decisions.
