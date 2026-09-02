---
description: "Remote 服务把插件 bundle 安装进正在运行的 dsh profile：pnpm add、dsh.profile.bundles 对账，以及经启动器提供的 manager 热应用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-plugin-import

[English](README.md) | 中文

## Summary

Web 的 Plugins 设置页可以向 web 表面所启动的 profile 添加插件 bundle。调用 `pluginImport/import` 会在 profile 目录里运行 `pnpm add`（registry 包名或 `file:`/`link:`/路径 spec），按 `dsh plugin add` 的同一规则对账 `dsh.profile.bundles`，然后请启动器提供的 manager 把新的 bundle 层热应用到运行中的树。调用 `pluginImport/listBundles` 返回 profile 当前的层列表及每层的解析状态。两个方法回答的都是 manager context 所命名的 profile；只有经 dsh profile 启动的表面才提供它。

## Use this package

本服务是 Remote-only，经 [`api-remotes`](../../api/remotes/README.zh.md) 组装为 `ctx.remote.pluginImport` 消费；web bundle 为导入 tab 组合它。

### 一次导入做什么

一次调用执行三个有序步骤并逐段报告：pnpm 安装 spec（非零退出或 pnpm 缺失会就此结束报告），对账把每个声明 `dsh.bundle` 的依赖加入层列表、并移除不再声明的依赖，且——仅在新增了层时——manager 把新栈热应用到运行中的树。安装失败是报告而非抛错，客户端可以展示捕获的输出；热应用失败时层已写入，报告会提示重启后生效。

## Model Experience

无，本导入服务不注册任何模型可见的内容。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

#### Runtime invariant

未发布运行时 invariant 伴随产物，因为重应用关系由启动器提供的 manager 拥有，而安装路径已由驱动真实 pnpm 与真实 profile 目录的 app-boot 与 host spec 覆盖。

## Known Limitations and Deferred Work

这些限制源于"只管理表面已启动的那个 profile"。它们是当前包约束，不是任务清单。

- 热应用原地替换 patch 栈。若 bundle 的插件需要本树未组装的服务，事务性重应用会失败；层保留在磁盘上，报告会引导用户重启。
- Git 托管依赖仍需要 pnpm 打印的 `allowBuilds` 条目，与 `dsh plugin add` 一致；输出会携带 pnpm 自己的指引。
- 只管理本表面启动的 profile。其余 profile 按设计仍归 CLI 所有。
