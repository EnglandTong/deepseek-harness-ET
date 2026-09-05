# Agent Note: Fork charter 允许桌面产品所需的 harness 补丁

Status: implemented

[English](2026-09-04-fork-charter-desktop-product-patches.md) | 中文

## 问题

原 charter 读起来像「只做桌面，其余一律跟上游」，但树里已有业主需要的 harness 增量（workspace snapshot / multi-edit、MCP `startupTimeoutMs`），与桌面壳、网页插件导入并存。边界不清：这些增量算违规，还是产品支撑。

## 决策

**[FORK-CHARTER.md](../../../FORK-CHARTER.md) 仍以桌面壳与网页插件导入为主范围，并增加明确的「桌面产品 harness 补丁」允许名单，可留在本仓。** 现行名单以 charter 条目为准（当前含：workspace snapshot/multiedit、MCP `startupTimeoutMs`、SEA/`moduleFallback` 下的 client module 启动、sdk-runtime 配置层闭包、以及桌面 local-edge sidecar + helper purpose / input-optimize）。新增例外须在同一次变更里更新该名单。独立插件产品（governance multi-agent、master-agent assistance）不进本树；Studio 与仓内 governance bundle 保持移除。

## 备选方案

- **严格只留桌面并清掉补丁。** 暂否：业主选择先保留现有产品支撑补丁，而不是立刻迁仓或上游化。
- **开放「任意 harness 补丁」。** 否决：无名单则无法在上游同步时约束扩散面。

## 影响

根目录 `AGENTS.md` 指向同一规则。服务桌面/网页产品的 snapshot/MCP 工作可继续在本仓；能力型产品仍去独立插件仓。扩大允许名单必须是有意的 charter 修改，不能靠静默漂移。
