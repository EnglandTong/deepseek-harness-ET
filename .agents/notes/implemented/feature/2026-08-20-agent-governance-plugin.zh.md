# Agent governance Plugin

`@deepseek-ai/dsh-agent-governance` 将 ClawHub 的 `cms-project-governance` 和 `agent-loop-engineering` 两个 Skill 作为一个 Harness Plugin 打包。它通过现有 filesystem skill provider 挂载包内 Skill 根目录，因此继续使用 Harness 原有的 Skill catalog、scope 解析、按需加载、资源提示和 dispose 机制。

`@deepseek-ai/dsh-agent-governance-bundle` 提供可选的 `cordis.patch.yml` row。插件不修改 `agent-loop`，不替模型做治理决策，也不保存项目状态；Active Packet、Work Order、Loop Runs、证据和 handoff 仍由两个 Skill 定义的文件机制负责。

验证包括 package composition test、隔离内嵌根目录测试、TypeScript project build、workspace constraints、Skill invocation metadata 和直接 package publication lint。完整 host build 仍被 `packages/mcp/mcp-client` 中已有错误单独阻塞。
