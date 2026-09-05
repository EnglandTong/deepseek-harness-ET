// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginImportTab } from '../src/client/PluginImportTab.tsx'
import type {
  PluginImportSettingsTabInjected,
  PluginImportSettingsTabProps,
} from '../src/client/PluginImportTab.tsx'
import { en, type PluginImportLocaleKey } from '../src/client/locales.ts'
import type { BundleListSnapshot, ImportReport } from '@deepseek-ai/dsh-api-remotes/client'

afterEach(cleanup)

const t = ((key: PluginImportLocaleKey, params?: Record<string, string>): string =>
  Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, value),
    en[key],
  )) as PluginImportSettingsTabProps['t']

type ListBundles = PluginImportSettingsTabInjected['listBundles']
type ImportSpec = PluginImportSettingsTabInjected['importSpec']
type BrowseLocalPath = PluginImportSettingsTabInjected['browseLocalPath']

function props(
  listBundles: ListBundles,
  importSpec: ImportSpec = vi.fn(),
  browseLocalPath: BrowseLocalPath = vi.fn(async () => null),
): PluginImportSettingsTabProps {
  return { t, listBundles, importSpec, browseLocalPath } as PluginImportSettingsTabProps
}

const snapshotWith = (bundles: BundleListSnapshot['bundles']): BundleListSnapshot =>
  ({ profileName: 'web', bundles })

function specInput(): HTMLInputElement {
  return screen.getByRole('textbox', { name: new RegExp(en.specLabel) }) as HTMLInputElement
}

/** Render and wait until the layer list left its initial loading state. */
async function renderReady(bundles: BundleListSnapshot['bundles'] = []): Promise<void> {
  render(<PluginImportTab {...props(async () => snapshotWith(bundles))} />)
  await screen.findByText(en.currentTitle)
}

const submit = (): void => {
  fireEvent.click(screen.getByRole('button', { name: en.importAction }))
}

const okReport = (overrides: Partial<ImportReport>): ImportReport => ({
  ok: true,
  exitCode: 0,
  output: 'install transcript',
  addedBundles: [],
  applied: false,
  ...overrides,
})

