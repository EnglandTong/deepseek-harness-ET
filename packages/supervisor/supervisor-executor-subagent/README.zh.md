# `@deepseek-ai/dsh-supervisor-executor-subagent`

[English](README.md) | 中文

本包是 Personal Supervisor 的执行器接缝。它为进程内模型、Codex、Claude Code、DSH SDK 或 ACP 注册适配器，并将路由请求转换为项目宿主准入。适配器必须在启动 Provider 工作前预留 child Session 身份，使宿主的单写者门禁覆盖启动、执行、取消和清理全过程。

`SupervisorExecutorService.dispatch()` 会拒绝未获准派发的路由、不支持的 Provider、超过适配器权限上限的请求、不支持后台执行的适配器，以及不支持取消的适配器。Provider 启动失败会释放租约。已发布运行会一直持有准确的宿主租约，直到结果和清理完成；取消只针对该运行。

## 模型体验

### 执行器桥接

#### 模型看到什么

主助理只接收紧凑的执行结果：状态、Provider/模型身份、诊断信息，以及后续 Reporter 提供的证据引用。它不会接收隐藏推理或原始凭证。

#### Token 影响

桥接层不会把 child transcript 复制到总控提示词；完整输出保留在 child Session 中，只对单次终态结果做标准化。

#### KV Cache 影响

在路由变化前，稳定的执行器名、Provider 名和路由版本会让重复派发记录保持前缀稳定。

## 已知限制与后续工作

- Provider 包必须实现 `prepare()`，在启动前预留 child Session 身份；本包不重新实现外部 CLI。
- 集成 Bundle 将注册具体的 Codex、Claude Code、DSH SDK 和 ACP 适配器；认证仍由各原生 Provider 负责。
- 结果标准化会分别记录超时、信号和退出码，不会从执行完成推断用户验收。
