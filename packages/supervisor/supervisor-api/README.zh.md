# `@deepseek-ai/dsh-supervisor-api`

[English](README.md) | 中文

本包提供总控 Dashboard 使用的 Host 投影，暴露项目、任务版本、关联运行和合并后的关键通知，但不暴露隐藏推理、原始 stderr、凭证或项目文件操作。用户审阅操作必须携带客户端看到的任务 revision。

API 以 Cordis 服务（`ctx.supervisorApi`）提供，项目数据读取保持只读。派发、批准和返修仍由编排与交互服务执行，避免客户端绕过权限和生命周期门禁。

## 模型体验

### Supervisor API 投影

#### 模型看到的内容

`supervisorApi` 服务是 Host 投影，不组装 prompt，也不把子会话 transcript 复制进主助手。

#### Token 影响

无。API 响应是有界快照。

#### KV Cache 影响

无。投影不重写模型 prompt 前缀。

## 已知限制与暂缓事项

- 本包自身不提供传输；由 Host API 代理挂载其版本化域。
- 子会话引用保持只读，不暴露 transcript 修改。