describe('PluginImportTab', () => {
  it('shows the profile hint and an empty layer list', async () => {
    await renderReady()
    expect(screen.getByText(en.profileHint.replace('{name}', 'web'))).toBeTruthy()
    expect(screen.getByText(en.emptyLayers)).toBeTruthy()
    expect(specInput()).toBeTruthy()
    expect(screen.getByText(en.specHint)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.browseAction })).toBeTruthy()
  })

  it('tags each layer with its resolution state', async () => {
    await renderReady([
      { name: '@fixture/ok', resolvable: true },
      { name: '@fixture/missing', resolvable: false },
    ])
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.getAttribute('data-resolvable')).toBe('true')
    expect(rows[0]!.textContent).toContain(en.resolvableTag)
    expect(rows[1]!.getAttribute('data-resolvable')).toBeNull()
    expect(rows[1]!.textContent).toContain(en.unresolvedTag)
  })

  it('offers retry after a failed layer read', async () => {
    const listBundles = vi.fn<ListBundles>()
      .mockRejectedValueOnce(new Error('transport down'))
      .mockResolvedValue(snapshotWith([]))
    render(<PluginImportTab {...props(listBundles)} />)
    await screen.findByRole('alert')
    expect(screen.getByText(en.error)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await screen.findByText(en.emptyLayers)
    expect(listBundles).toHaveBeenCalledTimes(2)
  })

  it('rejects an empty spec locally without calling the Remote', async () => {
    const importSpec = vi.fn<ImportSpec>()
    await renderReady()
    submit()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(en.emptySpec))
    expect(importSpec).not.toHaveBeenCalled()
  })

  it('reports a successful install that hot-applied and refreshes the layer list', async () => {
    const listBundles = vi.fn<ListBundles>()
      .mockResolvedValueOnce(snapshotWith([]))
      .mockResolvedValue(snapshotWith([{ name: '@fixture/kit', resolvable: true }]))
    const importSpec = vi.fn<ImportSpec>().mockResolvedValue(
      okReport({ addedBundles: ['@fixture/kit'], applied: true }),
    )
    render(<PluginImportTab {...props(listBundles, importSpec)} />)
    await screen.findByText(en.emptyLayers)
    fireEvent.change(specInput(), { target: { value: ' @fixture/kit ' } })
    submit()
    expect(await screen.findByText(en.addedTitle)).toBeTruthy()
    expect(screen.getByText(en.appliedTag)).toBeTruthy()
    await waitFor(() => expect(screen.getAllByText('@fixture/kit').length).toBeGreaterThan(0))
    expect(importSpec).toHaveBeenCalledWith('@fixture/kit')
    expect(listBundles).toHaveBeenCalledTimes(2)
  })

  it('reports a hot-apply failure with its reason and the restart hint', async () => {
    const listBundles = vi.fn<ListBundles>()
      .mockResolvedValue(snapshotWith([]))
    const importSpec = vi.fn<ImportSpec>().mockResolvedValue(
      okReport({ addedBundles: ['@fixture/kit'], applied: false, applyError: 'the tree refused the re-apply' }),
    )
    render(<PluginImportTab {...props(listBundles, importSpec)} />)
    await screen.findByText(en.emptyLayers)
    fireEvent.change(specInput(), { target: { value: '@fixture/kit' } })
    submit()
    expect(await screen.findByText(en.applyFailedTag)).toBeTruthy()
    expect(screen.getByText(`${en.applyErrorLabel}: the tree refused the re-apply`)).toBeTruthy()
    expect(screen.getByText(en.applyFailedHint)).toBeTruthy()
  })

  it('omits the apply-error line when the report carries none', async () => {
    const listBundles = vi.fn<ListBundles>()
      .mockResolvedValue(snapshotWith([]))
    const importSpec = vi.fn<ImportSpec>().mockResolvedValue(
      okReport({ addedBundles: ['@fixture/kit'], applied: false }),
    )
    render(<PluginImportTab {...props(listBundles, importSpec)} />)
    await screen.findByText(en.emptyLayers)
    fireEvent.change(specInput(), { target: { value: '@fixture/kit' } })
    submit()
    expect(await screen.findByText(en.applyFailedTag)).toBeTruthy()
    expect(screen.queryByText(new RegExp(en.applyErrorLabel))).toBeNull()
    expect(screen.getByText(en.applyFailedHint)).toBeTruthy()
  })

  it('reports an install that produced no bundle layer', async () => {
    const listBundles = vi.fn<ListBundles>()
      .mockResolvedValue(snapshotWith([]))
    const importSpec = vi.fn<ImportSpec>().mockResolvedValue(okReport({}))
    render(<PluginImportTab {...props(listBundles, importSpec)} />)
    await screen.findByText(en.emptyLayers)
    fireEvent.change(specInput(), { target: { value: '@fixture/plain' } })
    submit()
    await screen.findByText(en.installedNoLayers)
    expect(screen.queryByText(en.addedTitle)).toBeNull()
  })

  it('reports a failed install with its transcript', async () => {
    const listBundles = vi.fn<ListBundles>()
      .mockResolvedValue(snapshotWith([]))
    const importSpec = vi.fn<ImportSpec>().mockResolvedValue({
      ok: false,
      exitCode: 1,
      output: 'ERR_PNPM_404 not found',
      addedBundles: [],
      applied: false,
    })
    render(<PluginImportTab {...props(listBundles, importSpec)} />)
    await screen.findByText(en.emptyLayers)
    fireEvent.change(specInput(), { target: { value: '@fixture/broken' } })
    submit()
    expect(await screen.findByText(en.installFailedTitle)).toBeTruthy()
    expect(screen.getByText('ERR_PNPM_404 not found')).toBeTruthy()
  })

  it('surfaces a Remote rejection as an alert and keeps the form usable', async () => {
    const listBundles = vi.fn<ListBundles>()
      .mockResolvedValue(snapshotWith([]))
    const importSpec = vi.fn<ImportSpec>().mockRejectedValue(new Error('connection lost'))
    render(<PluginImportTab {...props(listBundles, importSpec)} />)
    await screen.findByText(en.emptyLayers)
    fireEvent.change(specInput(), { target: { value: '@fixture/kit' } })
    submit()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('connection lost'))
    expect(screen.getByRole('button', { name: en.importAction })).toBeTruthy()
  })

  it('disables the form while installing', async () => {
    const listBundles = vi.fn<ListBundles>()
      .mockResolvedValue(snapshotWith([]))
    let release: (report: ImportReport) => void = () => {}
    const importSpec = vi.fn<ImportSpec>().mockImplementation(() => new Promise<ImportReport>((resolve) => {
      release = resolve
    }))
    render(<PluginImportTab {...props(listBundles, importSpec)} />)
    await screen.findByText(en.emptyLayers)
    fireEvent.change(specInput(), { target: { value: '@fixture/kit' } })
    submit()
    expect(screen.getByRole('button', { name: en.importing })).toBeTruthy()
    expect(specInput().disabled).toBe(true)
    await act(async () => {
      release(okReport({}))
    })
    await screen.findByText(en.installedNoLayers)
    expect(screen.getByRole('button', { name: en.importAction })).toBeTruthy()
  })

  it('fills the path from Browse and leaves cancel as a no-op', async () => {
    const browseLocalPath = vi.fn<BrowseLocalPath>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('/tmp/local-bundle')
    render(<PluginImportTab {...props(async () => snapshotWith([]), vi.fn(), browseLocalPath)} />)
    await screen.findByText(en.emptyLayers)
    fireEvent.click(screen.getByRole('button', { name: en.browseAction }))
    await waitFor(() => expect(browseLocalPath).toHaveBeenCalledOnce())
    expect(specInput().value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: en.browseAction }))
    await waitFor(() => expect(specInput().value).toBe('/tmp/local-bundle'))
  })
})
