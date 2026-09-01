# Agent Note：持久化唯一 Supervisor Session

Status: implemented

[English](2026-08-31-supervisor-session.md) | 中文

## 问题

Personal Supervisor 需要一个可跨 Harness 重启恢复的总控 Session。只把 ID 放在进程内，或在 Session 日志持久化之前写 settings，都可能在崩溃后创建第二个总控，或隐藏首次启动时已经有效的日志。

## 决定

`@deepseek-ai/dsh-supervisor-session` 注册一个 `supervisor-session` settings namespace，并使用现有 `SessionStore` 和 `SessionPersistence` seam。首次启动保留 `supervisor-main`，追加带版本的身份事件，等待 `ctx.sessions.flush()`，然后才写入 settings ID。恢复时从配置的 backend 列出并准备准确的 Session，校验唯一且匹配的身份事件，再重新发出该事件供 Supervisor 投影。释放时先关闭准入、flush，再脱离 Session。

## 已考虑的替代方案

- 只在内存中保存 ID 被拒绝，因为重启无法识别总控。
- 先写 settings 被拒绝，因为崩溃可能留下没有持久身份的配置 ID。
- 扫描并导入全部已存储 Session 被拒绝，因为显式 settings ID 是权威，不需要读取完整历史。
- 在 JSONL/SQLite 旁创建私有文件被拒绝，因为这会复制持久化语义并破坏 backend 一致性。

## 后果

重启总能在有效日志与首次启动之间做出选择：settings 写入失败永远不会隐藏有效的首次启动日志，而配置 ID 缺少持久身份时以 `SUPERVISOR_SESSION_INVALID_STATE` 快速失败，不会创建第二个总控。代价是两个资源的首次启动流程无法原子提交 Session 日志与 settings 文档；稳定 ID 和确定性恢复规则让唯一崩溃窗口可恢复，未来多进程协调器可进一步收紧该窗口。

## 测试

`packages/supervisor/supervisor-session/tests/session.spec.ts` 钉住首次启动先 flush 后写 settings、从配置的持久化 backend 恢复，以及所有 `SUPERVISOR_SESSION_INVALID_STATE` 拒绝（配置指向不存在的 Session、重复 live ID、重复或畸形的身份事件）和先 flush 再脱离的释放顺序。`jsonl-persistence.spec.ts` 钉住跨重启的 JSONL 持久化以及 SQLite 上的同一单例。`examples/headless-agent/tests/supervisor.snapshot.ts` 的重启段在组装产品中钉住跨两次进程启动的总控总账重放。
