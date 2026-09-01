# Agent Note: 总控交互适配器

Status: implemented

[English](2026-08-31-supervisor-interaction.md) | 中文

## 问题

主助理需要进入总控事务的人工命令入口、从其他会话转交的 `@总控` intake，以及在抵达控制器前去重的关键通知——不修改 Agent loop，也不让本包获得自己的项目状态或验收权威。

## 决策

`@deepseek-ai/dsh-tool-supervisor` 负责人工命令注册、唯一 `@总控` intake 转交和关键通知合并。它消费已冻结的 Supervisor 服务和编排器公共行为，不增加项目状态，也不修改 Agent loop。

## 测试

`packages/supervisor/tool-supervisor/tests/interaction.spec.ts` 覆盖带真实 status 派发的命令注册、dispatch 的 revision 参数、intake 去重、冷 Session 转交、通知合并和无效 intake 拒绝。

## 考虑过的备选

- **每个事件发一行通知。** 拒绝：普通进度会产生通知风暴；相同项目/任务/类别的重复事件以一行和计数呈现。
- **在本包内持久化未读/已读游标。** 暂不采纳：在后续持久通知投影负责读取游标前，未读确认有意保持进程内状态。

## 后果

13 个命令处理器使用带 revision 的编排器方法并返回有界的人类可读结果。稳定的 intake 消息 ID 会在转交前记录；唯一主 Agent 在线时收到一条 relay 消息，主 Session 冷状态时保存一条持久 `user/message` relay 供后续恢复。相同项目/任务/通知类型的重复事件以一行和计数呈现，普通进度不会产生通知风暴。

未读确认保持进程内状态：在后续持久通知投影负责读取游标之前，持久的 Supervisor 事件保持不变。若编排器没有 review 方法，本包不会冒充最终验收，而是返回明确错误。
