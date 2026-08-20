# Agent Note: 工作区快照与原子多文件编辑

Status: implemented

[English](2026-08-19-workspace-snapshots-and-multi-edit.md) | 中文

## Problem

harness 没有工作区回滚能力。所有编辑工具都是单文件、无跨文件原子性，模型在五文件重构进行到一半失败时，留下的工作区状态只有会话日志能描述、却没有任何机制可以撤销——用户的恢复路径是 `git checkout` 或手工修复。这个缺口正是 Cursor Checkpoints 与 Trae 快照在同类产品中填补的：一个廉价、会话作用域的时间点，agent 可以返回。此前已有两个名字被占用：`dsh-session-checkpoint-policy` 用 "checkpoint" 指日志持久化，fs 缝隙里的 "snapshot" 读作瞬时树拷贝——都不匹配一个懒捕获、经写路径恢复的能力。

## Decision

交付 `ctx.snapshots` 能力缝隙，加一个本地 Provider 与两个工具 Consumer，全部是构建在既有 fs 机制上的普通插件——没有新事务层，不改 fs Service Definition。

- **捕获挂在 `fs/write-intent`/`fs/edit-intent` 瀑布上。** Provider 注册 `prepend: true` 监听；目标在某个快照创建后的首次变更时，变更前内容在 `next()` 之前被读取，并记录进**每一个**尚未跟踪该目标的存活快照。预像等于每个这类快照的创建时刻状态，因此不存在继承步骤，也没有需要崩溃恢复的 head 指针。监听始终调用 `next()`；捕获失败降级为诚实的 `unmanaged` 条目，而不是否决变更。
- **存储是内容寻址的**（sha256 blob 跨快照去重，每快照一个 JSON manifest，位于 `dshHomePath('snapshots')/<sessionId>/`），manifest 写入经临时文件 + rename 并按会话排队，并行工具调用无法交错读-改-写周期。
- **恢复重入 fs 写路径**——先用自身读取预置 `fs/observed`，再以合成 `{ agent }` actor 分发 `fs/write-intent` 瀑布，并传入逐调用沙箱策略——捕获、观察策略与沙箱围栏的参与方式与工具写入完全一致。破坏性恢复需要审批服务；`rollback: true`（保留给非模型调用方的原子自回滚标记）跳过它。
- **`multi_edit` 的原子性来自快照即回滚机制**：工具在应用前捕获自己的回滚点快照，任一失败即以 `rollback: true` 恢复并响亮失败，点名失败文件与已完成的回滚。`snapshot/create` 与 `snapshot/restore` 是必读会话事件，模型仅凭日志即可重建"工作区已回到快照 N"。
- **呈现**：restore/diff/multi_edit 结果渲染为多文件 diff 卡片，载荷经 `presentationMeta` 从规范值重放（tool-fs 模式）；create/list 渲染 generic 卡片。

## Alternatives considered

- **创建时整树拷贝**——每快照急切地硬链接/拷贝工作区。否决：成本随树规模而非变更数增长，system prompt 引导的"风险变更前先打快照"行为会变得昂贵；懒瀑布捕获只对实际变更的文件收费。
- **给 multi_edit 造显式事务层**——在工具内暂存写入、记日志、提交/回滚。否决：这会重复快照缝隙已有的能力，增加第二条需要维护的持久化故事；失败情形相同（恢复前状态），快照就是事务。
- **轮询或 fs watcher 捕获**——否决：watcher 平台表现不稳定，轮询要么丢事件要么空转，而 intent 瀑布恰好在变更边界触发且带着 actor。
- **快照间继承链**（子快照引用父快照加增量，head 可移动）。否决：head 指针的崩溃恢复与写时复制的收养语义引入了广播模型直接避免的失败模式——每个存活快照持有自己的完整条目集，去重本来就发生在 blob 存储层。
- **命名为 "checkpoint"**——否决：与 `dsh-session-checkpoint-policy` 的日志持久化含义冲突；"workspace snapshot" 命名的是对标产品暴露的用户可见能力。

## Consequences

- 懒模型只跟踪被变更过的路径：快照之后创建且此后从未再变更的文件对 `diff` 与恢复的重写集合不可见。创建时树枚举不在范围内，system prompt 如实说明——恢复无法找回先于快照存在但从未被修改过的文件。
- 被删除的 manifest 留下孤儿 blob，直到会话的快照目录本身被移除；保留策略是按会话计数而非字节预算。会话结束清理是部署关注点，已记录为 Provider 的 Known Limitation。
- 每个文件系统一个 Provider：合成 actor 与按会话键控的存储假设每上下文一个 fs 后端；跨 agent 工作区合并明确不在范围内。
- `snapshot_restore` 在 `execute` 内重算 diff，使审批预览与 diff 卡片共享同一来源；双重读取是呈现作为日志值纯函数的代价。
- Windows 与 POSIX 走同一条捕获路径——瀑布是平台无关的——所以相关套件不像 PTY 家族那样被 win32 排除。
