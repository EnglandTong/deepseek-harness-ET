# `@deepseek-ai/dsh-tool-supervisor`

English | [English](README.md)

本包是 Personal Supervisor 的人工交互适配器。它注册 11 个 `supervisor_*` 命令，为主助理和 UI 提供有界的项目/任务状态，将路由批准和 Owner 返修转交给编排器，并合并关键通知。

命令集合为 `supervisor_status`、`supervisor_projects`、`supervisor_tasks`、`supervisor_register_project`、`supervisor_route`、`supervisor_approve`、`supervisor_reject`、`supervisor_dispatch`、`supervisor_followup`、`supervisor_interrupt`/`supervisor_cancel` 和 `supervisor_review`。

`SupervisorInteractionRuntime.receiveIntake()` 是唯一的 `@总控` 转交入口。它校验来源会话和调用方消息 ID，去重重试；主助理 Agent 在线时向其发送已准入消息，Agent 冷状态时则将 relay 消息追加到唯一主 Session。它不会复制来源对话历史。

通知投影只消费关键的 `supervisor/notification` 事件。同一个项目、任务和通知类型的重复事件会合并并累加计数；普通任务进度不会变成通知。子 Agent 的执行报告仍只是报告，不能被这些命令直接验收。

## 模型体验

### 总控交互

#### 模型看到的内容

主助理看到精简的命令结果、明确的 intake relay 消息和关键通知。本适配器不会向它传递来源对话历史、隐藏的提供方推理、凭证或子 Agent 的 stderr。

#### Token 影响

状态和任务命令返回有界文本。Intake 只包含来源 ID 和提交文本。重复关键通知以一行和计数表示。

#### KV Cache 影响

稳定的命令名和精简通知行使总控前缀保持可预测，项目细节留在任务和记忆投影中。

## 已知限制与后续工作

- route 命令只评估现有任务的当前路由；任务捕获仍由编排器负责。
- review 记录委托给可选的编排器方法；未挂载该提供方时返回明确错误。
- 未读确认是进程内状态；持久通知事件仍是重启对账的权威来源。
- Bundle 组合、Host API 投影和 Dashboard 由后续工单负责。
