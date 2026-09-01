/**
 * Assembled-app regression for the Personal Supervisor: one durable controller
 * session, project-bound execution hosts, YAML policy gating, and restart.
 * @module supervisor-snapshot
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'

const scenarioDir = join(dirname(fileURLToPath(import.meta.url)), 'supervisor-snapshots', 'durable-ledger')
const streamExpected = join(scenarioDir, 'stream.expected.jsonl')
const ledgerExpected = join(scenarioDir, 'ledger.expected.jsonl')
const graphExpected = join(scenarioDir, 'graph.expected.json')
const configPath = fileURLToPath(new URL('../supervisor.cordis.snapshot.yml', import.meta.url))
const binScript = fileURLToPath(new URL('./fixtures/supervisor-driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const refreshing = process.env.DSH_SNAPSHOT === 'refresh'
const SNAPSHOT_TIMEOUT_MS = 150_000

/** One auto-approved route plus profile defaults that gate everything else. */
const routingPolicy = [
  'version: 1',
  'defaults:',
  '  approval: confirm',
  '  permissionCeiling: read',
  '  timeoutMs: 30000',
  '  costTier: unknown',
  'routes:',
  '  - id: supervisor-command',
  '    taskType:',
  '      - supervisor-command',
  '    executor: fixture-subagent',
  '    provider: deepseek',
  '    permissionCeiling: write',
  '    approval: auto',
  '',
].join('\n')

interface JsonObject {
  [key: string]: unknown
}

interface PersistedLog {
  readonly file: string
  readonly content: string
  readonly header: JsonObject
  readonly rows: JsonObject[]
}

function parseRows(content: string): JsonObject[] {
  return content.split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as JsonObject)
}

async function persistedLogs(cwd: string): Promise<PersistedLog[]> {
  const root = join(cwd, '.sessions')
  const files = (await readdir(root, { recursive: true })).filter(file => file.endsWith('session.jsonl'))
  const logs = await Promise.all(files.map(async (file) => {
    const content = await readFile(join(root, file), 'utf8')
    const rows = parseRows(content)
    return { file, content, header: rows[0] ?? {}, rows: rows.slice(1) }
  }))
  return logs.sort((left, right) => Number(left.header.createdAt) - Number(right.header.createdAt))
}

/** Payload carried by a scoped Supervisor event row. */
function payload(row: JsonObject): JsonObject {
  const data = row.data as JsonObject | undefined
  const value = (data?.snapshot ?? data?.link ?? data?.notification ?? data?.policy ?? data) as JsonObject | undefined
  return value ?? {}
}

/** Project the durable controller ledger without run-varying identifiers. */
function ledger(rows: readonly JsonObject[]): string {
  return rows.filter(row => typeof row.type === 'string' && row.type.startsWith('supervisor/')).map((row) => {
    const facts = payload(row)
    const type = String(row.type).slice('supervisor/'.length)
    const keep = ['revision', 'status', 'displayName', 'title', 'blocker', 'kind', 'message', 'executor', 'requiresApproval', 'writeAccess', 'reason', 'sessionId'] as const
    const record: JsonObject = { type }
    for (const key of keep) {
      const value = facts[key]
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') record[key] = value
    }
    return JSON.stringify(record)
  }).join('\n') + '\n'
}

describe('personal supervisor durable ledger snapshot', () => {
  it('governs two projects from one restartable controller session', async () => {
    let graph: unknown
    const result = await runLoaderSmoke({
      label: 'Personal Supervisor durable ledger snapshot',
      tempDirPrefix: 'headless-snapshot-supervisor-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath],
      tsconfigPath,
      processTimeoutMs: 120_000,
      env: {
        DSH_SNAPSHOT: 'supervisor',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
      prepare: async (cwd) => {
        for (const name of ['project-alpha', 'project-beta', 'project-gamma']) {
          await mkdir(join(cwd, name), { recursive: true })
        }
        const profileDir = join(cwd, '.dsh', 'profiles', 'supervisor')
        await mkdir(profileDir, { recursive: true })
        await writeFile(join(profileDir, 'supervisor-routing.yml'), routingPolicy)
      },
      inspect: async (cwd) => {
        const logs = await persistedLogs(cwd)
        const controller = logs.filter(log => log.header.id === 'supervisor-main')
        expect(controller).toHaveLength(1)
        const main = controller[0]
        if (main === undefined) throw new Error('the supervisor did not persist its controller session')

        // The controller is restored, never duplicated, and holds no tool activity.
        const identities = main.rows.filter(row => row.type === 'supervisor/identity')
        expect(identities).toHaveLength(1)
        expect(main.rows.filter(row => row.type === 'tool/call' || row.type === 'tool/result')).toHaveLength(0)
        expect(ledger(main.rows)).toContain('"sessionId":"supervisor-main"')

        // The controller ledger is the authority for which project root and
        // which execution host every work order was bound to.
        const projects = new Map(main.rows.filter(row => row.type === 'supervisor/project').map(row => payload(row))
          .map(project => [String(project.id), String(project.realPath)]))
        expect([...projects.values()].sort())
          .toEqual([join(cwd, 'project-alpha'), join(cwd, 'project-beta'), join(cwd, 'project-gamma')].sort())

        const links = main.rows.filter(row => row.type === 'supervisor/run-linked').map(row => payload(row))
        expect(links.length).toBeGreaterThan(1)
        // Each project resolves to exactly one host session, so no work order
        // can reach another project's execution scope.
        const hostByProject = new Map(links.map(link => [String(link.projectId), String(link.hostSessionId)]))
        expect(new Set(hostByProject.values()).size).toBe(hostByProject.size)
        for (const [projectId, hostSessionId] of hostByProject) {
          expect(projects.has(projectId)).toBe(true)
          expect(hostSessionId).toContain('supervisor-project-host:')
        }
        const tasks = main.rows.filter(row => row.type === 'supervisor/task').map(row => payload(row))
        const latest = new Map(tasks.map(task => [String(task.title), task]))
        expect([...latest.values()].filter(task => task.status === 'Accepted')).toHaveLength(1)
        graph = {
          controllerSessions: controller.length,
          hostSessions: hostByProject.size,
          runsPerProject: [...projects].map(([projectId, realPath]) => ({
            project: realPath.split(/[\\/]/u).pop(),
            runs: links.filter(link => String(link.projectId) === projectId).length,
          })),
          finalStatuses: [...latest.values()].map(task => ({ title: task.title, status: task.status, revision: task.revision }))
            .sort((left, right) => String(left.title).localeCompare(String(right.title))),
        }
        const settings = await readFile(join(cwd, '.dsh', 'settings.yaml'), 'utf8')
        expect(settings).toContain('supervisorSessionId')

        if (refreshing) {
          await mkdir(scenarioDir, { recursive: true })
          await writeFile(ledgerExpected, ledger(main.rows))
          await writeFile(graphExpected, `${JSON.stringify(graph, null, 2)}\n`)
        }
        expect(ledger(main.rows)).toBe(await readFile(ledgerExpected, 'utf8'))
        expect(JSON.stringify(graph, null, 2)).toBe((await readFile(graphExpected, 'utf8')).trimEnd())
      },
    })

    expect(result.stderr).toBe('')
    if (refreshing) {
      await mkdir(scenarioDir, { recursive: true })
      await writeFile(streamExpected, result.stdout)
    }
    expect(result.stdout).toBe(await readFile(streamExpected, 'utf8'))
  }, SNAPSHOT_TIMEOUT_MS)
})
