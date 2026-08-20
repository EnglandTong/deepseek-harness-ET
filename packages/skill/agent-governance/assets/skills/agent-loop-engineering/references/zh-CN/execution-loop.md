# 执行循环 2.1

## 启动或恢复

1. 解析项目根目录和 Docs 目录的真实路径。
2. 读取 `Docs/ACTIVE_PACKET.md`。
3. 校验 authority fingerprint 与写入边界。
4. 只读唯一当前动作、受影响源码/测试、验证配置和最近三条 Loop。
5. 确认没有已触发的停止条件。

没有 Packet 时先做 Legacy Bootstrap。旧状态互相冲突时不得执行。

## Controller 阶段派发

Controller 设置一个与验收项相连的阶段结果，不创建阶段文件。该结果必须位于范围内，明确预期证据，并且可逆或有恢复路径。

只有以下条件同时满足才自动继续：fingerprint 未变、对齐为 `Aligned`、下一阶段已授权、有真实进展、没有 Owner 或安全门禁。

## Developer Loop

```text
选择一个完整行为
  -> 检查现有模式
  -> 复现或建立基线
  -> 在 write_scope 内实现
  -> 聚焦自动检查
  -> 行为变化时做功能检查
  -> 受影响回归
  -> 审查 diff 与证据
```

优先完成垂直切片。不得因为还有时间而增加推测性抽象、无关清理或新功能。

## 失败返修

用失败命令、测试/验收项和主要错误生成稳定 `failure_signature`。再次尝试前至少要有一项进展增量：新根因证据、失败范围收窄、相关改动、新通过检查或被证伪假设。

相同 signature 连续两次无进展时进入 `Needs Fix` 或 `Blocked`。全量测试超时可分片诊断，但没有正式门禁变更时，分片不能作为终验。

## 阶段审查

Stage Reviewer 接收验收项、变更文件/diff、原始命令结果、功能证据和已知限制，不采信 Developer 希望得到的判定。

返回：`Passed`、`Needs Fix` 或 `Blocked`。Standard / Full 的 Stage Reviewer 不设置最终 `qa_decision`。

## 对齐

每阶段记录：

```text
用户可见变化：
目标/验收项链接：
范围或假设偏移：
反对过早完成的证据：
Continue / Needs Fix / Formal Alignment：
```

阶段 3、6、10 及 Skill 中的即时触发条件执行正式对齐。

## Loop 记录

每轮只追加一个精简 JSON 对象，使用 `record_version: "2.1"`，包含 role、result、progress_delta、evidence、failure_signature、stage_review、context_stats 和唯一 next_action。平台提供真实 Token 数据时才记录，不自行估算。

## 终局状态

- `Ready for Independent Acceptance`：新 Standard/Full 的实现与阶段证据完成；
- `Needs Fix`：范围内仍有有界返修；
- `Blocked`：硬门禁或权限不足；
- `Invalid State`：当前权限或状态冲突；
- `Locally Compliant, Globally Misaligned`：局部通过但已不服务原目标。

旧 Layered Standard / Full Packet 中，应把 `Ready for Review` 规范化为 `Ready for Independent Acceptance`；两者都不是 Accepted。
