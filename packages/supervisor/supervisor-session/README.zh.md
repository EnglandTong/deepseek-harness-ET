# `@deepseek-ai/dsh-supervisor-session`

[English](README.md) | 中文

本包拥有 Personal Supervisor 的唯一持久总控 Session。首次启用时保留稳定的 `supervisor-main` ID，追加并 flush 一个 `supervisor/identity` 事件，然后将 ID 写入 `supervisor-session` settings namespace。后续启动从配置的 persistence backend 列出会话，准备准确的已存储 Session，校验其身份事件，再通过正常的 Session 生命周期发布它。

最终 flush disposer 会停止新工作，调用 `ctx.sessions.flush()`，然后才脱离 Session。JSONL 和 SQLite 行为由现有 `SessionPersistence` seam 提供；本包不读取后端文件，也不创建第二种持久化格式。

## 模型体验

### Supervisor Session

#### 模型可见内容

后续 Supervisor consumer 会看到稳定的总控 Session 和其持久身份事件。本包不提供项目文件、Shell、模型路由或执行器工具。

#### Token 影响

总控对话只增加一个单例身份标记；项目历史由后续投影按需加载。

#### KV Cache 影响

由于 settings ID 和身份事件会在 consumer 挂载前恢复，总控前缀在重启后保持稳定。

## 已知限制与后续工作

- 项目登记、路由、派发和记忆投影由后续工单提供。
- 身份 flush 成功后若 settings 写入失败，稳定首次启动 ID 下仍会留下可恢复日志；下次启动会先对账该日志，不会再创建其他总控。
