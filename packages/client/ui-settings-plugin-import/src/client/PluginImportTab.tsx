import { useEffect, useState, type ReactNode } from 'react'
import type { BundleListSnapshot, ImportReport } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './PluginImportTab.module.css'

/** Registration-side Remote face used by the tab. */
export interface PluginImportSettingsTabInjected {
  /** Read the profile's current bundle layers. */
  listBundles: () => Promise<BundleListSnapshot>
  /** Install one spec into the profile and hot-apply the new layers. */
  importSpec: (spec: string) => Promise<ImportReport>
}

/** Full component props assembled by the Settings slot renderer. */
export type PluginImportSettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginImport'>
  & InjectFace<PluginImportSettingsTabInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: BundleListSnapshot }

/**
 * Render the plugin import tab: an install form, the last install report,
 * and the profile's current bundle layer list.
 */
export function PluginImportTab({ listBundles, importSpec, t }: PluginImportSettingsTabProps): ReactNode {
  const [request, setRequest] = useState(0)
  const [spec, setSpec] = useState('')
  const [busy, setBusy] = useState(false)
  const [validation, setValidation] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [state, setState] = useState<ViewState>({ status: 'loading' })

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => listBundles()).then(
      (snapshot) => { if (current) setState({ status: 'ready', snapshot }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [listBundles, request])

  const submit = (): void => {
    const trimmed = spec.trim()
    if (trimmed.length === 0) {
      setValidation(t('emptySpec'))
      return
    }
    setValidation(null)
    setSubmitError(null)
    setBusy(true)
    void importSpec(trimmed).then(
      (result) => {
        setReport(result)
        setBusy(false)
        setRequest(value => value + 1)
      },
      (error: unknown) => {
        setSubmitError(error instanceof Error ? error.message : String(error))
        setBusy(false)
      },
    )
  }

  const snapshot = state.status === 'ready' ? state.snapshot : undefined

  return (
    <div className={css.section}>
      {snapshot !== undefined ? (
        <p className={css.hint}>{t('profileHint', { name: snapshot.profileName })}</p>
      ) : null}
      <form className={css.form} onSubmit={(event) => { event.preventDefault(); submit() }}>
        <label className={css.field}>
          <span>{t('specLabel')}</span>
          <input
            type="text"
            value={spec}
            placeholder={t('specPlaceholder')}
            disabled={busy}
            onChange={(event) => { setSpec(event.currentTarget.value) }}
          />
        </label>
        <button type="submit" className={css.action} disabled={busy}>
          {busy ? t('importing') : t('importAction')}
        </button>
      </form>
      {validation !== null ? <p className={css.alert} role="alert">{validation}</p> : null}
      {submitError !== null ? <p className={css.alert} role="alert">{submitError}</p> : null}

      {report !== null ? (
        <section className={css.report} data-report-ok={report.ok ? 'true' : undefined}>
          {report.ok ? (
            report.addedBundles.length > 0 ? (
              <>
                <h3>{t('addedTitle')}</h3>
                <ul className={css.added}>
                  {report.addedBundles.map(name => <li key={name}><code>{name}</code></li>)}
                </ul>
                {report.applied
                  ? <p className={css.applied}>{t('appliedTag')}</p>
                  : (
                    <>
                      <p className={css.appliedFailed} role="alert">{t('applyFailedTag')}</p>
                      {report.applyError !== undefined
                        ? <p>{t('applyErrorLabel')}: {report.applyError}</p>
                        : null}
                      <p className={css.hint}>{t('applyFailedHint')}</p>
                    </>
                  )}
              </>
            )
              : <p className={css.hint}>{t('installedNoLayers')}</p>
          ) : (
            <>
              <h3 role="alert">{t('installFailedTitle')}</h3>
            </>
          )}
          <h4>{t('transcriptLabel')}</h4>
          <pre className={css.transcript}>{report.output}</pre>
        </section>
      ) : null}

      <section className={css.layers}>
        <h3>{t('currentTitle')}</h3>
        {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
        {state.status === 'error' ? (
          <div className={css.failure}>
            <p role="alert">{t('error')}</p>
            <button type="button" onClick={() => {
              setState({ status: 'loading' })
              setRequest(value => value + 1)
            }}>{t('retry')}</button>
          </div>
        ) : null}
        {state.status === 'ready' ? (
          state.snapshot.bundles.length === 0
            ? <p className={css.status}>{t('emptyLayers')}</p>
            : (
              <ul className={css.layerList}>
                {state.snapshot.bundles.map(row => (
                  <li key={row.name} className={css.layerRow} data-resolvable={row.resolvable ? 'true' : undefined}>
                    <code>{row.name}</code>
                    <span className={css.tag} data-kind={row.resolvable ? 'ok' : 'warn'}>
                      {row.resolvable ? t('resolvableTag') : t('unresolvedTag')}
                    </span>
                  </li>
                ))}
              </ul>
            )
        ) : null}
      </section>
    </div>
  )
}
