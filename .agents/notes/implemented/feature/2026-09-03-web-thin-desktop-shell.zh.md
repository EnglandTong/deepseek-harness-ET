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
这些仍属于 web profile。仓库中的 Studio 树 `packages/desktop` 已删除。

**打包的 Windows 构建内嵌 sdk-runtime win-x64 exe**（及 ripgrep sidecar）于
`resources/runtime/`，经 `pnpm run sync-runtime` / `dist:portable` 从
`dist-exe/` 同步。便携产物为 `DSH-Desktop-Portable-<version>.exe`
（仅 electron-builder portable；NSIS 延后）。打包启动时若环境未提供
`DSH_HOME`，则使用 `~/.dsh`（与 CLI 默认相同），以便与普通 `dsh web` 共享
profile 与凭据。checkout 下的 `pnpm start` 在未暂存 runtime 时仍回退到系统
Node + `apps/cli/lib/bin.js`。

## 备选方案

- **原地保留并精简 Studio。** 否决：Studio 信息架构（Tracing、Playground、Hub、
  Bench 等）是另一类产品；删页面仍会留下并行 UI，并与 web 双轨维护。
- **只打开系统浏览器（不要 Electron）。** 作为更薄一步可延后；产品路径仍希望有
  独立窗口，而不要求用户自己管理浏览器标签。
- **只打薄壳、不内嵌 runtime。** 否决为分发路径：双击仍需要 checkout 与系统
  Node。
- **同变更打 NSIS 安装包。** 延后：portable 足以验证内嵌 runtime；安装包可复用
  同一套 `extraResources`。

## 影响

贡献者在常规仓库构建并设置 `DEEPSEEK_API_KEY` 后执行
`cd apps/desktop && pnpm start`，或在构建
`deepseek-harness-sdk-runtime-win-x64.exe` 后执行 `pnpm run dist:portable`。
根目录 `pnpm-workspace.yaml` 允许 Electron 的 postinstall
（`allowBuilds.electron: true`）。Import Plugin 仍走 Web 设置与
`@deepseek-ai/dsh-host-plugin-import`。此前的 Studio 迁移笔记已并入本文并删除；
若再引入 Studio 式宿主需新决策。`resources/runtime/` 与 `dist/` 为 gitignore
的构建产物。
