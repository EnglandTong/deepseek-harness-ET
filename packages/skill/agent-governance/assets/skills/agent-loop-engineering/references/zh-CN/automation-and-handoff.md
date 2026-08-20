# 自动化与交接 2.1

## Runner 契约

外层 Runner 可重复调用一个有界 Loop。每次运行取得单写者锁、重新加载状态、校验权限/fingerprint/预算、执行一个角色阶段、追加一条记录、释放锁，并在终局或无效状态停止。

不得发明范围、回答 Owner 门禁、无限重试未变化失败、验收 Standard/Full 工作或隐藏失败验证。

## 角色轮换

`acceptance_mode: Layered` 时，同一 Agent 可依次担任 Controller、Developer、Stage Reviewer，但每个阶段只使用所需材料：

- Controller：目标投影、验收项、约束、当前证据；
- Developer：已授权阶段、相关源码/测试、验证命令；
- Stage Reviewer：验收项、diff、原始结果、功能证据、限制。

Stage Reviewer 写 `stage_review`，不写最终 QA。Independent QA 必须是另一个 Agent/任务或人工，并只接收任务局部证据。

## 预算

强制阶段/时间上限、每个 signature 两次无进展失败、上下文档位、唯一下一步和可选工具/成本预算。预算停止不代表完成。

## 交接

优先使用 Active Packet 和 Loop Runs。只有真实跨团队边界无法从二者安全恢复时才创建独立 Handoff。

交接包含 Packet/阶段、当前状态、进展增量、通过/失败检查、根因、变更文件、阻塞、Owner 决定、唯一下一步和证据路径，不含对话或隐藏推理。

## 多 Agent

每个 Packet 只有一个写者。并行 Agent 必须使用不重叠 Work Order，并有已授权集成阶段。评审者接收原始产物，不接收期望判定。
