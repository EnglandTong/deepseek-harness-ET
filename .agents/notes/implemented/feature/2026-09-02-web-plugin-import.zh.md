# Agent Note: Web 的 Plugins 设置中的插件导入

Status: implemented

[English](2026-09-02-web-plugin-import.md) | 中文

## 问题

向 profile 添加插件 bundle 意味着回到终端：`dsh plugin --profile <name> add <package>`，然后重启表面。在 web GUI 里工作的用户必须了解 profile 目录、pnpm 和 `dsh.bundle` 清单约定，而对账规则只存在于 `apps/cli/src/plugin.ts`，浏览器表面无法触及。

## 决策

两个新包把导入做成产品表面。`@deepseek-ai/dsh-host-plugin-import` 拥有 `pluginImport` Remote：`import(spec)` 经 `@deepseek-ai/dsh-app-boot` 里共享的 `installProfileBundle` 在已启动 profile 的目录中运行 `pnpm add`，用与 CLI 现在所调用的同一个抽取出的 `reconcileProfileBundles` 对账 `dsh.profile.bundles`，并以报告而非抛错返回，浏览器因此能展示发生了什么。`@deepseek-ai/dsh-client-ui-settings-plugin-import` 经既有的 `settings.plugins.tab` slot 向 Plugins 设置分区贡献 Import tab。

**启动器拥有 profile 事实与热应用触发器。** web 服务器按设计不认识 profile，因此 `runProfile` 在 host 包的键下提供 `ProfilePluginManager`：不可变 context（profile 名、目录、安装锚点）加一个 `applyInstalledBundles()` 闭包。该闭包重跑 `prepareProfile` 让新装 bundle 的层进入组合，保持 `composed` 与既有文件监视重组合同步，并经新导出的 `updateRootIncludePatches` 用同一套事务性重应用替换根 include 的 patch 栈——与 patch 监视器执行的是同一条路。重应用失败是报告字段而非启动失败：层保留在磁盘上，UI 提示重启后生效。

**一份对账，两个表面。** CLI 保留其同步、终端流式的 spawn，但 `anchorPathSpec` 与对账逻辑现在与其它 profile 原语一起住在 `dsh-app-boot`，CLI 与 web 表面在"哪个依赖加入层栈"上不可能漂移。

**tab 只渲染 host 报告的内容。** 解析标记来自 `listBundles`，重启提示来自报告的 `applied`/`applyError` 字段，安装输出就是捕获的 pnpm 输出。该 tab 只管理 web 表面启动的 profile；没有 profile 切换器，与设置暴露所采取的 Host 白名单立场一致。

## 备选方案

- **复用动态 cordis runner。** 那条 seam 定义运行时创作的内存态插件；它从不触及 `$DSH_HOME/profiles` 或 pnpm。安装是失败模式不同的另一种操作，不应并入。
- **从浏览器转发任意 pnpm 动词。** `dsh plugin` 原样转发 argv，其安全性建立在终端用户亲手输入之上。Remote 只接受一个 spec 并自己构造 `pnpm add`。
- **只做重启提示的 MVP，不做热应用。** 否决：web profile 本就以 live patch reload 运行，事务性重应用机制早已存在，增量工作恰好是 manager 拥有的重组合。
- **页面管理任意 profile。** 暂缓：跨 profile 的枚举与写入需要自己的信任故事，而每个真实消费者管理的都是它正看着的那个表面。

## 影响

用户可以在 Plugins 设置里安装已发布的 bundle 或本地 `file:` 路径，看到层加入运行中的树，并得到捕获的安装输出；热应用被拒绝时还有明确的重启提示。Git 托管依赖仍需要 pnpm 的 `allowBuilds` 条目；输出会携带 pnpm 的指引。覆盖率沿既有 seam：app-boot 单测覆盖共享安装路径与重应用，host spec 以 PATH 上的假 pnpm 驱动 gateway，client spec 覆盖 tab 的各状态。
