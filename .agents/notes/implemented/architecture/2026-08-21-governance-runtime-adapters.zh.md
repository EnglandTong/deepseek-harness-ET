# Agent Note: Governance Runtime 通过现有 Subagent Provider 委派

Status: implemented

[English](2026-08-21-governance-runtime-adapters.md) | 中文

## Problem

Governance 需要协调多个 coding Agent，但不能把各 Provider 协议或 Agent Loop 行为变成 Governance package 的一部分。

## Decision

Governance package 拥有实时 harness registry、确定性路由、批准状态、委派检查、报告记录、文件交接引用和独立验收。Codex、Claude Code 与 DeepSeek Harness 通过现有 DSH Subagent Provider registry 的 adapter 表示；Governance 不复制它们的 CLI、SDK 或 wire protocol。

Provider 可用性在运行时检查，并以带诊断码的 Session Event 记录。可写路由必须经过批准，委派使用父 Session 工作区，执行嵌套深度限制，转发调用方取消信号，并应用有上限的任务超时。若变更文件或交接路径解析到 Session 工作区之外，报告会被拒绝。

Governance 生命周期事实使用可回放的 Session Event，大型工作包继续保留为文件引用。package 导出只包含类型的 contributor 接口，为未来原生扩展桥预留位置；当前版本不注册原生 hook，也不修改 `agent-loop`。

## Alternatives considered

**把每个 Provider 协议复制到 Governance。** 该方案被拒绝，因为它会复制 Provider 生命周期和权限行为，并形成第二套兼容面。

**修改 `agent-loop`，把 Governance 变成核心阶段。** 该方案被拒绝，因为 Governance 仍是可选 Bundle，而现有扩展点已经支持基于 Provider 的委派。

**把 adapter 完成视为验收。** 该方案被拒绝，因为子 Agent 执行证据和独立验收具有不同权限，必须作为独立的 Session 事实保留。

## Consequences

首版依赖所选 Profile 加载相关 Subagent Provider，本 package 不包含直接 CLI fallback。运行时诊断会明确显示缺失 Provider。Session Event 词汇增加但不改变 `SESSION_FORMAT_VERSION`；文件引用规则把大型交接包留在模型上下文之外。未来原生集成可以直接面向已导出的 contributor 接口，而无需重写 Governance。

## Testing

针对 Governance 的 typecheck 和测试覆盖实时 Provider 诊断、路由、回放、工作区交接拒绝、adapter/Provider 映射及嵌套深度拒绝。完整宿主库构建包含已生成的 Governance package。
