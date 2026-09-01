# Agent Note：Personal Supervisor 记忆使用事件重放和带来源的有界摘要

Status: implemented

[English](2026-08-31-supervisor-memory.md) | 中文

## 问题

Supervisor 状态必须在 compaction 和重启后存活，且不能依赖递归摘要：一旦摘要成为下一次摘要的输入，它就失去了失效路径，无界的上下文增长也不能充当存储机制。

## 决定

`@deepseek-ai/dsh-supervisor-memory` 把原始 Supervisor 事件作为重建来源，将事件折叠为结构化项目与任务状态，再从投影生成有界摘要和查询简报。摘要永远不是权威来源，也不会成为下一次摘要的输入。

## 机制

每条原始记录都有连续序号。Checkpoint 保存覆盖的序号水位、所覆盖精确记录的 SHA-256 摘要、带来源范围和证据引用的摘要，以及每个项目的治理 authority fingerprint。启动对账时，未变化的 checkpoint 会复用，追加日志只重放尾部，治理 fingerprint 改变会使相应摘要失效，保存的前缀不再匹配则完整重放。

`shouldCompactMemory()` 为现有 compaction 能力报告 token 压力。本包不修改 Session surface 历史、不写项目文件、不调用模型，也不根据执行输出推断验收。

## 测试

`packages/supervisor/supervisor-memory/tests/memory.spec.ts` 覆盖确定性重放、连续序号拒绝、摘要边界与来源、token 压力阈值、摘要不匹配、治理 fingerprint 失效、尾部重放和完整重启重放。

## 考虑过的备选

- 向量检索不能证明 revision 连续性或检测治理文件变化，因此不作为权威来源。
- 递归摘要会让过期决定和来源信息难以失效，因此不采用。
- 共享的 `supervisor/*` 事件词汇已经提供重放词汇，因此不新增第二套持久事件格式；本包只保存记忆 checkpoint 元数据。

## 后果

- 重建始终从原始事件开始，治理变化时摘要可以失效并重建；有界的摘要与简报尺寸让主助理视图保持可负担，token 压力与 compaction 执行彼此分离。
- 首个版本把原始日志保存在进程内：还没有持久化 checkpoint 的存储域适配器，也没有消费简报的主助理提示词接线——`@deepseek-ai/dsh-personal-supervisor` bundle 加载本服务，其当前唯一的外部消费者是 `@deepseek-ai/dsh-supervisor-api` 读取折叠后的 run link。checkpoint 持久化与提示词接线仍归后续组合与编排工作所有。
