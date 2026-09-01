# @deepseek-ai/dsh-client-ui-supervisor

[English](README.md) | 中文

Personal Supervisor 浏览器插件提供唯一面向用户的总控面板，用于查看已登记项目、任务状态、关键通知、由 Host 批准的任务操作以及只读子会话引用。

插件向 `sidebar.footer.action` 注册一个入口。打开后读取 Host 提供的 `ctx.supervisor` 投影并渲染项目和任务卡片。批准、拒绝、要求返修、暂停和继续操作都会携带卡片显示的任务 revision，通过比较并交换提交；如果 revision 已过期，运行时会报告错误，不会覆盖卡片状态。

子 Agent 执行会话仅以引用展示。面板不会挂载 composer、授予工具权限，也不会根据 transcript 推断任务状态。插件需要 Host/API 可用；如果可选的 Supervisor Bundle 未装载，面板显示明确错误，而不是伪造数据。

Node 半部保持空实现。Personal Supervisor Host 和客户端 runtime 能力准备好后，再在浏览器 profile 中安装此包。插件不改变现有对话根节点或子会话传输。

`./invariant` companion 只登记包所有权，不创建第二份客户端状态权威。

## 模型体验

### Supervisor 总控面板

#### 模型看到的内容

总控面板是客户端投影，不向模型 prompt 添加内容。它通过 Host API 展示 `supervisor_status` 数据和所有者操作。

#### Token 影响

无。面板刷新使用有界快照，而不是子会话 transcript。

#### KV Cache 影响

无。UI 状态不重写 prompt 前缀。

## 已知限制与暂缓事项

- 面板依赖可选的 Supervisor Host/API 行，并在其不可用时报告，而不是伪造状态。
- 子会话保持只读引用；有意不提供 transcript 编辑和直接向子会话输入的能力。
