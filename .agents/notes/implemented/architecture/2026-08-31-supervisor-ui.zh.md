# Agent Note: 总控 Dashboard 客户端模型

Status: implemented

[English](2026-08-31-supervisor-ui.md) | 中文

## 问题

客户端需要一个基于 Host API 投影的单一 Dashboard 模型，其状态绝不覆盖 Host 权威，子会话也只能以只读引用表示——客户端不做任务推断，也不在 Host 之外出现第二个状态权威。

## 决策

客户端模型消费 Host API 投影，为单一主助理 Dashboard 分组任务卡。子会话仅以只读 ID 表示；用户审阅调用携带当前显示的任务 revision。客户端状态不会覆盖 Host 权威状态。

`packages/client/ui-supervisor` 实现该模型：它消费运行时的 `SupervisorClient`（有界快照之上的可观察 `SupervisorClientState`），并把 React 的 `SupervisorDashboard` 挂载到 web 客户端的 `sidebar.footer.action` 槽位。approve、reject、rework、pause、continue 控件以渲染出的任务 revision 发送比较并设置（compare-and-set）动作；陈旧 revision 会被上报且不会覆盖卡片，Host 不可用时显示错误而不是捏造的数据。

## 测试

`packages/client/ui-supervisor/tests/dashboard.client.spec.tsx` 覆盖项目、任务状态和通知的单一 Dashboard 渲染、携带渲染 revision 的比较并设置动作、只读子会话展开，以及不捏造项目状态的 Host 错误态。

## 考虑过的备选

- **在客户端从子会话标题或对话内容推断任务状态。** 拒绝：客户端状态绝不覆盖 Host 权威，且子会话仅以只读 ID 表示。

## 后果

- Dashboard 只渲染 Host 投影的内容：有界快照把 token 与 KV-cache 影响保持在零，客户端发送的每个动作都以显示的 revision 做比较并设置保护。
- 模型本身与框架无关，但把它绑定到视图是每个表面各自的工作：已发布的挂载是 DeepSeek web 客户端侧边栏底部的 React Dashboard，其他客户端表面需要自行绑定同一模型。
