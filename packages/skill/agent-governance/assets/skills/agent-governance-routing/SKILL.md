---
name: agent-governance-routing
description: Route bounded work to Codex, Claude Code, or DeepSeek Harness after inspecting capabilities and recording approval.
---

# Agent Governance Routing

Use `governance_check_agents` or `governance_list_agents` before selecting an external Agent. Use `governance_route_task` to create a recommendation; routing is not execution authority.

Prefer DeepSeek Harness for requirements, decomposition, governance, and handoff. Prefer Codex for focused code changes and tests. Prefer Claude Code for broad architecture review and cross-file refactoring.

Before `governance_delegate`, confirm the task id, target project, working directory, allowed files, non-goals, permission mode, and acceptance criteria. Call `governance_approve` explicitly. A completed child report is evidence, not acceptance; use `governance_accept` only after reviewing changed files and test evidence.

Do not delegate across project directories unless the task explicitly names the second project and a human has approved it. Use `governance_handoff` for the bounded file reference, and pass references instead of copying the full conversation.
