---
description: "Web 的 Plugins 设置中的导入 tab：按包名或本地路径把插件 bundle 安装进已启动的 profile，并展示热应用结果。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-plugin-import

[English](README.md) | 中文

## Summary

本包向 Plugins 设置分区贡献 Import tab。它渲染一个安装表单（registry 包名或 `file:`/`link:`/路径 spec）、最近一次安装报告，以及 profile 当前的 bundle 层列表及每层的解析状态。该 tab 经 [`plugin-import`](../../host/plugin-import/README.zh.md) 的 Remote 由 [`api-remotes`](../../api/remotes/README.zh.md) 组装绑定；它不拥有任何设置项，除 tab 草稿与最近报告外不持有状态。

## Use this package

本包由 web bundle 组合；凡 host 组合了 `plugin-import` 的部署，Plugins 设置里就会出现该 tab。本分区的卡片与 tab 都经 `settings.plugins.tab` slot 注册，因此分区属主无需任何改动。客户端经 [`api-remotes`](../../api/remotes/README.zh.md) 消费该 Remote。

## Model Experience

无，该 tab 只渲染 host 事实，不注册任何模型可见的内容。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

#### Runtime invariant

未发布 invariant 伴随产物：该 tab 只渲染 host 报告的事实，其注册 slot 由 Plugins 分区属主声明。

## Known Limitations and Deferred Work

这些限制源于"只呈现一个 profile 的导入表面"。它们是当前包约束，不是任务清单。

- 该 tab 只管理 web 表面启动的 profile；按设计不提供 profile 切换器。
- 热应用失败会连同重启提示一起报告；该 tab 不轮询、也不自动重试应用。
