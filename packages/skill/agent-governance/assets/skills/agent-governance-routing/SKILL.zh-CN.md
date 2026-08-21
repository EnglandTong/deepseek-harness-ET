---
name: agent-governance-routing
description: 在记录批准后，根据能力把有边界的工作路由到 Codex、Claude Code 或 DeepSeek Harness。
---

# Agent Governance Routing

先使用 `governance_check_agents` 或 `governance_list_agents` 检查可用 Agent，再使用 `governance_route_task` 生成推荐。路由推荐不是执行授权。

需求理解、任务拆解、治理和交接优先使用 DeepSeek Harness；局部代码修改和测试优先使用 Codex；大型架构审查和跨文件重构优先使用 Claude Code。

调用 `governance_delegate` 前，确认任务 id、目标项目、工作目录、允许修改的文件、Non-Goals、权限和验收条件，并显式调用 `governance_approve`。子 Agent 完成报告只是证据，不等于验收；检查修改和测试证据后才调用 `governance_accept`。

除非任务明确指定第二个项目且已经获得人工批准，否则禁止跨项目目录委派。使用 `governance_handoff` 记录有边界的文件引用，将任务包保存在 `.agent-state/<task-id>/`，不要复制完整对话历史。
