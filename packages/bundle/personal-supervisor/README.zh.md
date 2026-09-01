# `@deepseek-ai/dsh-personal-supervisor`

[English](README.md) | 中文

这是叠加在 [`dsh-base`](../base/README.md) 之上的可选 Personal Supervisor 总控组合包。它的 [`cordis.patch.yml`](cordis.patch.yml) 挂载唯一 Supervisor 服务、持久总控 Session、显式项目注册表、按项目绑定的执行宿主、执行器桥接、受界限约束的编排器、记忆投影，以及关键通知和 `@总控` 命令运行时。该包是一个可替换的 patch 层；可以在 profile 中覆盖某一行或完全不安装，而不改变基础 profile。

该包不挂载 Shell、文件系统、部署、Web、凭证或外部 CLI provider 行。安装它不会启动模型或 CLI 进程。Provider 组合包保持独立，并继续由自身负责认证和权限配置。项目宿主保证每个已登记项目最多一个写者，执行器桥接只接收路由策略授予的权限。

## Preset 与策略资源

[`preset/supervisor/agent.cordis.yml`](preset/supervisor/agent.cordis.yml) 是总控专用 preset。它只提供完整的 Supervisor persona，不提供生产工具。需要提供系统 preset 的应用必须把该目录加入受信任 preset 根；该组合包有意不替换 profile 现有的默认 preset。

[`routing-policy.example.yml`](routing-policy.example.yml) 是安全起始文档。它使用确认和只读权限，executor/provider 只写占位符，不含凭证或用户专属模型选择。将它复制到用户拥有的策略位置后，只有在对应 provider 组合包已安装时才替换这些标识符。

## 配置

该 patch 为候选发现、返修次数、记忆摘要和通知唤醒设置有界默认值。这些值属于普通 patch 配置，可以由 profile 或 home patch 替换。该组合包不会写入策略文件或 settings，也不会修改 `agent-presets` 或用户默认模型。

routing-policy 和 project-state 包是由编排与记忆层消费的库，不是独立的 Loader 行。它们的当前行为见 [`supervisor-routing-policy`](../../supervisor/supervisor-routing-policy/README.md) 和 [`supervisor-project-state`](../../supervisor/supervisor-project-state/README.md)。

## 模型体验

### Supervisor 组合包

#### 模型看到的内容

随包提供的 preset 使用简短且完整的总控 persona，同时把项目执行限制在 Supervisor 服务之后。运行时状态由记忆和交互层以有界摘要提供；该组合包不会把原始子 Agent 对话、隐藏推理或凭证放入总控 prompt。

#### Token 影响

有界摘要避免把子 Agent transcript 复制进总控上下文。

#### KV Cache 影响

稳定的 preset 文本和策略版本让总控前缀保持可预测。

## 已知限制与暂缓事项

- 该组合包是进程内的，并依赖所选 profile 提供的标准持久化和 settings 行。它不提供跨设备协作、程序关闭后的后台执行、自动纳管项目或外部 provider 登录流程。最终验收仍须在独立 QA 门禁后由 Owner 执行。
