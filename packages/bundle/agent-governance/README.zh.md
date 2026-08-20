# @deepseek-ai/dsh-agent-governance-bundle

[English](README.md) | 中文

可选的 profile bundle，用于挂载 `@deepseek-ai/dsh-agent-governance` 和已有的 `subagent-dsh-sdk` Provider。它提供治理 Skill 和工具，但不会改变默认 profile 组合。Codex 和 Claude Code 仍可独立安装对应 Provider Bundle。

## 模型体验

### 挂载的治理 Plugin

#### 模型看到的内容

挂载的 Plugin 提供三个 Skill catalog 条目和治理工具。Bundle 还通过 `subagent-dsh-sdk` 配置名为 `dsh-governance` 的 Harness Provider；配置的命令和 profile 必须能启动子 Harness Runtime。

#### Token 影响

Bundle 本身不直接增加 token。挂载后，Plugin catalog 增加三个摘要，选中的 Skill body 会在正常流程中增加自身的保留工具结果内容。

#### KV Cache 影响

Bundle 不直接改变请求前缀。任何缓存变化都来自挂载 Plugin 的 catalog 或选中的 Skill body，在其正常的 session-history 插入点发生。

## 已知限制和延后工作

- Bundle 是可选的，不改变已发布的默认 profile。
- Codex 和 Claude Code 不会被加入此 Bundle 的依赖闭包；需要时请安装相应 Provider Bundle。
- 默认子进程命令是面向开发环境的 JSON-RPC Harness 路径，部署时可能需要调整配置。
