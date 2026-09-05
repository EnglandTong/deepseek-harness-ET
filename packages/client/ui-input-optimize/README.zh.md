---
description: "composer 左侧 Optimize / Voice 控件：经 inputOptimize Remote 清理草稿或本地听写。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-input-optimize

[English](README.md) | 中文

## 摘要

在 `conversation.input.left` 注册 Optimize 与 Voice 控件。Optimize 调用 `ctx.remote.inputOptimize.optimizeText` 并替换 composer 草稿，供发送前显式确认。Voice 在浏览器录制音频、调用 `transcribe`，再以同样方式填入草稿。当 `status` 报告 helper 或 STT 不可用时控件保持禁用（无桌面 sidecar / 无 STT 二进制）。

## 模型体验

不直接面对模型；helper 调用在 Host 侧。用户可见的草稿变更在发送前不是 model-visible。

#### KV 缓存影响

无。

#### 运行时不变量

不发布 runtime invariant companion；Remote 可用性是 Host 配置探测。

## 已知限制与延后工作

- 刻意不做优化后自动发送；日后可用 Settings 驱动 auto-send。
- STT 依赖 Host 配置的本地二进制；仅有浏览器 MediaRecorder 不会产生文本。
