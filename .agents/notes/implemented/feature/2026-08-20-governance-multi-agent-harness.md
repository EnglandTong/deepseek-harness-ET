# Governance Multi-Agent Harness

## Decision

`@deepseek-ai/dsh-agent-governance` remains an optional Bundle. It mounts the governance Skill set, registers deterministic Agent routing, and exposes approval, delegation, reporting, and acceptance tools without changing `agent-loop`.

## Provider model

Codex and Claude Code remain existing `ctx.subagents` Providers. DeepSeek Harness is represented by the existing `@deepseek-ai/dsh-subagent-dsh-sdk` process boundary, so the governance layer does not duplicate CLI or wire protocols.

## Durable facts

Routing, approval, reports, and acceptance append `governance/*` Session Events. Large work packets remain workspace files and are referenced by the event or Skill guidance.

## Verification

Focused routing and Skill lifecycle tests pass. TypeScript project builds pass for the two changed packages. Full repository constraints still report pre-existing rc.7 version drift in the unrelated snapshot packages.
