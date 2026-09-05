---
description: "通过 helper LLM purpose（input-optimize）清理 composer 草稿，并可选地做本地语音转写的 Remote 服务。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-input-optimize

[English](README.md) | 中文

## 摘要

桌面与网页 composer 可在草稿成为已记录用户消息之前先清理。`inputOptimize/optimizeText` 在已配置的 helper 路由上以 `purpose: 'input-optimize'` 调用 `ctx.llm`（桌面在 sidecar 健康时钉住 `local-edge`）。`inputOptimize/transcribe` 可选地运行本地 STT 二进制（`DSH_LOCAL_STT_BIN` 或 `sttBin`）。`inputOptimize/status` 向 Client 控件报告可用性。`inputOptimize/helperMode` 与 `inputOptimize/setHelperMode` 读写 `$DSH_HOME/desktop-helper-mode.json`，供设置切换 cloud/local/off（需重启）。优化后的文本返回 Client 供确认；Host 不追加会话事件。

## 使用本包

经 [`api-remotes`](../../api/remotes/README.zh.md) 以 `ctx.remote.inputOptimize` 消费。web bundle 默认休眠挂载（`enabled: false`），直到 `--patch` 或 cordis 配置启用。当 `provider`/`model` 为空时，optimize 跟随 `ctx.agentDefaultModel`（设置 → 模型）。

## 模型体验

仅辅助 helper 调用。清理后的草稿仅在用户于 composer 确认发送后进入主 agent（model-visible ⟺ logged）。

#### KV 缓存影响

对主聊天路由无影响；helper 调用是独立的 `purpose: 'input-optimize'` 流。

#### 运行时不变量

不发布 runtime invariant companion：可用性是配置与 llm 在场检查，而非独立观测对。

## 已知限制与延后工作

- 本地 STT 通过外部二进制约定可选接入（`--input <path>` → stdout 文本）；默认安装包不捆绑引擎。
- MAA / 多 agent 下一步策略选用哪个 helper 模型留在插件仓库；本包只暴露草稿/STT 缝。
