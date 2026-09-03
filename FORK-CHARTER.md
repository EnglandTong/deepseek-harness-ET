# Fork Charter — deepseek-harness-ET

This repository is the working fork of [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness). Owner: EnglandTong.

## Role (owner-defined)

> 这里我只修改了增加独立桌面端的开发，没有做任何其他的改变，只是从页面端改为 Windows 版。
> The only non-upstream change is the independent desktop client: the web page front end becomes a Windows desktop app. Nothing else was changed.

## What belongs here

- **The desktop client only**: `apps/desktop` — a thin Electron window that starts `dsh web --no-open` and shows the official Web UI (including Settings → Plugins import). `packages/host/plugin-import` is the fork's other non-upstream piece (web plugin-bundle import). Everything else tracks upstream.

## What does NOT belong here

- **Plugin capability work** lives in the standalone plugin repositories:
  - [governance-multi-agent-harness](https://github.com/EnglandTong/governance-multi-agent-harness) — 以 CMS 规则管理开发进度，并管理各大模型和 Agent。
  - [master-agent-assistance](https://github.com/EnglandTong/master-agent-assistance) — 以 CMS 规则当总控：单一对话 Agent 管理所有开发项目，作为使用者的助理。
- If a change looks like a Service Definition / Service Provider / Consumer (capability seam), it belongs in one of the plugin repos, not here.

## Relationship to the other two directories

- `D:\Development\deepseek-harness` — read-only upstream mirror; sync only, never modify.
- This fork follows upstream `master`; keep it releasable. Feature work goes on `agent/*` branches.

## CMS rules

The governing methodology for both plugin repositories is the owner's CMS (规则) discipline, authored as the `cms-project-governance` skill at `D:\Development\ClawSkills\ClawSkills\skills\cms-project-governance` (Work Orders, single-writer governance, authority sharing, independent QA). That skill is the authoritative definition; the companion `agent-loop-engineering` skill governs loop execution. When a plugin's behavior conflicts with them, the skills win.
