# Fork Charter — deepseek-harness-ET

This repository is the working fork of [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness). Owner: EnglandTong.

## Role (owner-defined)

> 这里以官方 harness 为底座，做 Windows 桌面端，并允许为桌面/网页产品体验保留少量必要的 harness 补丁；业务型插件能力不放在本仓长期发展。
> Build on the official harness for a Windows desktop product. Small harness patches required by that product may stay here. Full plugin-capability products do not live here long-term.

## What belongs here

- **Desktop product shell**: `apps/desktop` — thin Electron window that starts `dsh web --no-open`, shows the official Web UI, and ships primarily as a Windows **NSIS installer** (bundled sdk-runtime + host `pnpm`; Portable is available but deferred for day-to-day distribution).
- **Web plugin-bundle import**: `packages/host/plugin-import` and `packages/client/ui-settings-plugin-import` (Settings → Plugins → Import, with hot-apply when possible).
- **Desktop-product harness patches** (explicit exceptions to “track upstream only”): small, product-supporting changes that the desktop/web surface needs and that are **not** a standalone plugin product. Current allowlist:
  - Workspace snapshot + multi-file edit seam (`packages/fs/snapshot`, `snapshot-local`, `tool-snapshot`, `tool-multiedit`, and their wiring).
  - MCP client `startupTimeoutMs` (`packages/mcp/mcp-client`).
  - Client module boot under SEA/`moduleFallback` proxies (`packages/client/modules`): resolve `dsh.client` and the browser `./client` artifact from the fallback target so installed `dsh web` is not an empty `__DSH_BOOT__`.
  - Desktop runtime closure includes profile bundles (`python/sdk-runtime`: `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, and required workspace peers) so installed `dsh web` resolves layers without a checkout.
  - Desktop local LLM sidecar lifecycle (`apps/desktop` spawn/health/stop of an OpenAI-compatible localhost server) plus helper-purpose tags (`input-optimize`, `context-assist`) and the input-optimize Host/Client seam for voice/text draft cleanup before the composer commits a user message. Model selection and MAA/governance next-step policy stay in plugin repositories.
  Adding another exception requires updating this list in the same change.

Everything else tracks upstream `master` unless listed above.

## What does NOT belong here

- **Plugin capability products** (Service Definition / Provider / Consumer seams that are themselves a product) live in the standalone plugin repositories:
  - [governance-multi-agent-harness](https://github.com/EnglandTong/governance-multi-agent-harness) — 以 CMS 规则管理开发进度，并管理各大模型和 Agent。
  - [master-agent-assistance](https://github.com/EnglandTong/master-agent-assistance) — 以 CMS 规则当总控：单一对话 Agent 管理所有开发项目，作为使用者的助理。
- Do not reintroduce an in-repo governance / multi-agent routing bundle, or a Studio-style parallel desktop UI. Those were removed from this tree on purpose.

## Relationship to the other two directories

- `D:\Development\deepseek-harness` — read-only upstream mirror; sync only, never modify.
- This fork follows upstream `master`; keep it releasable. Feature work goes on `agent/*` branches.

## CMS rules

The governing methodology for both plugin repositories is the owner's CMS (规则) discipline, authored as the `cms-project-governance` skill at `D:\Development\ClawSkills\ClawSkills\skills\cms-project-governance` (Work Orders, single-writer governance, authority sharing, independent QA). That skill is the authoritative definition; the companion `agent-loop-engineering` skill governs loop execution. When a plugin's behavior conflicts with them, the skills win.
