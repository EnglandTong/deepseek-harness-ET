# `@deepseek-ai/dsh-supervisor-memory`

[English](README.md) | 中文

本包把 Personal Supervisor 的记忆分成四个有界层次：原始 Supervisor 事件日志、结构化重放投影、带来源的滚动摘要，以及按问题生成的查询简报。事件日志和 Supervisor 投影仍然是权威来源；摘要只用于减少提示词长度，不能作为验收证据。

`projectSupervisorMemory()` 将 WO-01 的 `SupervisorMemoryRecord` 连续事件重放为投影，并附加 `supervisor-project-state` 提供的最新只读治理状态。`summarizeSupervisorMemory()` 直接从投影生成项目事实，因此不会递归摘要旧摘要。每份摘要都记录任务 revision、来源序号范围、事件/运行/策略/治理引用，以及生成时使用的 authority fingerprint。

`reconcileSupervisorMemory()` 会把持久化 checkpoint 与当前事件前缀和治理 fingerprint 对账。前缀一致时复用，日志变长时只重放尾部，治理来源改变时使受影响摘要失效，前缀被修改或截断时执行完整重放。checkpoint 不确定或无效时直接拒绝，不静默信任。

`SupervisorMemoryService` 监听版本化的 Supervisor 事件，在初始化时重放已有 Supervisor Session，并向编排和 Host API 层提供相同的投影和摘要函数。其记忆序号属于 Supervisor 事件流本身，因为普通对话事件可能占用其他 Session 序号。

`shouldCompactMemory()` 只判断 token 压力是否应调用现有的 `ctx.compaction` 扩展点。本包不改写 Session surface 消息、不调用模型、不写项目文件，也不替代持久 Session 日志。

## 模型体验

### Supervisor 记忆简报

#### 模型能看到什么

主助理可以收到有界查询简报，其中包含当前项目状态、任务状态、阻塞、唯一下一步、待确认事项、未读通知和来源引用。除非调用者明确请求证据，否则不会收到隐藏推理或完整原始日志。

#### Token 影响

摘要直接从结构化投影生成，并受 `maxSummaryChars` 限制；简报受摘要数量和通知数量限制。Token 压力根据配置的上下文上限和预留响应预算计算。

#### KV Cache 影响

稳定的 Map 插入顺序、确定性的事件摘要和固定的摘要字段顺序，使权威日志与治理 fingerprint 不变时的重复简报更利于缓存。

## 已知限制与后续工作

- **没有持久化后端：** 调用方必须通过 Session 或存储所有者持久化 `SupervisorMemoryCheckpoint`；本包只负责校验和对账，不选择存储域。
- **没有模型摘要器：** 当前摘要使用确定性的结构化事实。后续 provider 可以替换展示文本，但必须保留来源范围和 revision 引用。
- **不拥有最终验收：** 执行报告、复核结果和用户验收仍由独立 Supervisor 事件负责，摘要不会推断这些结论。
- **向量不是权威来源：** 后续可以增加语义检索作为加速器，但不能替代事件重放或治理 fingerprint 检查。
