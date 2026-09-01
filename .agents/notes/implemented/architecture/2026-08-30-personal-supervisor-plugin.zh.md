# Agent Note: Personal Supervisor 作为可选插件能力

Status: implemented

[English](2026-08-30-personal-supervisor-plugin.md) | 中文

## Problem

用户通过多个模型对话并行开发多个项目时，每次继续协调前都需要重新整理各对话的目标、进度、阻塞、证据和下一步。无限延长一个对话不能解决这个问题：上下文压缩（context compaction）可以减少模型输入，但不会产生权威的跨项目任务记录、把工作路由到正确工作区，也不能区分执行器报告与用户验收。

## 决定

Personal Supervisor 作为可选 Cordis 能力发布，通过 profile 组合包加载。该能力拥有一个持久 supervisor Session、显式项目登记、带 revision 的跨项目任务总账、可配置模型路由、项目绑定执行宿主、有界跟进、精简状态投影、关键通知、Host API 投影和一个主助理客户端视图。

supervisor Session 没有项目工作目录，也不获得生产文件系统或 shell 工具。每个已登记项目由一个隐藏宿主 Session 将通过校验的真实路径绑定到现有 subagent 提供方。一个项目最多准入一个具有写权限的运行；只读 reviewer 可以并行。中央事件日志拥有项目登记和派发事实，项目治理文件拥有目标和执行证据，child Session 拥有完整模型对话。

项目状态读取引用已安装的 `cms-project-governance` skill 处理目标、权限和验收工作，引用 `agent-loop-engineering` 处理已授权项目执行；只有当前角色需要时才加载完整说明。对话压缩可以摘要 supervisor transcript（文本记录），而持久投影和来源引用独立于该摘要重建项目状态。

第一版只在 Harness 宿主运行期间执行。重启对账只恢复持久状态能够证明不会重复已接受或不确定运行的工作。正式包不依赖实验性 Agent Teams；它们可以通过稳定服务复用其 revision、mailbox 和恢复模式。

## Package roles

`supervisor/supervisor` 声明服务和持久数据。Session、项目注册、项目宿主、项目状态、路由、执行器、编排、记忆、工具、Host API、客户端 UI 和组合包分别承担独立角色，使提供方、展示和策略可以在不修改 agent loop（智能体循环）的情况下演进。

## Alternatives considered

**把所有项目上下文放进一个不断增长的 supervisor 提示词。** 这会让 token 压力充当存储机制，丢失类型化状态和证据所有权，也无法在重启后安全恢复派发。

**每个项目使用一个 supervisor，再在之后汇总。** 多个控制器会产生竞争权限、重复用户决定，并且需要额外同步层才能回答项目组合问题。

**直接基于实验性 Agent Teams。** 该领域假设一个根 Team 和一个共享 checkout，而 Personal Supervisor 需要稳定发布包、显式多项目根目录以及面向用户的 Host/client 投影。

**运行独立 HTTP 服务或后台守护进程。** 独立进程会重复 Harness 的持久化、权限、提供方发现和生命周期所有权。离线执行也会扩大第一版安装与安全范围。

## 后果

该设计换来的是一份能跨压缩与重启存续的权威跨项目记录：启用组合包只创建或恢复一个 supervisor Session，两个已登记项目可以并行运行且工作目录不会交叉，一个项目不能准入两个写权限运行，执行器完成只进入待审状态——独立验收仍是单独的 Owner 动作。

代价是跨项目控制把生命周期和恢复并发扩展到普通父子委派之外。实现串行化中央写入、使用项目级写准入、在恢复含糊时快速失败，并把完整项目证据保留在滚动摘要之外。

包集合和客户端工作足够庞大，独立贡献者之间可能产生偏移。因此公共事件和 API 类型在并行开发前冻结，生成 catalog 只有一个集成负责人，下游工作等待依赖审查。

外部 CLI 提供方保留其原生认证和模型选择行为。路由报告这些限制，不声称提供方无法强制的模型覆盖。

## 测试

`packages/supervisor/*/tests/` 下的 focused Vitest 套件钉住公共契约、唯一 Session 和项目注册表；`packages/bundle/personal-supervisor/tests/personal-supervisor.spec.ts` 钉住组合包 manifest、其挂载行和只含总控身份的 preset。`examples/headless-agent/tests/supervisor.snapshot.ts` 中的无密钥组装产品快照通过 Loader 启动 `examples/headless-agent/supervisor.cordis.snapshot.yml`，跨越两次进程启动钉住创建、路由、批准、执行、审查、通知接收和重启总账重放。

## 相关

- [Personal Supervisor 可选组合包装配](2026-08-31-personal-supervisor-bundle.md)
- [冻结 Personal Supervisor 公共契约](2026-08-31-supervisor-public-contract.md)
- [持久化唯一 Supervisor Session](2026-08-31-supervisor-session.md)
- [Personal Supervisor 编排循环](2026-08-31-supervisor-orchestrator.md)
- [确定性 Personal Supervisor 路由策略](2026-08-31-supervisor-routing-policy.md)
