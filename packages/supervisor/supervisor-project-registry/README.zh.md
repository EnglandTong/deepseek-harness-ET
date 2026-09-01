# `@deepseek-ai/dsh-supervisor-project-registry`

English | [English](README.md)

本包提供 Personal Supervisor 的显式项目纳管和有界候选发现。`suggestProjects()` 只检查调用方明确提供的父目录，只读取元数据和目录项名称，不会自动纳管项目。`registerProject()` 是用户确认后的操作，并通过 `realpath` 规范化路径，因此符号链接和 junction 别名不能创建第二个项目。

已纳管路径通过 [`@deepseek-ai/dsh-supervisor`](../supervisor/README.md) 的版本化 `supervisor/project` 快照表示。项目消失时可观察为 `unavailable`；`removeProject()` 只移除中央纳管关系，不会触碰项目文件、会话或治理档案。

## 模型体验

### 项目发现与纳管

#### 模型看到的内容

模型看到有界的候选元数据、规范路径、worktree 标记、纳管 ID 和明确的注册失败信息。本包不会向模型提供项目文件正文。

#### Token 影响

候选结果受 `maxCandidatesPerRoot` 限制且保持紧凑，不会加载项目历史。

#### KV Cache 影响

对于相同 roots，稳定的候选顺序使重复发现保持确定的请求前缀。

## 已知限制与后续工作

- **持久重放由后续包负责** —— Supervisor 事件/会话投影负责重启持久化；本注册表只维护运行时缓存，并在存在 `ctx.supervisor` 时从它恢复。
- **链接分类依赖主机元数据** —— Windows junction 显示为 `junction`；远程路径语义仍由对应文件系统 Provider 负责。
