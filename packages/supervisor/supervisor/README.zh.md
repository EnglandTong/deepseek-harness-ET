# `@deepseek-ai/dsh-supervisor`

[English](README.md) | 中文

Personal Supervisor 服务定义拥有一个控制器 Session 协调已登记项目时使用的类型词汇。它不创建 Agent、不读取项目文件、不路由模型，也不渲染 UI；这些职责由后续包提供。

本包导出品牌化标识符、带 revision 的快照、合法任务状态转换函数、可重放的事件校验与折叠函数，以及 `ctx.supervisor` 提供方注册表。注册通过 Cordis effect 完成并返回 disposer。

## 状态生命周期

`Captured → Classified → AwaitingApproval | Ready → Dispatched → Running → NeedsOwnerDecision | NeedsFix | ReadyForReview | Failed | Cancelled`。批准、返修和审查转换都是显式的；执行器报告不会在没有独立权限动作时成为 `Accepted`。

## Model Experience

### Supervisor contract

#### What the model sees

模型看到的是带类型的 `SupervisorService` 身份、快照、`supervisor/task` 事件和合法转换。本包不提供项目文件或生产工具；后续消费者决定何时加载治理上下文以及派发执行器。

#### Token effect

本包只增加少量固定的 schema 和状态词汇；项目历史由后续消费者按需加载。

#### KV Cache effect

只要契约和事件词汇不变，提示词前缀保持稳定。

## Known Limitations and Deferred Work

- **没有持久化提供方**——WO-02 和 WO-09 提供持久 Session 恢复与投影；本包只定义共享契约。
- **没有执行器实现**——模型和 CLI 选择属于路由与执行器包。
