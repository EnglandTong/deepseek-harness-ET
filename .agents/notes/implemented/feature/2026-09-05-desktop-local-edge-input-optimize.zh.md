# Agent Note: Desktop local-edge helper and input-optimize seam

Status: implemented

[English](2026-09-05-desktop-local-edge-input-optimize.md) | 中文

## Problem

桌面产品需要机上小模型做草稿清理、可选语音转写与 compaction 摘要，而不把敏感草稿送到云端主聊天路由。插件产品（MAA / governance）需要稳定的 helper purpose 与路由身份以便日后选模型，而不在那些仓库里拥有 Electron 生命周期。

## Decision

**本 fork 拥有 local-edge 基础能力；插件拥有模型选择与下一步策略。**

Desktop（`apps/desktop`）可选地启动或复用 OpenAI 兼容的本机 sidecar（`sidecar.js` + `resources/sidecar/`），或启用跟随 **设置 → 模型** 所选路由的云端 helper（产品预设为 DeepSeek），或关闭 helper。NSIS Setup 向导写入 `$INSTDIR/resources/helper-mode.json`（`mode: cloud | local | off`）。安装后可通过 **设置 → 通用 → Helper 模式** 写入 `$DSH_HOME/desktop-helper-mode.json`（仅被 `DSH_HELPER_MODE` 压过）。helper 就绪时写入 `$DSH_HOME/desktop-helper.patch.yml`，并以 `dsh web --no-open --patch …` 启动。local 模式软失败是强制的：缺二进制或缺权重从不阻挡 Web UI。

`GenerateOptions.purpose` 在 `compaction` / `session-title` 之外包含 `input-optimize` 与 `context-assist`。Host 包 `@deepseek-ai/dsh-host-input-optimize` 暴露 Remote `status` / `optimizeText` / `transcribe` / `helperMode` / `setHelperMode`。Client 包 `@deepseek-ai/dsh-client-ui-input-optimize` 在 `conversation.input.left` 挂载 Optimize / Voice，并在设置中挂载 Helper 模式行；优化后的文本替换草稿，发送前显式确认（model-visible ⟺ logged）。

权重与 STT 引擎不进入默认 NSIS 包（download-on-enable / 环境路径）。不硬编码 Spark X2.5；`model` / `modelPath` 是配置。可选 Spark（Apache-2.0，Copyright 2026 XHToken）与 llama.cpp（MIT）的版权说明见 `apps/desktop/resources/THIRD_PARTY_NOTICES.md`。MAA 与 governance 在各自仓库消费 `context-assist` / 路由选择。

Charter allowlist 条目：桌面 local LLM sidecar 生命周期 + helper purpose + input-optimize Host/Client 缝。

## Alternatives considered

- **在 Electron 里硬编码 Spark X2.5。** 否决：fork 交付能力与稳定路由 id；权重由插件与运维选择。
- **把数 GB 权重打进 NSIS。** 否决默认包体体积；download-on-enable 保持安装包精简。
- **把下一步路由放进本 fork。** 被 [FORK-CHARTER.md](../../../FORK-CHARTER.md) 否决；业务路由留在 MAA / governance。
- **在 `ctx.llm` 之外另造一套 LLM 栈。** 否决：复用 `dsh-llm-pi-ai` 的 OpenAI 兼容路由与已有双模型模式（compaction / session-title）。

## Consequences

贡献者通过 `DSH_LOCAL_EDGE_BIN` / `DSH_LOCAL_EDGE_MODEL_PATH`（或 `resources/sidecar/bin` + `config.json`）演练 helper；没有它们时 Optimize / Voice 保持禁用且聊天仍可用。安装后可通过设置 → Helper 模式写入 `$DSH_HOME/desktop-helper-mode.json`，并需重启桌面应用。插件作者调用 `ctx.llm.stream({ purpose: 'context-assist', … })` 或为 MAA/governance 配置路由，无需改桌面壳。验证：Host 单测 Remote 方法发布与 home 级 helper-mode 覆盖；sidecar 缺失时的桌面软失败路径；`apps/desktop/README.md` 中的三模式冒烟清单。

## Related

- 薄桌面壳：[2026-09-03-web-thin-desktop-shell.zh.md](./2026-09-03-web-thin-desktop-shell.zh.md)
- Fork charter 允许名单：[../process/2026-09-04-fork-charter-desktop-product-patches.zh.md](../process/2026-09-04-fork-charter-desktop-product-patches.zh.md)
