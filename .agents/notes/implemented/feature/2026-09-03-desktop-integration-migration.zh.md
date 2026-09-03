# Agent Note: 桌面端并入 master(迁移阶段)

Status: implemented

[English](2026-09-03-desktop-integration-migration.md) | 中文

## 问题

本 fork 的 Electron 桌面壳此前位于三个叠放的旧分支(`agent/desktop-electron`、`-packaging`、`-standalone`)的 `examples/desktop`,基于旧的上游状态。与此同时 `master` 经历了 2462 commits 的上游同步(至 dsh-0.1.2-alpha.4),上游彻底移除了顶层 `examples/`,并合入了本 fork 的 plugin-import 网页功能。桌面壳需要加入 `master`,使桌面端与 plugin-import 在同一分支共存。

## 决策

**桌面壳成为 `packages/desktop`(`@deepseek-ai/dsh-desktop`),随 `master` 维护。** 完整壳目录(521 个文件)从 `agent/desktop-electron-standalone`(持有三个 PR 全部工作的栈顶)导出到 `packages/desktop`,排除构建产物(`dist/`、`node_modules/`、`resources/runtime/`);`package.json` 改名为工作区风格的 `@deepseek-ai/dsh-desktop`。

`packages/desktop` **有意不加入 pnpm 工作区**:工作区 glob 是 `packages/*/*`(两级),单层的 `packages/desktop` 保持为自带 `pnpm-lock.yaml` 的独立 Electron 应用,符合其应用(而非 harness 包)属性,并避开假定 Cordis 包的 invariant/tsconfig/coverage 门禁。

**运行时锚点已改指 alpha.4 的接口。** 旧锚点引用的上游代码已被 alpha.4 删除:

- `profiles.js` 的 checkout 启动命令是 `node --import tsx/esm apps/cli/src/bin.ts --profile sdk`(tsx 从开发 checkout 解析为绝对 file URL;`TSX_TSCONFIG_PATH` 钉住 checkout 的 tsconfig);打包态启动单文件 `deepseek-harness-sdk-runtime-win-x64.exe --profile sdk`(exe 名来自 `scripts/build-exe-for-python-sdk.ts`,由 `scripts/sync-bundled-runtime.js` 连同 `rg.exe` sidecar 一起搬运)。
- `dev-root.js`/`profiles.js` 的 checkout 发现只接受持有 `apps/cli/src/bin.ts` 的目录(原为 `packages/examples/jsonrpc-demo/src/bin.ts`)。
- 守护进程/socket 运行时(`daemon-demo`)、playground 临时运行时与插件探测依赖被移除的 socket 接口。两个 daemon profile 和无密钥的 `stdio-echo` profile 在 `profiles.js` 中被禁用(`disabled` + `disabledReason`,经 `profiles:list` 与 `startRuntime` 以灰置方式呈现);`plugins:probe` 与 playground 启动对退役原因 fail loud,而不是拉起幽灵 bin。临时运行时改锚 `sdk` profile 是后续工作。
- `config/*.yml` 叶子是 legacy 展示资产:`sdk` profile 从 bundle 层组合、不接受叶子 argv,运行时不会加载它们;它们服务于 Plugins 标签页的 fs-parse/legacy 叶子视图(daemon-echo 叶子仍是用户 overlay 的 base),头部注释已说明现状。
- 壳走 SDK 协议(`@deepseek-ai/dsh-sdk-protocol`:`initialize`/`session/prompt`/`shutdown` + 四个通知)。旧 jsonrpc-demo 协议有而 SDK 协议没有的方法(`session/list`、`session/new`、`session/events`、`session/cancel`、`session/fork`、`session/compact`、`plugins/list` 等)在 MethodNotFound 上优雅降级;smoke 脚本与 README 记录了这一差异。
- `smoke-runtime.js` 只对 `sdk` profile 跑 stdio/kill/tree 场景(移除 daemon 场景;kill-recovery 经 transport 对 stdio 子进程 SIGKILL),且无 `DEEPSEEK_API_KEY` 时自跳过——sdk 运行时没有无密钥 profile。渲染器缺密钥卡片相应去掉了 `switchTarget`。

`plugins/mock-llm.mjs` 原样保留:`ctx.llm.registerAdapter` 契约未变(仍只要求 `stream()`;`providerRetryPolicy` 保持可选)。

## 备选方案

- **把三个旧分支 merge 进 master。** 否决:它们基于 pre-alpha.4 上游,merge 会拖进 2462 commits 的冲突洪流,且其运行时(`jsonrpc-demo`/`agent-spine-demo`)已不存在、无从对齐——每处冲突最终仍要重建。
- **桌面端继续留在树外,等上游运行时稳定。** 否决:桌面壳是本 fork 的产品面,plugin-import 工作需要桌面端在同一分支共存;继续搁置只会重复本次整合要终结的分叉。
- **经 profile patch 在 sdk 运行时保留无密钥 echo。** 延后:需要为 `sdk` profile 新写 mock 适配器 bundle overlay;与其阻塞在新上游接口上,不如让整合先落地(禁用 profile 会带原因 fail loud)。

## 影响

一个分支(`agent/desktop-integration`,落至 `master`)同时承载桌面壳与 plugin-import,以 `@deepseek-ai/dsh-desktop` 对齐上游 alpha.4 运行时节奏。桌面端 2044 项测试在 Windows 上全绿(2 项平台合理的跳过)。迁移付出的代价:daemon 独享的 UI 面(实时插件列表、sandbox 开关、session/compact 按钮)在 sdk 协议上没有对应 wire,进入优雅降级;playground 与插件探测改为报告不可用;打包应用的 `stdio-echo` 兜底在 mock overlay 落地前要求用户持有 checkout。完整的 profile/协议清点见 `packages/desktop/README.md`。
