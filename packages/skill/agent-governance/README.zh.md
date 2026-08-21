# @deepseek-ai/dsh-agent-governance

[English](README.md) | 中文

这是一个可选的 DeepSeek Harness Plugin，发行治理 Skill，并通过 `ctx.subagents` 协调 Codex、Claude Code 和子 DeepSeek Harness Runtime。

插件通过现有 filesystem skill provider 挂载内置 Skill 根目录。Skill 目录摘要继续由 `dsh-tool-skill` 提供，完整指令和 references 只在选中 Skill 时按需加载。项目级和用户级 Skill 仍遵循 Harness 现有的优先级和 scope 规则。

Runtime 提供基于 Provider 的注册表、确定性推荐、风险和权限信息，以及面向模型的 `governance_*` 工具，用于检查可用性、路由、批准、委派、取消、报告、交接和验收。路由不会授予执行权限：委派必须有已记录的批准，子 Agent 报告也不等于验收。

治理事实追加为可回放的 `governance/*` Session Event，包括 Provider 检查、批准、委派生命周期、证据、交接和验收。较大的任务包继续保存在工作区文件中，Session 只保存引用，避免每次提示都复制完整内容。交接路径被限制在 Session 工作区内。本 Plugin 不修改 `agent-loop`；Codex 和 Claude Code 使用已有 Provider，DeepSeek Harness 在加载该 Provider 时使用已有的 `subagent-dsh-sdk` 进程边界。

委派会使用工具的取消信号，并采用可配置的任务超时（默认 30 分钟）；取消和超时都会作用于现有 Subagent Run，并与子 Agent 报告分别记录。本 package 还导出只包含类型的 contributor 接口，为未来的原生扩展桥预留生命周期接入点。本版本只定义这些接口，不注册 hooks，也不修改 Agent Loop。

## 挂载

在 profile 或 bundle patch 中加入：

```yaml
- id: agent-governance
  name: '@deepseek-ai/dsh-agent-governance'
```

## 模型体验

### 内置治理和执行 Skill

#### 模型看到的内容

插件向初始 catalog 提供六个摘要，包括 Runtime、路由、交接和验收指导。选中的 Skill body 及其引用的资源只会在模型通过现有 `skill` 工具加载后出现。

#### Token 影响

初始 catalog 增加六个摘要；每个加载的 body 增加自身的工具结果内容。Plugin 不会把 body 复制到第二条 synthetic prompt 消息。

#### KV Cache 影响

catalog 和加载的 body 会在现有可复用前缀之后追加模型可见历史。启用或停用此 Plugin 会改变 catalog 后缀，但不会改变无关 Provider 的行为。

## 已知限制和延后工作

- Plugin 不修改 `agent-loop`；Provider 是否可用仍取决于选择的 Profile Bundle。
- 内置资源随此 package 版本化；body 变化需要更新 package。
- `includeDefaultRoots` 保持启用时，filesystem provider 也可能提供项目级和用户级 Skill。
