# Agent Note: Personal Supervisor 可选组合包装配

Status: implemented

[English](2026-08-31-personal-supervisor-bundle.md) | 中文

## Problem

Supervisor 运行时由多个独立能力包组成，但用户需要一个可安装的 profile 层来组合这些能力，同时不能静默授予生产工具、provider 凭证，也不能新增默认 Agent preset。

## 决定

`@deepseek-ai/dsh-personal-supervisor` 是可选原生组合包。它的 `dsh.bundle.patch`（`cordis.patch.yml`）只挂载总控服务、唯一 Session provider、显式项目注册表、项目宿主、执行器桥接、受界限约束的编排器、记忆投影、交互运行时、Host API 投影和浏览器客户端视图。该包同时提供只含总控身份的 Agent preset（`preset/supervisor/agent.cordis.yml`），以及默认确认和只读权限的路由策略示例（`routing-policy.example.yml`）作为非激活资源。该 patch 不挂载 shell、文件系统、部署、Web、凭证或外部 CLI provider 行，也不修改 `agent-presets` 或用户默认模型。

组合包依赖 patch 中声明的运行时包，使 Loader 的 manifest resolver 能找到每个裸插件名。routing-policy 和 project-state 仍是运行时包消费的库，不伪装成 Loader 行。随包提供的 preset 通过应用配置的受信任根暴露，因为 Cordis patch 无法安全推断应用内置 preset 目录。

## Alternatives considered

- **把 Supervisor 行加入 `dsh-base`：** 拒绝，因为总控是可选能力，加入基础层会改变所有 profile 的生命周期和资源归属。
- **在此组合包中挂载 Codex/Claude 外部 provider：** 拒绝，因为 provider 安装、认证、可执行文件发现和权限属于各自的原生组合包。
- **由该组合包覆盖 `agent-presets`：** 拒绝，因为这可能替换用户默认 composition，而且组合包无法安全解析应用内置 preset 根路径。
- **把策略示例当作激活的用户配置：** 拒绝，因为安装包不能写入 settings，也不能替用户选择模型或 provider。

## 后果

安装组合包不会启动模型或 CLI 进程，也不会改变 profile 的默认 Agent preset；patch 为候选发现、修复尝试、记忆摘要和通知唤醒设置的有界值都是普通 patch 配置，profile 可以替换。总控 preset 不含生产工具，策略示例默认确认和只读权限，且不含凭证。

在宿主应用把 `preset/supervisor/` 加入其受信任的内置 preset 根之前，总控 preset 始终是惰性资源——Cordis patch 无法推断该目录，应用路径归属因此保持明确。无密钥快照示例直接挂载总控服务，不依赖 preset 发现。

Provider 可用性有意留给安装的 executor/provider 组合包；示例策略使用占位标识符，在 Owner 配置真实 provider 前不能派发。

## 测试

`packages/bundle/personal-supervisor/tests/personal-supervisor.spec.ts` 钉住 manifest 声明可解析的 `dsh.bundle.patch` entry list 并点名每个挂载服务、不挂载任何 shell、文件系统、部署、凭证或外部 CLI provider 行或依赖，以及随包 preset 不携带生产工具。组装后的接线由 `examples/headless-agent/tests/supervisor.snapshot.ts` 基于 `examples/headless-agent/supervisor.cordis.snapshot.yml` 以无密钥方式演练。
