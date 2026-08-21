---
name: agent-governance-handoff
description: Create compact file-based handoffs that preserve project boundaries, evidence references, and one next action.
---

# Agent Governance Handoff

Store durable handoffs under `.agent-state/<task-id>/`. Include the target project, workspace, goal, Non-Goals, allowed and forbidden paths, selected harness, permission, acceptance conditions, evidence references, unresolved issues, and exactly one next action.

Use `governance_handoff` to record the path and optional SHA-256 in the Session. Do not copy the full handoff body or child transcript into model context. A handoff path outside the current workspace is rejected.
