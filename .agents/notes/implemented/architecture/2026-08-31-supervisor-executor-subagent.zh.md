# Agent Note：Supervisor 执行器桥接

Status: implemented

[English](2026-08-31-supervisor-executor-subagent.md) | 中文

## 问题

Personal Supervisor 把工作派发给异构的模型与 CLI provider，各自的生命周期词汇不同。缺少一个标准化接缝时，总控将直接看到 provider 的原生行为，而且 child 可能在项目写槽覆盖它之前就开始模型或 CLI 工作。

## 决定

Personal Supervisor 执行器包（`@deepseek-ai/dsh-supervisor-executor-subagent`）负责 Provider 注册、能力准入和生命周期结果标准化。Provider 适配器必须在启动模型或 CLI 工作前预留 child Session 身份。桥接层先取得项目宿主租约，再调用 Provider，绑定准确的 child 生命周期，并且只在结果结算和清理完成后释放租约。

## 边界

本包不重新实现 Codex、Claude Code、DSH SDK 或 ACP 协议。认证和原生进程行为仍由这些 Provider 负责，并通过 `SupervisorExecutorProvider` 注册适配器。桥接层不会授予 child 超过路由和适配器能力上限的权限。

## 测试

`packages/supervisor/supervisor-executor-subagent/tests/executor.spec.ts` 覆盖 completed、cancelled、timeout、max-token、Provider 错误、拒绝、未知原因、诊断、信号和退出码的标准化，调用前的路由门禁拒绝、权限上限拒绝、租约保留至结算、精确 child 取消、准入或启动失败时释放 Provider 准备、child 身份不匹配拒绝，以及执行器清理。包测试使用内存中的 Provider 适配器覆盖该接缝。

## 考虑过的备选

- **在桥接内重新实现 Codex/Claude Code/ACP 协议。**认证和原生进程行为由 Provider 负责；桥接层只做生命周期标准化，重复实现协议会把 Provider 必须继续拥有的行为分叉出去。
- **让 Provider 在没有租约的情况下自行附着 child 生命周期。**桥接层要求先租约后调用，且结算前永不释放，以保护单写者门禁；无租约的 Provider 生命周期会打开第二个写者进入存活项目的窗口。

## 后果

- 总控看到统一的标准化结果词汇（status、output、diagnostic、timedOut、signal、exitCode），权限上限在执行派发的操作内强制执行，而不是只信任路由。
- 本包交付注册表与标准化接缝；首个版本没有注册任何具体 Provider 适配器，Bundle 层的 Provider 集成仍归后续工作。
