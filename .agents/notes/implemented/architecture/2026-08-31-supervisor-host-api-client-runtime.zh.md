# Agent Note: Personal Supervisor 宿主 API 与客户端运行时

Status: implemented

[English](2026-08-31-supervisor-host-api-client-runtime.md) | 中文

## 问题

Personal Supervisor 需要一条从 Host 事实到浏览器 Dashboard 的统一投影路径：读取项目、任务、运行和通知快照，并提供用户动作的控制路径——不新增第二条传输，不让客户端成为任务状态权威，也不让子会话 transcript 内容流经 Supervisor 表面。

## 决策

Personal Supervisor 通过现有 ApiProxy 四象限 RPC 载体投影。`supervisor.*` 领域为可选能力，由 `createApiProxy` 接收宿主拥有的读／控制端口后提供；API 网关不拥有编排状态或子会话生命周期。

响应携带 `version: 1`。读取端点暴露单例身份、项目／任务／运行快照、关键通知和只读子会话引用。用户动作携带 `expectedRevision`；陈旧任务 revision 到达控制端口时返回 `supervisor-conflict`。客户端子会话引用明确标记 `readOnly: true`；transcript 的读取和写入仍由已有 Session API 负责。

浏览器运行时暴露 `SupervisorRuntime` 和一个可观察的 `SupervisorClientState`。它刷新有界快照，保留传输／业务错误供界面显示，并且只通过类型化 API 客户端发送动作。它不会根据标题折叠任务状态，也不会将对话历史复制进模型请求。

## 测试

`packages/host/apiproxy/tests/api-proxy-supervisor.spec.ts` 覆盖版本化请求／响应解析、可选组合未挂载、项目／任务／运行／通知过滤、只读子会话引用和陈旧 revision 拒绝。`packages/client/runtime/tests/supervisor.client.spec.ts` 覆盖刷新替换、保留错误状态、动作后的刷新以及只读子会话引用。

## 考虑过的备选

- **新增第二条 HTTP 端点**，被拒绝，因为现有载体已经提供信封关联、边界 schema、取消和客户端投影规则。
- **客户端任务状态机**，被拒绝，因为任务 revision 和生命周期权威属于 Host Supervisor 组合。
- **在 Supervisor 端点返回子会话 transcript**，被拒绝，因为这会复制 Session 历史并削弱现有只读 subagent 边界。

## 后果

- Supervisor 流量使用客户端已有的载体，用户冲突以显式 `supervisor-conflict` 错误呈现，而不是客户端与 Host 视图之间的静默分歧。
- 浏览器运行时保持为薄的可 revision 缓存：它只持有最近收到的快照并在每次动作后刷新，因此客户端不做任何任务推理，不可用的 Supervisor 呈现为错误，而不是陈旧或捏造的状态。
