/** Locale keys for the input-optimize composer controls and helper Settings row. */

export type InputOptimizeLocaleKey =
  | 'optimize.label'
  | 'optimize.aria'
  | 'optimize.title'
  | 'optimize.busy'
  | 'optimize.unavailable'
  | 'optimize.failed'
  | 'mic.label'
  | 'mic.aria'
  | 'mic.title'
  | 'mic.recording'
  | 'mic.unavailable'
  | 'mic.failed'
  | 'confirm.hint'
  | 'settings.helper.title'
  | 'settings.helper.description'
  | 'settings.helper.cloud'
  | 'settings.helper.local'
  | 'settings.helper.off'
  | 'settings.helper.restart'
  | 'settings.helper.envLocked'
  | 'settings.helper.loadFailed'
  | 'settings.helper.saveFailed'

export const en: Record<InputOptimizeLocaleKey, string> = {
  'optimize.label': 'Optimize',
  'optimize.aria': 'Optimize draft with local helper model',
  'optimize.title': 'Clean up the draft before sending',
  'optimize.busy': 'Optimizing…',
  'optimize.unavailable': 'Helper unavailable',
  'optimize.failed': 'Optimize failed',
  'mic.label': 'Voice',
  'mic.aria': 'Dictate with local speech-to-text',
  'mic.title': 'Record a draft with the microphone',
  'mic.recording': 'Listening…',
  'mic.unavailable': 'Speech-to-text unavailable',
  'mic.failed': 'Transcription failed',
  'confirm.hint': 'Review the cleaned draft, then send',
  'settings.helper.title': 'Helper mode',
  'settings.helper.description': 'Cloud API, local small model, or off. Restart the desktop app after changing.',
  'settings.helper.cloud': 'Online API',
  'settings.helper.local': 'Local model',
  'settings.helper.off': 'Off',
  'settings.helper.restart': 'Restart the desktop app to apply',
  'settings.helper.envLocked': 'Locked by DSH_HELPER_MODE in the environment',
  'settings.helper.loadFailed': 'Could not load helper mode',
  'settings.helper.saveFailed': 'Could not save helper mode',
}

export const zh: Record<InputOptimizeLocaleKey, string> = {
  'optimize.label': '优化',
  'optimize.aria': '用本地 helper 模型优化草稿',
  'optimize.title': '发送前清理草稿',
  'optimize.busy': '优化中…',
  'optimize.unavailable': 'Helper 不可用',
  'optimize.failed': '优化失败',
  'mic.label': '语音',
  'mic.aria': '用本地语音转写听写',
  'mic.title': '用麦克风录制草稿',
  'mic.recording': '聆听中…',
  'mic.unavailable': '语音转写不可用',
  'mic.failed': '转写失败',
  'confirm.hint': '请确认清理后的草稿再发送',
  'settings.helper.title': 'Helper 模式',
  'settings.helper.description': '云端 API、本地小模型或关闭。更改后需重启桌面应用。',
  'settings.helper.cloud': '在线 API',
  'settings.helper.local': '本地模型',
  'settings.helper.off': '关闭',
  'settings.helper.restart': '请重启桌面应用使设置生效',
  'settings.helper.envLocked': '已被环境变量 DSH_HELPER_MODE 锁定',
  'settings.helper.loadFailed': '无法读取 Helper 模式',
  'settings.helper.saveFailed': '无法保存 Helper 模式',
}
