# Agent Note：Personal Supervisor 总控循环

Status: implemented

[English](2026-08-31-supervisor-orchestrator.md) | 中文

## 问题

总控需要一个有界的任务循环：不能自动接受工作，也不能在重复失败上无限循环。用户决定、过期 revision 和返修次数需要唯一的所有者，并且提示词与 child 输出不得进入其结构化状态。

## 决定

`@deepseek-ai/dsh-supervisor-orchestrator` 负责总控任务循环。它捕获请求、解析已注册路由、合并用户确认，并通过执行器桥接派发工作。任务快照以版本化 Supervisor 事件发布，所有用户操作都会校验其所查看的任务 revision。

完成的执行进入 `ReadyForReview`；本服务不会把执行结果提升为 `Accepted`——`Accepted` 只由用户显式的 `review()` 决定发布。失败执行使用确定性签名分类，并且最多按配置进行限定次数的返修。重复签名会发送阻塞通知并停止自动返修。销毁时取消准确的活动句柄并清理进程内控制状态。

启动时把恢复的总控账本重放进任务状态，并将无法继续执行的任务以 `NeedsOwnerDecision` 交还给用户。重放后，编排器还会把账本中每个持久 `run-linked` 记录馈送给项目宿主的 `reconcile()`：宿主自行证明或拒绝每个先前 writer；`recovery-required` 的 run 得到一条 `owner-decision` 通知，其余项目的已结算读 run 照常释放。馈送始终传入 `childIsLive: false`——账本只证明曾有子会话，不证明它仍存活——因此每个先前 writer 都交还给用户，而不是猜测可继续执行。

## 测试

`packages/supervisor/supervisor-orchestrator/tests/orchestrator.spec.ts` 覆盖捕获、确认批次、过期 revision 拒绝、一次返修后重复签名停止，以及 revision 保护的 follow-up。`tests/orchestrator-reconcile.spec.ts` 覆盖重启馈送：挂载宿主收到准确一个 `run-linked` 恢复观测（`childIsLive: false`），中断任务升级为 `NeedsOwnerDecision`，且恰好发出一条用户通知；未挂载宿主时馈送为无操作。

## 考虑过的备选

- **执行完成时直接发布 `Accepted`。**执行结果最多只能到达 `ReadyForReview`；接受是单独的用户动作，经由 `review()` 完成。
- **失败时无限次返修。**重复失败签名必须阻塞自动返修并通知用户，而不是继续消耗返修次数。

## 后果

- 循环在两端都有界：只有策略批准的低风险路由可以自动派发，重复失败通知用户而不是无限消耗次数。
- 确认批次保存在进程内存中，启动时从恢复的账本重建；失败签名不持久化，因此次数上限在重启后仍然封顶自动返修。持久化确认投影与 child reviewer 流程仍归后续工作。
- 重启对账现在有了生产调用点：编排器 init 馈送账本 run link 给项目宿主，宿主的拒绝（recovery-required）转化为一条用户通知，剩余项目继续对账。宿主侧的写入闸门语义不变。
- Host API 与 Bundle 装配已由下游交付：`@deepseek-ai/dsh-supervisor-api` 和 `@deepseek-ai/dsh-personal-supervisor` bundle；提示词与 child 输出不出现在总控发布的任务快照中。
