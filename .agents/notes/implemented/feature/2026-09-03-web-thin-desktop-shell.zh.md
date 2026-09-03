# Agent Note: 产品桌面端是覆盖 dsh web 的薄壳

Status: implemented

[English](2026-09-03-web-thin-desktop-shell.md) | 中文

## 问题

本 fork 曾短暂在 `packages/desktop`（`@deepseek-ai/dsh-desktop`）落地一套大型
Electron「Harness Studio」壳，作为协议参考宿主，带大量观测与演示页。本 fork
的产品意图相反：保留官方 **dsh web** 界面，用一个简单桌面窗口启动它，再逐步
叠加能力（plugin-import 已在 Web 设置中）。Studio 壳抬高了使用难度，并把
「产品桌面」与调试面混在一起。

## 决策

**产品桌面是 `apps/desktop`：极薄的 Electron 主进程，启动 `dsh web --no-open`，
并把打印出的 URL 载入 BrowserWindow。** 不重做聊天、工作区、设置或插件导入——
这些仍属于 web profile。仓库中的 Studio 树 `packages/desktop` 已删除。单机安装包
/ 便携 exe 留到后续步骤。

## 备选方案

- **原地保留并精简 Studio。** 否决：Studio 信息架构（Tracing、Playground、Hub、
  Bench 等）是另一类产品；删页面仍会留下并行 UI，并与 web 双轨维护。
- **只打开系统浏览器（不要 Electron）。** 作为更薄一步可延后；本步仍希望有独立
  窗口，而不要求用户自己管理浏览器标签。
- **本变更就内嵌 sdk-runtime exe。** 延后：第一步只需基于 checkout 启动
  `dsh web`，路径短、易排查。

## 影响

贡献者在常规仓库构建并设置 `DEEPSEEK_API_KEY` 后，执行
`cd apps/desktop && pnpm start`。根目录 `pnpm-workspace.yaml` 允许 Electron
的 postinstall（`allowBuilds.electron: true`）以下载二进制。Import Plugin 仍走
Web 设置与 `@deepseek-ai/dsh-host-plugin-import`。此前的 Studio 迁移笔记已并入
本文并删除；若再引入 Studio 式宿主需新决策。本地未跟踪的 `examples/desktop`
残留（若有）不属于产品路径，无进程占用时应删除。
