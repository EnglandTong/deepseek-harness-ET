# @deepseek-ai/dsh-agent-governance

English | [English](README.md)

这是一个 DeepSeek Harness Plugin，统一发行来自 ClawHub 的两个互补 Skill：`cms-project-governance` 和 `agent-loop-engineering`。

插件通过现有 filesystem skill provider 挂载内置 Skill 根目录。Skill 目录摘要继续由 `dsh-tool-skill` 提供，完整指令和 references 只在选中 Skill 时按需加载。项目级和用户级 Skill 仍遵循 Harness 现有的优先级和 scope 规则。

本包只负责 Skill 的发行和生命周期，不修改 `agent-loop`，不替模型做治理决策，也不把项目状态保存到插件内部。项目状态仍由目标项目自己的 `Docs/ACTIVE_PACKET.md`、Work Order 和 loop records 保存。

## 挂载

在 profile 或 bundle patch 中加入：

```yaml
- id: agent-governance
  name: '@deepseek-ai/dsh-agent-governance'
```

## 模型体验

插件只向初始 catalog 提供两个摘要，不把完整指令注入初始 prompt。现有 `skill` 工具会按需加载具体 Skill，并继续使用 Harness 的 session 和 compaction 机制。
