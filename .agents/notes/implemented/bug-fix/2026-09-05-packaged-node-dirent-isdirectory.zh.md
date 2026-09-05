# Agent Note: 打包 Node 的 Dirent 方法破坏 Agent 预设发现

Status: implemented

[English](2026-09-05-packaged-node-dirent-isdirectory.md) | 中文

## 问题

安装版桌面在「设置 → Agent 预设」报 `child.isDirectory is not a function`，「设置 → 插件 → 插件列表」则显示通用 inventory 错误。两条路径都走 agent-preset roster 扫描；挂载 roster 时 `pluginInventory/list` 会 await `compositionInventory()`。

## 决策

**`scanRoot` 与 authoring 目录遍历使用普通 `readdir` 名称加上 `stat().isDirectory()`，不再依赖 `withFileTypes` 的 Dirent 方法。** SEA / 打包 Node 可能返回形似 Dirent 但类型谓词不可调用的对象。对这些小型预设根，对拼接路径做 `stat` 是可移植的目录判断。

「设置 → 插件 → 导入」增加路径说明、「浏览」（`directoryPicker.pick()`）以及更醒目的「导入」主按钮，便于选择本地 bundle 目录而无需手打路径。

## 备选方案

**保留 `withFileTypes` 并守卫 `typeof child.isDirectory === 'function'`。** 否决：仍需正确的目录判定；`stat` 在普通与打包 Node 下都可用。

## 影响

安装版运行时下 Agent 预设设置与插件列表可用。需重建 NSIS 包以纳入 Host 修复；导入 UI 随 Client bundle 重建发布。

## 相关

- 桌面 helper / 薄壳：[../feature/2026-09-05-desktop-local-edge-input-optimize.zh.md](../feature/2026-09-05-desktop-local-edge-input-optimize.zh.md)
