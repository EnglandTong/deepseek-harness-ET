// Keyless assembled-browser coverage for the Personal Supervisor dashboard
// over the REAL host wire: the controller work order is captured through the
// real command runtime (the same stub-agent shape the headless supervisor
// snapshot drives), the confirmation gate surfaces the dashboard's Approve
// control, and the compare-and-set approval dispatches the keyless fixture
// child to ReadyForReview. A second page pins the fixture-transport degraded
// path: the unavailable Supervisor API renders an error instead of
// fabricated state.

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { RoutingPolicyRouter } from '@deepseek-ai/dsh-supervisor-routing-policy'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'
import { createE2eExecutor, E2E_ROUTING_POLICY, registerControllerStub } from './fixtures/supervisor-e2e-executor.ts'
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/supervisor-dashboard', import.meta.url))
const DASHBOARD_GOLDEN = join(SNAPSHOT_DIR, 'dashboard.expected.md')
const OVERLAY = fileURLToPath(new URL('./supervisor-dashboard.overlay.yml', import.meta.url))
const MODE = webSnapshotMode()
const OPEN_LABEL = 'Open Personal Supervisor'
const READY_LABEL = 'ready for review'

/** beforeAll-safe condition wait: poll until the predicate holds or the budget runs out. */
async function waitFor(predicate: () => boolean, what: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`supervisor dashboard e2e: ${what} never settled within ${String(timeoutMs)}ms`)
}

