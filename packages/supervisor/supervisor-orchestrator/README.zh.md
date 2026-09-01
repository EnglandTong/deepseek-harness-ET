# `@deepseek-ai/dsh-supervisor-orchestrator`

[English](README.md) | 中文

本包是 Personal Supervisor 的总控循环。它捕获请求、关联已登记项目、向已注册路由 Provider 获取可解释的决策、合并需要确认的任务，并通过执行器桥接派发已批准的工作。本包不直接修改项目文件，也不执行生产命令。

`SupervisorOrchestratorService` 对用户操作使用乐观任务 revision。执行报告先进入 `ReadyForReview`，只有后续的用户或审阅动作才能接受。非完成运行使用有界的失败签名返修循环；重复签名会停止循环并发送阻塞通知。

## 模型体验

### 总控循环

#### 模型看到什么

主助理接收任务快照、路由原因、确认批次、终态和精简失败签名。子会话的完整记录保留在各自的 child Session 中。

#### Token 影响

捕获和返修只保留当前任务提示词与结构化引用，不把重复执行输出复制到总控提示词。

#### KV Cache 影响

稳定的任务字段和策略版本让普通状态更新保持前缀稳定；新任务 revision 只改变受影响的记录。

## 已知限制与后续工作

- reviewer 派发与综合由路由数据表达，具体整合由后续交互和 Bundle 包完成。
- 记忆和 Host API 包完成持久投影前，确认批次只存在于当前进程。
- 本包在 dispose 时停止工作，不运行常驻后台调度器。
