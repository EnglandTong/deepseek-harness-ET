---
name: agent-governance-runtime
description: Inspect Agent Provider availability, permissions, nested-depth limits, and delegation diagnostics before execution.
---

# Agent Governance Runtime

Use `governance_check_agents` when Provider availability may have changed. A listed harness is not necessarily available, and availability does not grant execution authority.

Before delegation, verify the target workspace exists, the permission mode is sufficient but no broader than required, the task is not a Governance Profile recursion, and the nested depth is within the configured maximum.

Use the existing Codex and Claude Code Providers through Governance. Do not reproduce their CLI or SDK protocol inside a Skill.

Record only concise diagnostics and file references in the Session. Keep full prompts, reports, and large output in the bounded task packet.
