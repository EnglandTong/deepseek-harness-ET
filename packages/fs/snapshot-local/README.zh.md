# @deepseek-ai/dsh-snapshot-local

[English](README.md) | 中文

`ctx.snapshots` 的本地工作区快照 Provider（Service Definition 是 [dsh-snapshot](../snapshot/)）。每个上下文一个插件实例；快照按会话存放于 `dshHomePath('snapshots')/<sessionId>/`。

## 工作原理

**广播捕获。** Provider 在 `fs/write-intent` 与 `fs/edit-intent` 瀑布上注册 `prepend: true` 监听。目标在某个快照创建后的首次变更时，其变更前内容在 `next()` 委托之前被读取，并记录进**每一个**尚未跟踪该目标的存活快照——预像等于每个这类快照创建时刻的状态，因此不存在继承步骤，也没有需要崩溃恢复的 head 指针。监听始终调用 `next()`；捕获只做注记，绝不决策，任何捕获失败都降级为诚实的 `unmanaged` 条目，而不是否决变更本身。

从未被修改的文件零成本。超过 `maxFileBytes` 的文件记录 `unmanaged: too-large`；不可读的记录 `unmanaged: capture-failed`；两者都会在 `restore` 与 `diff` 中如实呈现。

**存储。** 内容寻址 blob（sha256，跨快照去重）加每快照一个 JSON manifest。manifest 写入经临时文件 + rename 与每会话 FIFO 队列，并行工具调用无法交错读-改-写周期，崩溃也不会留下半写的 manifest。

**恢复。** 差异文件经标准 fs 写路径重写——先用自身读取预置 `fs/observed`，再以合成 `{ agent }` actor 分发 `fs/write-intent` 瀑布，并传入逐调用沙箱策略——捕获、观察策略与沙箱围栏的参与方式与工具写入完全一致。快照之前不存在的文件经原生删除移除，组合了策略服务时被围栏在沙箱工作区根内（fs 缝隙没有 delete）。破坏性恢复需要审批服务，除非调用方标记了原子 `rollback`（同一工具调用内捕获的快照）；完全没有审批服务时，破坏性恢复响亮失败。

## 配置

| 字段 | 默认值 | 说明 |
|---|---|---|
| `rootDir` | `dshHomePath('snapshots')` | 快照根目录 |
| `retention` | `20` | 每会话保留的快照数；创建时丢弃最旧的 |
| `maxFileBytes` | `4194304` | 单文件捕获上限；更大的文件记录为 unmanaged |
| `diffMaxLines` | `2000` | 单次 diff 结果的行数预算，超出即截断 |

## 已知边界

- **懒模型只跟踪被修改过的路径。** 快照之后创建且此后从未变更的文件对 `diff` 与恢复的重写集合不可见；创建时刻的树枚举不在范围内。原子多文件编辑（`@deepseek-ai/dsh-tool-multiedit`）不受影响：它自己的写入触发捕获预像的 intent。
- **孤儿 blob 按会话存续。** 保留策略删除旧 manifest 时其 blob 保留；只有会话的快照目录本身被移除时才回收。会话结束清理是部署关注点（dshHome 数据管理），不是 Provider 行为。
- **每个文件系统一个 Provider。** 合成 `{ agent }` actor 与按会话键控的存储假设每上下文一个 fs 后端；跨 agent 工作区合并明确不在范围内。
