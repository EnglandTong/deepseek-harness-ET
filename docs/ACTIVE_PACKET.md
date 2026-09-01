---
contract_version: "2.0"
packet_id: "PSUP-001"
goal_readiness: "Ready for Execution"
project_state: "Active"
execution_state: "In Progress"
alignment_state: "Aligned"
stage_review: "Not Reviewed"
qa_required: true
qa_decision: "Not Reviewed"
size: "Large"
governance: "Full"
stage: 6
max_stages: 10
stage_minutes: 120
autonomy_mode: "Bounded"
acceptance_mode: "Layered"
delivery_class: "Mixed"
context_profile: "Compact"
write_scope: "."
outside_write_policy: "Deny"
authority_fingerprint: "sha256:41820c909b6d7cda2769295dbaa558354356ef3709721d7c023e025239c10a0c"
updated_at: "2026-08-31T00:12:00Z"
---

# Personal Supervisor Program Active Packet

English | [中文](ACTIVE_PACKET.zh.md)

## Desired Outcome

DeepSeek Harness 提供一个可选的原生 Personal Supervisor Cordis 插件。插件维护唯一主助理会话、跨项目任务总账和有界自动调度；用户只需在主会话中查询、确认、返修和验收，由项目绑定的 subagent 承担实际开发工作。

## User And Situation

用户同时推进多个项目和模型会话，当前需要自行记忆各会话上下文、状态和下一步。Personal Supervisor 将这些事实持久化并按需投影，避免把全部历史塞入一个持续增长的提示词。

## Current Stage Outcome

WO-00 and WO-01 passed independent Stage Review. WO-02, WO-03, WO-05, and WO-06 are implemented and reviewed; WO-04 through WO-13 have focused implementations and tests, while true restart re-review, published Bundle/UI integration, and final Independent QA remain open.

## Scope

- 原生 Cordis capability seam、唯一主会话、项目注册、项目执行宿主和 subagent 桥接。
- YAML 模型路由策略、有界自动调度、长期记忆、关键通知和只读子会话 UI。
- 可选 Profile Bundle、无密钥产品快照、双语文档和独立最终 QA。

## Non-Goals

- 主助理不直接修改业务代码、运行开发命令或扩大 child 权限。
- 第一版不提供程序关闭后的常驻执行、跨主机同步或多进程共同写入。
- 不自动纳管候选项目，不在策略文件中存储凭证，不允许同项目多个写执行者。
- 不依赖 experimental Agent Team 包，不完整实现非软件领域执行工具。

## Acceptance Criteria

- [Runtime] 首次启用只创建一个主助理会话，重启恢复同一身份。
- [Runtime] 两个项目并行执行时使用各自真实 cwd，同项目只有一个写者。
- [Runtime] 主助理按策略调度模型或 CLI subagent，并合并需要用户确认的事项。
- [Runtime] compaction 和重启后仍能恢复项目、任务、决定、阻塞和唯一下一步。
- [Runtime] 用户可在主窗口审阅只读 child 输出、返修和验收。
- [Contract] 公共类型、事件、Host API 和 SDK 投影保持版本化、可重放且有运行时验证。
- [Governance] Developer/Stage Reviewer/Independent QA 权限分离，执行报告不能自动成为 Accepted。
- [Artifact] 可选 Bundle、双语文档、Agent Notes 和 keyless snapshot 通过相关门禁。

## Allowed Changes

- 当前阶段允许修改上述治理文件以及 `packages/supervisor/supervisor-session/`、`supervisor-project-registry/`、`supervisor-project-state/`、`supervisor-routing-policy/` 的实现、测试、README、JSDoc 和对应生成配置；公共契约仍由已审查的 WO-01 所有。
- 后续阶段按 `.agents/state/personal-supervisor/WORK_ORDERS.md` 的依赖顺序修改授权 package、测试、示例和生成产物；每张 Work Order 一个主要写者和独立分支。

## Protected Boundaries

- 不修改 `packages/core/agent-loop` 来承载新行为。
- 不修改 vendor、用户凭证、生产环境或工作区外文件。
- 保留未跟踪 `.workbuddy/`、`work/` 和所有无关用户改动。
- 不自动创建 worktree、部署、安装系统服务、force push 或执行破坏性 Git。

## Evidence Required

- 每张工单的 focused tests、相关功能证据、diff 和原始结果。
- 跨 cwd、单写者、崩溃恢复、compaction、只读 UI 和审批门禁的组装应用证据。
- Standard/Full 终局由未参与实现的 Independent QA 判定。

## Stop Conditions

- 权威指纹变化、公共接口冲突、范围增长超过 20% 或无法说明目标链接。
- 需要凭证、付费资源、生产部署、破坏性操作或受保护架构变更。
- 相同失败签名连续两次没有新证据、根因或通过行为。

## Authority Sources

- `AGENTS.md`
- `.agents/state/personal-supervisor/WORK_ORDERS.md`
- `.agents/notes/implemented/architecture/2026-08-30-personal-supervisor-plugin.md`
- `docs/architecture.md`
- `docs/architecture.zh.md`

## Assumptions And Decisions

- 主助理是一个自动创建并持久恢复的唯一 Session；其他对话的 `@总控` 只转交该 Session。
- 中央事件日志拥有项目注册和调度事实；项目 Packet/Loop Runs 拥有项目目标和执行证据；child Session 拥有完整对话。
- 项目宿主提供真实 cwd 和生命周期所有权；普通 subagent cwd 继承约定保持不变。
- DeepSeek 关闭时暂停执行，重启后只恢复可证明安全的任务。

## Current Evidence

- 仓库已有 Session persistence/projection、compaction、subagent providers、Agent presets、jobs、Host API 和客户端 lineage 能力。
- `experimental/agent-team` 已证明持久 roster、CAS task 和 mailbox 模式，但其单 checkout 和实验发布边界不满足正式跨项目插件要求。
- 当前工作树基线仅含用户已有未跟踪 `.workbuddy/` 和 `work/`。

## One Next Action

Run WO-14 integration gates over the assembled Bundle, Host API, client Dashboard, persistence backends, and keyless snapshot; then dispatch WO-15 Independent QA.
