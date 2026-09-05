/** General Settings row for desktop helper mode (cloud / local / off). */

import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InputOptimizeLocaleKey } from './locales.ts'
import css from './HelperModeRow.module.css'

/** Modes the desktop shell understands. */
export type HelperModeId = 'cloud' | 'local' | 'off'

/** Registration-side Remote face for the Settings row. */
export interface HelperModeRowInjected {
  /** Read effective mode + lock state. */
  helperMode(): Promise<{
    mode: HelperModeId
    source: string
    envLocked: boolean
    restartRequired: true
  }>
  /** Write `$DSH_HOME/desktop-helper-mode.json`. */
  setHelperMode(mode: HelperModeId): Promise<{ mode: HelperModeId; restartRequired: true }>
}

/** Full Settings-row props. */
export type HelperModeRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'inputOptimize'>
  & InjectFace<HelperModeRowInjected>

const OPTIONS: readonly { id: HelperModeId; label: InputOptimizeLocaleKey }[] = [
  { id: 'cloud', label: 'settings.helper.cloud' },
  { id: 'local', label: 'settings.helper.local' },
  { id: 'off', label: 'settings.helper.off' },
]

/**
 * Render the desktop helper-mode selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function HelperModeRow({ helperMode, setHelperMode, t }: HelperModeRowProps) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<HelperModeId>('local')
  const [envLocked, setEnvLocked] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void helperMode().then((snap) => {
      if (!alive) return
      setMode(snap.mode)
      setEnvLocked(snap.envLocked)
    }).catch(() => {
      if (!alive) return
      setNotice(t('settings.helper.loadFailed'))
    })
    return () => { alive = false }
  }, [helperMode, t])

  const selectedLabel = OPTIONS.find(option => option.id === mode)?.label ?? 'settings.helper.local'

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.helper.title')}</div>
        <div className={css.desc}>{t('settings.helper.description')}</div>
      </div>
      <div className={css.side}>
        <Menu
          open={open}
          onClose={() => { setOpen(false) }}
          items={OPTIONS.map(option => ({ id: option.id, label: t(option.label) }))}
          selectedId={mode}
          onSelect={(id) => {
            setOpen(false)
            const next = id as HelperModeId
            if (next === mode || envLocked || busy) return
            setBusy(true)
            void setHelperMode(next).then((result) => {
              setMode(result.mode)
              setNotice(t('settings.helper.restart'))
            }).catch(() => {
              setNotice(t('settings.helper.saveFailed'))
            }).finally(() => {
              setBusy(false)
            })
          }}
          align="end"
          portal
          anchor={(
            <button
              type="button"
              className={css.selector}
              aria-haspopup="menu"
              aria-expanded={open}
              disabled={envLocked || busy}
              onClick={() => { setOpen(value => !value) }}
            >
              {t(selectedLabel)}
              <IconChevronDownOutline14 className={css.chevron} />
            </button>
          )}
        />
        {envLocked ? (
          <div className={css.notice}>{t('settings.helper.envLocked')}</div>
        ) : notice !== null ? (
          <div className={css.notice}>{notice}</div>
        ) : null}
      </div>
    </div>
  )
}
