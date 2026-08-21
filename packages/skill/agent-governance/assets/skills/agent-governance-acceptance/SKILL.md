---
name: agent-governance-acceptance
description: Review child reports against explicit acceptance conditions and record independent acceptance decisions.
---

# Agent Governance Acceptance

Treat a child report as evidence, not acceptance. Review the changed-file summary, test commands and exit codes, unresolved issues, and the target project's actual acceptance conditions before using `governance_accept`.

Use `accepted` only when the required evidence is present, `rejected` when evidence or behavior fails, and `needs-follow-up` when a bounded repair or additional evidence is required. The Agent that executed the work must not replace an independent Standard or Full acceptance decision.
