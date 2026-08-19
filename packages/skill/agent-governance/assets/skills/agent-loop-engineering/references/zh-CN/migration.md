# 旧状态迁移 2.1

兼容旧项目，但正常执行不再无限期停留在多文件兼容模式。

## Bootstrap 规则

没有 Active Packet 时：先只读 Legacy Bootstrap，大小写不敏感定位 Docs，只检查当前权威文件和明确链接，检测权限/路线/判定/交付类别冲突；只有无冲突且显式 `--write` 才写一份 Packet；旧历史全部保留不改。

冲突返回 exit code 2 且零写入，必须先由治理流程解决。

## 旧文件映射

| 旧文件 | 2.1 作用 |
| --- | --- |
| `TARGET.md` | 高权威目标与 Non-Goals |
| `ACCEPTANCE.md` | 验收项与证据要求 |
| 活跃 `WORK_ORDER*.md` | 当前范围权限 |
| `STATUS.md`、`CMS.md`、角色说明 | 当前状态候选，不高于权威文件 |
| `NEXT_ACTIONS.md` | 下一步候选 |
| `PENDING.md` | 阻塞、决定和以后想法 |
| QA 文件 | 保留判定；后续推翻决定优先但必须显式 |
| `LOOP_RUNS.jsonl` | 追加证据；旧记录只聚合，不重写 |

## 迁移后

- Active Packet 是当前投影；
- 停止日常写入重复状态日志；
- 只有稳定范围需要时保留一个当前 Work Order；
- Standard / Full 只保留一个最终 Independent QA Decision；
- 只在发布/月度自然边界归档，不删除历史。

authority fingerprint 改变时停止执行，先对齐再刷新 Packet。
