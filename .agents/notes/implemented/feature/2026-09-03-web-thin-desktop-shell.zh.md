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

**产品打包顺序：先稳住薄壳 → NSIS 安装包（主路径）→ 可选安装时 / 首次启动
引导插件 → Portable 最后。** 打包的 Windows 构建在 `resources/runtime/` 内嵌
sdk-runtime win-x64 exe（及 ripgrep sidecar），在 `resources/tools/` 暂存
`pnpm.exe`，带上 `resources/bootstrap/` 引导清单，并带上 `resources/sidecar/`
local-edge 配置（引擎与权重不进入默认 NSIS 包）。经
`pnpm run sync-pack` / `dist:installer` 同步。Setup 产物为
`DSH-Desktop-Setup-<version>.exe`（NSIS：可选安装目录、开始菜单与桌面快捷方式；
目录页离开时自动追加产品文件夹名）。打包启动时将内嵌 `pnpm` 前置到 `PATH`。
首次打包启动时，若缺少 web profile 依赖则先跑
`dsh plugin --profile web install`，再按需执行 bootstrap 插件；在 `dsh web`
之前可选启动或复用 OpenAI 兼容的 local-edge sidecar，健康时通过 `--patch`
挂上 `local-edge` 路由、compaction 摘要钉选与 input-optimize（否则软失败）。
启动即显示 splash，避免长时间空白。若环境未提供 `DSH_HOME`，则使用 `~/.dsh`。
checkout 下的 `pnpm start` 在未暂存 runtime 时仍回退到系统 Node +
`apps/cli/lib/bin.js`。`dist:portable` 仍可用于冒烟，但不是产品分发主路径。
安装版 SEA 下的 web 依赖 client-modules 跟随 `moduleFallback`，否则
`__DSH_BOOT__` 会为空。local-edge 细节见
[2026-09-05-desktop-local-edge-input-optimize.zh.md](./2026-09-05-desktop-local-edge-input-optimize.zh.md)。

## 备选方案

- **原地保留并精简 Studio。** 否决：Studio 信息架构（Tracing、Playground、Hub、
  Bench 等）是另一类产品；删页面仍会留下并行 UI，并与 web 双轨维护。
- **只打开系统浏览器（不要 Electron）。** 作为更薄一步可延后；产品路径仍希望有
  独立窗口，而不要求用户自己管理浏览器标签。
- **只打薄壳、不内嵌 runtime。** 否决为分发路径：双击仍需要 checkout 与系统
  Node。
- **以 Portable 为主要产物。** 否决为产品路径：用户需要可选安装目录、快捷方式，
  以及暂存宿主工具 / 首次引导插件的位置；NSIS 是主分发形态，Portable 仅保留为
  次要冒烟目标。

## 影响

贡献者在常规仓库构建并设置 `DEEPSEEK_API_KEY` 后执行
`cd apps/desktop && pnpm start`，或在构建
`deepseek-harness-sdk-runtime-win-x64.exe` 后执行 `pnpm run dist:installer`。
根目录 `pnpm-workspace.yaml` 允许 Electron 的 postinstall
（`allowBuilds.electron: true`）。Import Plugin 仍走 Web 设置与
`@deepseek-ai/dsh-host-plugin-import`。此前的 Studio 迁移笔记已并入本文并删除；
若再引入 Studio 式宿主需新决策。`resources/runtime/`、`resources/tools/` 与
`dist/` 为 gitignore 的构建产物。