describe('web e2e: supervisor dashboard over the running host', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let projectBase: string
  let projectDir: string
  let projectId: string

  beforeAll(async () => {
    projectBase = await mkdtemp(join(tmpdir(), 'supervisor-dashboard-e2e-'))
    projectDir = join(projectBase, 'project-alpha')
    await mkdir(projectDir, { recursive: true })
    scaffold = await launchWebScaffold({
      extraOverlayPath: OVERLAY,
      // The overlay mounts the personal-supervisor bundle's rows; healing its
      // manifest makes the whole supervisor package closure resolvable from
      // the temp profile root.
      extraInstallAnchors: [fileURLToPath(new URL('../../../packages/bundle/personal-supervisor/package.json', import.meta.url))],
    })
    // The keyless routing policy, fixture executor, and controller stub
    // register through the public services after boot: the scaffold resolves
    // row names against its temp profile root, so test-owned providers
    // cannot be overlay rows, and the owner commands run against the same
    // stub-agent shape the headless supervisor snapshot drives.
    const controller = registerControllerStub(scaffold.ctx)
    scaffold.ctx.supervisor.registerRouter(new RoutingPolicyRouter(E2E_ROUTING_POLICY))
    scaffold.ctx.supervisorExecutors.register(createE2eExecutor(scaffold.ctx))
    const signal = new AbortController().signal
    const registerRun = await scaffold.ctx.commands.execute(
      controller,
      `/supervisor_register_project ${projectDir} Project Alpha`,
      [],
      signal,
    )
    await waitFor(
      () => scaffold.ctx.supervisor.listProjects().length >= 1,
      `project registration (execute returned: ${JSON.stringify(registerRun)})`,
    )
    projectId = scaffold.ctx.supervisor.listProjects()[0]?.id as string
    const captureRun = await scaffold.ctx.commands.execute(
      controller,
      `/supervisor_capture ${projectId} Summarize the ledger :: Collect the current status of every registered project. :: Report the summary for owner review`,
      [],
      signal,
    )
    if (scaffold.ctx.supervisorOrchestrator.listTasks().length === 0) {
      throw new Error(`supervisor dashboard e2e: capture produced no task; register=${JSON.stringify(registerRun?.result)} capture=${JSON.stringify(captureRun?.result)}`)
    }
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    await rm(projectBase, { recursive: true, force: true }).catch(() => undefined)
  })

  it('shows the gated task and approves it into review from the dashboard', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-supervisor-dashboard'))
    onTestFailed(async () => { console.log('DEBUG_BODY_ARIA\n' + await page.locator('body').ariaSnapshot().catch((error: unknown) => `unavailable: ${String(error)}`)) })

    // The capture left the task at the confirmation gate.
    await expect.poll(
      () => scaffold.ctx.supervisorOrchestrator.listTasks().some(task => task.status === 'AwaitingApproval'),
      { timeout: 15_000 },
    ).toBe(true)

    // The dashboard opens over the real gateway projection and the gate card
    // offers the owner action pair.
    await page.getByRole('button', { name: OPEN_LABEL }).click()
    const aside = page.locator('[data-aside]')
    await expect.poll(() => aside.getByText('Project Alpha').count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(1)
    await expect.poll(() => aside.getByRole('button', { name: 'Approve' }).count(), { timeout: 15_000 }).toBe(1)
    expect(aside.getByText('Project Alpha')).toBeDefined()
    expect(aside.getByText('Summarize the ledger')).toBeDefined()
    expect(aside.getByText('blocked')).toBeDefined()

    // The compare-and-set approval dispatches the fixture child; the card
    // settles at ReadyForReview through the refreshed projection. The host
    // ledger settles first, then the card: assert the CARD (the summary line
    // also says "ready for review", so dialog-wide text cannot discriminate).
    await aside.getByRole('button', { name: 'Approve' }).click()
    try {
      await waitFor(
        () => scaffold.ctx.supervisorOrchestrator.listTasks().some(task => task.status === 'ReadyForReview'),
        'task review settlement',
        20_000,
      )
    } catch (error: unknown) {
      throw new Error(`${String(error)} :: tasks=${JSON.stringify(scaffold.ctx.supervisorOrchestrator.listTasks())}`)
    }
    const card = aside.locator('article')
    await expect.poll(() => card.textContent(), { timeout: 20_000 }).toContain(READY_LABEL)
    await expect.poll(async () => await card.getByRole('button', { name: 'Working\u2026' }).count(), { timeout: 10_000 }).toBe(0)

    const snapshot = await captureStableAria(page, '[data-aside]', scaffold.workspaceCwd)
    await mkdir(SNAPSHOT_DIR, { recursive: true })
    await compareOrRefreshGolden(DASHBOARD_GOLDEN, snapshot, MODE)

    // The run's child reference stays a read-only pointer: expanding it
    // renders the run's transcript rows and never a composer.
    await expect.poll(() => aside.getByRole('button', { name: 'View read-only run session' }).count(), { timeout: 10_000 }).toBe(1)
    await aside.getByRole('button', { name: 'View read-only run session' }).click()
    let dialogText = ''
    await expect.poll(() => aside.textContent().then((value) => { dialogText = value ?? ''; return dialogText }), { timeout: 10_000 }).toContain('E2E_EXECUTION_DONE')
    expect(aside.getByText('Assistant')).toBeDefined()
    expect(aside.getByText('Collect the current status.')).toBeDefined()
    expect(await aside.getByRole('button', { name: 'Load earlier messages' }).count()).toBe(0)
    expect(await aside.getByRole('textbox').count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 120_000)

  it('shows the Host error instead of fabricated state when the API is unavailable', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-supervisor-dashboard-fixture'))
    const fixturePage = await newEnglishPage(browser)
    try {
      await fixturePage.goto(`${scaffold.baseUrl}?fixture`, { waitUntil: 'load' })
      await fixturePage.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      // The fixture transport's settings leave the welcome notice pending; its
      // mask intercepts pointer events, so open the dashboard via a direct
      // DOM click like the goal scenario's rapid-click gesture.
      await fixturePage.getByRole('button', { name: OPEN_LABEL }).evaluate((button) => { (button as HTMLButtonElement).click() })
      const aside = fixturePage.locator('[data-aside]')
      await expect.poll(() => aside.locator('[role="alert"]').count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(1)
      await expect.poll(() => aside.locator('[role="alert"]').textContent(), { timeout: 10_000 })
        .toContain('Supervisor service unavailable')
      expect(await aside.getByText('Project Alpha').count()).toBe(0)
    } finally {
      await fixturePage.close()
    }
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['dashboard.expected.md'])
  })
})
