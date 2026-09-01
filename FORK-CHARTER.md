# Fork Charter — deepseek-harness-ET

This repository is the working fork of [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness). Owner: EnglandTong.

## Role (owner-defined)

> 原仓出来的分支，只修改非 plug-in 的部份。
> A branch out of the original repo — only the non-plugin parts are modified here.

## What belongs here

- **Non-plugin surfaces only**: `apps/` (desktop shell, CLI/web bins, launcher integration), build and packaging tooling, docs for those surfaces, and fork-specific branches such as `agent/desktop-electron` (restored Electron desktop shell under `examples/desktop`).
- **Runtime/integration glue** that hosts plugins but is not itself a plugin.

## What does NOT belong here

- **Plugin capability work** lives in the standalone plugin repositories:
  - [governance-multi-agent-harness](https://github.com/EnglandTong/governance-multi-agent-harness) — 以 CMS 规则管理开发进度，并管理各大模型和 Agent。
  - [master-agent-assistance](https://github.com/EnglandTong/master-agent-assistance) — 以 CMS 规则当总控：单一对话 Agent 管理所有开发项目，作为使用者的助理。
- If a change looks like a Service Definition / Service Provider / Consumer (capability seam), it belongs in one of the plugin repos, not here.

## Relationship to the other two directories

- `D:\Development\deepseek-harness` — read-only upstream mirror; sync only, never modify.
- This fork follows upstream `master`; keep it releasable. Feature work goes on `agent/*` branches (e.g. `agent/desktop-electron`).

## CMS rules

The governing methodology for both plugin repositories is the owner's CMS (规则) discipline. The authoritative definition of CMS rules is owner-maintained; when a plugin's behavior conflicts with it, treat the owner's CMS definition as authoritative.
