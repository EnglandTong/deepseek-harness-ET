# Governance Multi-Agent Harness

## 决策

`@deepseek-ai/dsh-agent-governance` 继续作为可选 Bundle。它挂载治理 Skill，注册确定性的 Agent 路由，并提供批准、委派、报告和验收工具，不修改 `agent-loop`。

## Provider 模型

Codex 和 Claude Code 继续使用现有的 `ctx.subagents` Provider。DeepSeek Harness 使用已有的 `@deepseek-ai/dsh-subagent-dsh-sdk` 进程边界，因此治理层不重复实现 CLI 或协议。

## 持久化事实

路由、批准、报告和验收追加为 `governance/*` Session Event。较大的工作包继续保存在工作区文件中，并由事件或 Skill 指引引用。

## 验证

路由和 Skill 生命周期聚焦测试通过。两个变更包的 TypeScript 项目构建通过。完整 workspace constraints 仍报告与本任务无关的 snapshot 包 rc.7 版本漂移。
