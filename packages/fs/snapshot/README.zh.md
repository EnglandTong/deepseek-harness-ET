# @deepseek-ai/dsh-snapshot

[English](README.md) | 中文

抽象工作区快照能力缝隙（`ctx.snapshots`）：词汇类型（不透明的 `SnapshotId`、带诚实 `partial`/捕获边界的 manifest 元数据、行级 diff 投影、恢复结果）、`SnapshotService`（create / list / restore / diff），以及让快照事实仅凭会话日志即可重放的两个会话事件（`snapshot/create`、`snapshot/restore`）。

命名刻意选用 "snapshot" 而非 "checkpoint"：[dsh-session-checkpoint-policy](../session/session-checkpoint-policy/) 已把 "checkpoint" 用于会话日志持久化检查点。

## 能力缝隙

| 角色 | 包 |
|---|---|
| Service Definition | `@deepseek-ai/dsh-snapshot`（本包） |
| Provider | `@deepseek-ai/dsh-snapshot-local` — 经 fs write/edit-intent 瀑布懒捕获、内容寻址 blob 存储、经 fs 写路径恢复 |
| Consumer | `@deepseek-ai/dsh-tool-snapshot`（`snapshot_create` / `snapshot_list` / `snapshot_restore` / `snapshot_diff`）、`@deepseek-ai/dsh-tool-multiedit`（带自动快照回滚的多文件原子编辑） |

## 服务契约

`SnapshotService` 是抽象类，一个实例服务一个会话作用域。方法接收调用方 `Agent`——存储以 agent 的会话为键，恢复经由该 agent 沙箱策略下的 fs 写路径重入，会话事件落在该 agent 自己的日志上。

- `create(agent, { reason, signal })` — 对工作区状态打快照；返回元数据。内容捕获是懒式的，所有权归 provider。
- `list(agent)` — 该会话的快照，按创建时间从旧到新。
- `restore(agent, id, { rollback, signal })` — 重写捕获内容有差异的文件、删除快照之前不存在的文件、如实报告 unmanaged 路径。默认是破坏性操作：除非 `rollback` 标记原子自回滚（同一工具调用内捕获的快照），provider 会将其经审批门。
- `diff(agent, id, { signal })` — 快照与当前内容之间的逐文件行级差异，附 unmanaged 路径边界。

## 捕获状态

manifest 条目恰为以下之一：

- `captured` — 变更前内容已物化为内容寻址 blob；可恢复。
- `unmanaged` — 未捕获（写入抢先、文件超过配置上限、或 blob 写入失败）。由 `restore` 与 `diff` 如实报告，绝不静默丢弃。
- `absent` — intent 触发时路径不存在；恢复即删除此后创建的文件。

## 会话事件

| 事件 | 载荷 | 语义 |
|---|---|---|
| `snapshot/create` | `{ id, reason, partial }` | 仅记录、整值替换；重放时折出已知快照 id 集合 |
| `snapshot/restore` | `{ id, restored, removed }` | 仅记录、整值替换；模型从日志重建“工作区已回到快照 N” |

两者都是 `SessionEventMap` 的必读成员；[invariant 伴生件](src/invariant.ts) 在重放与分发时校验其载荷（`@deepseek-ai/dsh-snapshot/invariant`）。
