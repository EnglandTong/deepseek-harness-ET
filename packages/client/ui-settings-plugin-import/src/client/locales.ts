/** Copy dictionaries for the plugin import Settings tab. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  tab: '导入插件',
  profileHint: '安装到当前运行的 profile（{name}）',
  specLabel: '包名或本地路径',
  specHint: '可填写 npm 包名，或粘贴本地目录路径；也可点「浏览」选择文件夹。',
  specPlaceholder: '例如 @deepseek-ai/dsh-agent-governance-bundle 或 D:\\path\\to\\bundle',
  browseAction: '浏览',
  browsing: '选择中…',
  importAction: '导入',
  importing: '正在安装…',
  emptySpec: '请输入包名或本地路径，或使用「浏览」选择。',
  currentTitle: '当前插件层',
  loading: '正在读取插件层…',
  error: '暂时无法读取插件层。',
  retry: '重试',
  emptyLayers: '尚未安装任何插件层。',
  resolvableTag: '已解析',
  unresolvedTag: '未解析',
  addedTitle: '新增插件层',
  appliedTag: '已热应用到运行中的会话',
  applyFailedTag: '热应用失败',
  applyErrorLabel: '热应用失败原因',
  applyFailedHint: '新插件层已写入 profile；重启 dsh 后生效。',
  installedNoLayers: '安装完成，但该包没有声明 dsh.bundle，未加入插件层。',
  installFailedTitle: '安装失败',
  transcriptLabel: '安装输出',
} satisfies Record<string, string>

/** Plugin import locale key union. */
export type PluginImportLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  tab: 'Import plugins',
  profileHint: 'Installs into the currently running profile ({name})',
  specLabel: 'Package name or local path',
  specHint: 'Enter an npm package name or a local directory path, or use Browse to pick a folder.',
  specPlaceholder: 'e.g. @deepseek-ai/dsh-agent-governance-bundle or D:\\path\\to\\bundle',
  browseAction: 'Browse',
  browsing: 'Choosing…',
  importAction: 'Import',
  importing: 'Installing…',
  emptySpec: 'Enter a package name or local path, or use Browse.',
  currentTitle: 'Current plugin layers',
  loading: 'Reading plugin layers…',
  error: 'Plugin layers are temporarily unavailable.',
  retry: 'Retry',
  emptyLayers: 'No plugin layers are installed yet.',
  resolvableTag: 'Resolvable',
  unresolvedTag: 'Unresolved',
  addedTitle: 'Newly added layers',
  appliedTag: 'Applied to the running session',
  applyFailedTag: 'Live apply failed',
  applyErrorLabel: 'Live apply failure',
  applyFailedHint: 'The new layers were written to the profile; they take effect after restarting dsh.',
  installedNoLayers: 'Install finished, but the package declares no dsh.bundle and joined no layer.',
  installFailedTitle: 'Install failed',
  transcriptLabel: 'Install output',
} satisfies Record<PluginImportLocaleKey, string>
