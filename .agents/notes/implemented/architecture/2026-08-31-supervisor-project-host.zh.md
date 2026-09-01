# Agent Note：项目绑定的 Supervisor 执行宿主

Status: implemented

[English](2026-08-31-supervisor-project-host.md) | 中文

## 问题

child Session 无法在总控的空 cwd 上下文中安全操作另一个项目：直接 fork 的 child 会继承错误的工作区，或者只能依靠提示词层面的 cwd 纪律，没有任何持久化的准入控制。项目执行需要一个绑定项目的隐藏宿主，其按项目的准入能在重启后存活。

## 决定

`@deepseek-ai/dsh-supervisor-project-host` 负责隐藏、持久化的项目 Session 和准入 lease。它从 `ctx.supervisor` 获取精确的已登记项目快照，以稳定的隐藏身份 `supervisor-project-host:<projectId>` 创建或恢复一个 header `cwd` 等于该项目规范 `realPath` 的 Session，并且仅在准入成功后发出版本化的 `supervisor/run-linked` 记录。

宿主不创建 Agent、不调用模型、不选择 provider、不改变 cwd 继承，也不创建 Git worktree。执行器桥接（`@deepseek-ai/dsh-supervisor-executor-subagent`）在创建 child 前取得 lease，之后附着精确的取消与结束生命周期。一个项目允许一个写者和并行只读 reviewer。附着 child 后，公开 lease release 在 child 结算前不得解锁项目。卸载按 child-first 执行：取消、等待 child 结束、释放 lease、flush 并 detach 宿主。取消失败但 child 尚未结束时，写槽和宿主保留为需恢复状态；已附着 child 的结算会在安全时释放并 detach。

## 恢复

`reconcile()` 是本服务的重启入口：它消费中央持久化投影对先前链接 run 的观察。已确认存活的 child 可重新占有写槽，并返回 lease 让 provider 绑定精确生命周期。恢复 lease 在绑定前仍是未结算状态，不能释放，也不能被另一写者取代。写 run 状态不确定时抛出需恢复错误，不会自动重试或释放。

## 测试

`packages/supervisor/supervisor-project-host/tests/gate.spec.ts` 覆盖稳定宿主身份、同项目写互斥、伪造释放抵抗、只读并行、跨项目并发、恢复 host link 校验、恢复的存活 child 绑定、超时或失败结算释放、不确定写者拒绝、取消失败时保留写槽至 child 结算、跨上下文恢复宿主，以及卸载在 child drain 与宿主 detach 前关闭准入。

## 考虑过的备选

- **由总控直接 fork subagent。**总控没有项目 cwd，直接 fork 的 child 会继承错误的工作区，或者只能依靠提示词层面的 cwd 纪律，没有持久化的准入控制。
- **让宿主自己创建 Agent 并调用 provider。**宿主刻意不创建 Agent、不调用模型、不选择 provider；该职责留在执行器桥接，使宿主保持为纯粹的准入与生命周期所有者。

## 后果

- 按项目的写锁由自有 gate 强制执行，而不是任务标签约定；锁覆盖准入、执行、取消与卸载，而不只是派发。
- 隐藏宿主持久化并可跨重启恢复，但也带来必须 flush 与 detach 的按项目持久状态；需恢复状态会一直持有写槽，直到显式恢复或 child 结算——在此之前该项目的写者被阻塞。
- `reconcile()` 由包测试直接覆盖；中央持久化投影到它的生产重启接线仍归后续恢复工作所有。
