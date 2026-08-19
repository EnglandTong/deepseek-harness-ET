# @deepseek-ai/dsh-tool-snapshot

[English](README.md) | 中文

把工作区快照缝隙（`ctx.snapshots`，见 [dsh-snapshot](../snapshot/)）投影为四个模型可见工具的 Consumer：`snapshot_create`、`snapshot_list`、`snapshot_restore`、`snapshot_diff`。

## 工具

| 工具 | 呈现 | 说明 |
|---|---|---|
| `snapshot_create` | generic | 一个 `reason` 字符串；返回的 id 供后续 restore/diff 使用 |
| `snapshot_list` | generic | 按创建时间正序，带诚实的 partial 标记 |
| `snapshot_restore` | **diff 卡片** | 在 `execute` 内先算恢复前 diff，经 `presentationMeta` 携带，diff 卡片因此是规范值的纯函数 |
| `snapshot_diff` | **diff 卡片** | 每文件 hunk，带 `modified`/`added`/`removed` 分类与 unmanaged 边界 |

恢复的审批走 Provider 自身的审批门；工具层不加第二道门。system-prompt 小节引导模型在风险性多步变更前先打快照，并说明懒捕获边界（创建后从未修改过的文件不可恢复）。

## 装配

```yaml
# cordis.yml — 需要同一运行时上的 ctx.snapshots（如 dsh-snapshot-local）
'@deepseek-ai/dsh-tool-snapshot':
  {}
```
