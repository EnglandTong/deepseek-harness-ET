# @deepseek-ai/dsh-tool-multiedit

[English](README.md) | 中文

多文件原子编辑工具 Consumer：`multi_edit` 在一次调用中跨文件应用一组字面量编辑——要么全部生效，要么整个工作区回滚到编辑前状态。

## 原子性的实现方式

工具不新造事务层。应用前先创建工作区快照（`ctx.snapshots.create`，reason 为 `multi_edit rollback point`）；任一失败即以 `rollback: true` 恢复该快照——服务契约中的原子自回滚标记，跳过破坏性变更审批门——然后响亮失败，报告失败的文件与回滚已完成的事实。`snapshot/create` 与 `snapshot/restore` 会话事件与任何快照使用一样触发，回滚事实可从日志重放。

单文件编辑语义与单文件 `edit` 工具一致：经 `ctx.fs.editText` 做字面量 `old_string` → `new_string` 替换，逐目标分发 `fs/edit-intent` 瀑布，每次编辑后记录 `fs/observed` 版本（默认 fs-observation-policy 的先读后编门按文件生效——请先读文件）。

调用与结果都渲染为一张多文件 diff 卡片；结果的 diff 是 Provider 报告的 before/after 全文，经 `presentationMeta` 携带，呈现保持为规范值的纯函数。

## 装配

```yaml
# cordis.yml — 需要同一运行时上的 ctx.fs 与 ctx.snapshots（如 dsh-snapshot-local）
'@deepseek-ai/dsh-tool-multiedit':
  {}
```
