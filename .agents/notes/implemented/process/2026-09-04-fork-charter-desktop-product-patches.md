# Agent Note: Fork charter allows desktop-product harness patches

Status: implemented

English | [中文](2026-09-04-fork-charter-desktop-product-patches.zh.md)

## Problem

The fork charter previously read as “desktop client only; everything else tracks upstream,” while the tree already carried owner-requested harness deltas (workspace snapshot / multi-edit, MCP `startupTimeoutMs`) beside the desktop shell and web plugin-import. That mismatch made it unclear whether those deltas were charter violations or intentional product support.

## Decision

**[FORK-CHARTER.md](../../../FORK-CHARTER.md) keeps the desktop shell and web plugin-import as primary fork scope, and adds an explicit allowlist of desktop-product harness patches that may remain in this repository.** The live allowlist is the charter bullet list (today: workspace snapshot/multiedit, MCP `startupTimeoutMs`, SEA/`moduleFallback` client module boot, sdk-runtime profile-bundle closure, and desktop local-edge sidecar + helper purposes / input-optimize). New exceptions must extend that list in the same change. Standalone plugin-capability products (governance multi-agent, master-agent assistance) stay out of this tree; Studio and in-repo governance bundles stay removed.

## Alternatives considered

- **Strict desktop-only purge.** Rejected for now: the owner chose to keep the existing product-supporting patches rather than migrate or upstream them immediately.
- **Open-ended “any harness patch.”** Rejected: without an allowlist the charter cannot constrain blast radius across upstream syncs.

## Consequences

Root `AGENTS.md` points at the same rule. Snapshot/MCP work may continue here when it serves the desktop/web product; capability products still go to the standalone plugin repos. Expanding the allowlist is a deliberate charter edit, not an accidental drift.
