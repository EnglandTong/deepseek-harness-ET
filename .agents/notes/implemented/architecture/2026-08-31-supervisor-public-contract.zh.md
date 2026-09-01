# Agent Note: 冻结 Personal Supervisor 公共契约

Status: implemented

[English](2026-08-31-supervisor-public-contract.md) | 中文

## Problem

后续的 Session、注册表、路由、编排和客户端包需要对 Supervisor 身份、项目/任务/运行快照、通知、事件和任务状态转换使用同一套词汇。如果每个包自行发明字段，重放和 revision 检查就无法提供唯一权威的项目组合状态。

## 决定

`@deepseek-ai/dsh-supervisor` 发布为只负责契约的 seam。品牌化标识符（`SupervisorId`、`SupervisorProjectId`、`SupervisorTaskId`、`SupervisorRunId`、`SupervisorNotificationId`）防止不同领域 ID 混用；带版本事件载荷（`SUPERVISOR_EVENT_VERSION`）在重放前校验；`foldSupervisor` 应用连续 revision 和冻结的任务状态表（`assertTaskTransition`）；`SupervisorService` 只暴露带类型的提供方注册表，注册返回 disposer，同时持有中央项目/任务投影，并通过 `restoreLedger` 恢复持久总账。本包不执行文件系统、模型或 Agent 工作。

## 已考虑的替代方案

- 不复用实验性 Agent Teams 类型，因为其任务生命周期和共享 checkout 假设不同于跨项目总控。
- 不把状态保留为无类型字符串，因为非法转换和 revision 跳跃会变成运行时猜测。
- 不让 Supervisor 服务拥有持久化，因为 WO-02 和 WO-09 负责生命周期与投影存储。

## 后果

下游包共享同一套词汇，重放和 revision 检查为每个消费者提供同一份权威项目组合状态。代价是现在修改这些字段需要对所有下游包做协调迁移；事件版本和 revision 规则因此保持显式。重放也无法恢复执行，状态表因此在重启对账时把每个被打断的任务交给 Owner 成为 `NeedsOwnerDecision`。

## 测试

`packages/supervisor/supervisor/tests/supervisor.spec.ts` 钉住所有记录的任务边（跳跃和终止边失败）、确定性重放并拒绝 revision 跳跃、持久边界上的事件版本与 revision 校验、重复身份事件拒绝，以及重复/空提供方名称拒绝和只移除自身注册的 disposer。
