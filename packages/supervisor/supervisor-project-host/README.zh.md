# `@deepseek-ai/dsh-supervisor-project-host`

[English](README.md) | 中文

本包为每个已明确登记的项目维护一个隐藏、持久化的 Session。它的 Session header 使用登记表中的精确 `realPath` 作为 `cwd`；不改变普通 subagent 的 cwd 继承规则，也不创建 Git worktree。

执行器创建 child 前必须调用 `admit()`。同一项目的写权限 lease 互斥，但任意数量的只读 reviewer lease 可与写者并行。生成的 `SupervisorRunLink` 关联任务、项目宿主和精确 child Session。执行器将 child 生命周期附着到 lease；在 child 结算前，公开 release 会被拒绝。child 结束、成功取消和插件卸载只会释放对应 run。取消抛错而 child 尚未结束时，宿主会把写槽与 Session 保留为需恢复状态，直到附着的 `done` Promise 结算；绝不会冒险允许并发写者。

重启后，中央投影把持久化链接交给 `reconcile()`。每个已确认存活的 child 都会返回一个恢复 lease，使 provider 能附着精确生命周期并最终释放写槽。恢复 lease 在附着前仍保持锁定：存活不等于已结算。未能证明 child 仍存活的写 run 会抛出 `SupervisorProjectHostRecoveryRequiredError`；本包不会静默重试或释放不确定工作。

## 模型体验

### 项目执行宿主

#### 模型可见内容

主助理提示词不增加任何内容。宿主是非模型的 Session 生命周期所有者；后续执行器包使用它获得隔离的项目 cwd 和准入 lease。

#### Token 影响

宿主元数据和 run link 是结构化运行时记录，不会把项目文件或 child transcript 复制到总控上下文。

#### KV Cache 影响

稳定的宿主 Session ID 避免执行器每次恢复工作时重新描述项目 cwd。任务简报和对话压缩由后续包负责。

## 已知限制与延期工作

- 本包不启动模型、不调用 CLI provider，也不决定路由；WO-07 会附着具体 child 生命周期。
- 持久链接投影和安全重启策略由编排与记忆包提供。本包拒绝不确定的恢复写者，不会猜测。
- 宿主 Session 仅是隐藏基础设施；Host API 和只读 child UI 属于后续工单。
