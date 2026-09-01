# Agent Note: 总控 Host API 投影

Status: implemented

[English](2026-08-31-supervisor-api.md) | 中文

## 问题

客户端表面需要读写总控的项目、任务、运行和通知事实，但不能在现有 API 载体旁新增第二条传输，也不能暴露隐藏推理、凭证、原始 stderr 或项目文件修改。派发与批准的权威必须留在编排和交互服务中。

## 决定

`@deepseek-ai/dsh-supervisor-api` 提供面向 Host 的投影服务（`ctx.supervisorApi`），投影总控拥有的项目、任务、运行和通知事实。`packages/host/apiproxy` 将其作为可选的 `supervisor.*` 领域投影到现有 ApiProxy 四象限 RPC 载体上：挂载方式是向 `createApiProxy` 提供宿主拥有的读／控制端口（`SupervisorApiProvider`）；当 Personal Supervisor 组合未挂载时，每个 supervisor 方法都以 `supervisor-unavailable` 失败关闭。API 网关不拥有编排状态或子会话生命周期。

响应以 `version: 1` 标记版本。读取端点暴露单例身份以及带状态、项目、任务和未读过滤的项目／任务／运行／通知快照。用户审阅由乐观 revision 检查保护：每个动作携带 `expectedRevision`，到达控制端口的陈旧任务 revision 返回带期望值与实际值的 `supervisor-conflict`。客户端子会话引用明确标记 `readOnly: true`；transcript 的读取和写入仍由已有 Session API 负责。投影不暴露隐藏推理、凭证、原始 stderr 或项目文件修改。

## 测试

`packages/host/apiproxy/tests/api-proxy-supervisor.spec.ts` 覆盖版本化请求／响应解析（在客户端边界拒绝未带版本和畸形的值）、失败关闭的未挂载组合、项目／任务／运行／通知过滤、只读子会话引用，以及从控制端口透传的陈旧 revision `supervisor-conflict`。

## 考虑过的备选

下列传输与状态权威备选与 [Personal Supervisor 宿主 API 与客户端运行时](2026-08-31-supervisor-host-api-client-runtime.md)属于同一决策域，由该笔记成对记录。

- **新增第二条 HTTP 端点。** 拒绝：现有载体已提供信封关联、边界 schema、取消和客户端投影规则。
- **客户端任务状态机。** 拒绝：任务 revision 和生命周期权威属于 Host Supervisor 组合。
- **在 Supervisor 端点返回子会话 transcript。** 拒绝：这会复制 Session 历史并削弱现有只读 subagent 边界。
- **每个事件发一行通知。** 拒绝：普通进度会产生通知风暴；相同项目/任务/类别的重复事件合并为一行并带计数。

## 后果

- 客户端 Dashboard 在它已经使用的载体上获得一个类型化、带版本的读／控制面；用户动作以任务 revision 做比较并设置（compare-and-set），陈旧客户端无法对已变化的任务执行动作。
- 该领域只是投影：transcript 内容与派发／批准留在 Session API 与编排／交互服务之后，未挂载的 Supervisor 报告 `supervisor-unavailable`，而不是退化为残缺或捏造的数据。
