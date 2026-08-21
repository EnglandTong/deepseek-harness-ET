# Agent Note: Governance Runtime delegates through existing Subagent Providers

Status: implemented

English | [中文](2026-08-21-governance-runtime-adapters.zh.md)

## Problem

Governance needs to coordinate multiple coding Agents without making provider protocols or Agent Loop behavior part of the Governance package.

## Decision

The Governance package owns a live harness registry, deterministic routing, approval state, delegation checks, report recording, handoff references, and independent acceptance. Codex, Claude Code, and DeepSeek Harness are represented by adapters that call the existing DSH Subagent Provider registry; Governance does not copy their CLI, SDK, or wire protocols.

Provider availability is checked at runtime and recorded in Session Events with diagnostic codes. Delegation requires approval for write-capable routes, uses the parent Session workspace, enforces the configured nested-depth limit, forwards the caller cancellation signal, and applies a bounded task timeout. Changed-file reports and handoff paths are rejected when they resolve outside the Session workspace.

Governance lifecycle facts use replayable Session Events, while large work packets remain file references. The package exports type-only contributor interfaces for a future native extension bridge, but the current release registers no native hooks and does not modify `agent-loop`.

## Alternatives considered

**Copy each provider protocol into Governance.** This was rejected because it would duplicate provider lifecycle and permission behavior and create a second compatibility surface.

**Change `agent-loop` to make Governance a core phase.** This was rejected because Governance remains an optional Bundle and the current extension points already support provider-backed delegation.

**Treat adapter completion as acceptance.** This was rejected because child execution evidence and independent acceptance have different authority and must remain separate Session facts.

## Consequences

The first release depends on the selected Profile loading the relevant Subagent Providers, and no direct CLI fallback is included in this package. Runtime diagnostics make missing providers explicit. The Session Event vocabulary grows without changing `SESSION_FORMAT_VERSION`, while the file-reference rule keeps large handoff packets out of repeated model context. Future native integration can target the exported contributor interfaces without requiring a Governance rewrite.

## Testing

Focused Governance typecheck and tests cover live provider diagnostics, routing, replay, workspace handoff rejection, adapter/provider mapping, and nested-depth rejection. The full host library build includes the emitted Governance package.
