/**
 * Assembled-app regression for the real in-process executor: the routed task
 * dispatches through `supervisor-spawn`, whose child runs inside the routed
 * project's workspace with a reserved identity admitted by the host gate.
 * @module supervisor-inprocess-snapshot
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'

const scenarioDir = join(dirname(fileURLToPath(import.meta.url)), 'supervisor-inprocess-snapshots', 'real-dispatch')
const childReplay = join(scenarioDir, 'child.replay.jsonl')
const streamExpected = join(scenarioDir, 'stream.expected.jsonl')
const childFactsExpected = join(scenarioDir, 'child-facts.expected.json')
const configPath = fileURLToPath(new URL('../supervisor-inprocess.cordis.snapshot.yml', import.meta.url))
const binScript = fileURLToPath(new URL('./fixtures/supervisor-inprocess-driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const refreshing = process.env.DSH_SNAPSHOT === 'refresh'
const SNAPSHOT_TIMEOUT_MS = 150_000

/** One auto-approved route naming the real in-process adapter. */
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
  '    executor: supervisor-spawn',
  '    provider: deepseek',
  '    model: replay-child',
  '    permissionCeiling: read',
  '    approval: auto',
  '',
].join('\n')

interface JsonObject {
  [key: string]: unknown
}

function parseRows(content: string): JsonObject[] {
  return content.split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as JsonObject)
}

describe('personal supervisor in-process executor snapshot', () => {
  it('dispatches a routed child into the project workspace through the real adapter', async () => {
    const result = await runLoaderSmoke({
      label: 'Personal Supervisor in-process executor snapshot',
      tempDirPrefix: 'headless-snapshot-supervisor-inprocess-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath],
      tsconfigPath,
      processTimeoutMs: 120_000,
      env: {
        DSH_SNAPSHOT: 'inprocess',
        DSH_SNAPSHOT_FILE: childReplay,
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
      prepare: async (cwd) => {
        await mkdir(join(cwd, 'project-alpha'), { recursive: true })
        const profileDir = join(cwd, '.dsh', 'profiles', 'supervisor')
        await mkdir(profileDir, { recursive: true })
        await writeFile(join(profileDir, 'supervisor-routing.yml'), routingPolicy)
      },
      inspect: async (cwd) => {
        const root = join(cwd, '.sessions')
        const files = (await readdir(root, { recursive: true })).filter(file => file.endsWith('session.jsonl'))
        const logs = await Promise.all(files.map(async file => parseRows(await readFile(join(root, file), 'utf8'))))
        const controller = logs.find(rows => rows[0]?.['id'] === 'supervisor-main')
        expect(controller).toBeDefined()
        const child = logs.find(rows => rows[0]?.['origin'] === 'subagent')
        expect(child).toBeDefined()
        const header = child![0] ?? {}
        // The child ran in the routed project's workspace, not the controller's.
        expect(header['cwd']).toBe(join(cwd, 'project-alpha'))
        expect(header['parentSession']).toBe('supervisor-main')
        expect(header['delegationDepth']).toBe(1)

        const descriptor = child!.find(row => row['type'] === 'subagent/descriptor')?.['data'] as JsonObject | undefined
        expect(descriptor).toMatchObject({ version: 2, mode: 'one-shot', provider: 'supervisor-spawn' })
        expect(String(descriptor?.['label'])).toMatch(/^supervisor:supervisor-task:/)

        const turnEnd = child!.findLast(row => row['type'] === 'turn/end')
        expect(turnEnd).toMatchObject({ data: { reason: { kind: 'completed' } } })
        const output = child!.filter(row => row['type'] === 'assistant/chunk')
          .map(row => (row['data'] as JsonObject | undefined)?.['chunk'] as JsonObject | undefined)
          .filter(chunk => chunk?.['type'] === 'text-delta')
          .map(chunk => String(chunk?.['text']))
          .join('')
        expect(output).toContain('INPROCESS_EXECUTION_DONE')

        // The host gate linked the run before model work: one host, one child,
        // no write access at the read permission ceiling.
        const links = controller!.filter(row => row['type'] === 'supervisor/run-linked')
          .map((row) => {
            const data = row['data'] as JsonObject | undefined
            return ((data?.['snapshot'] ?? data?.['link'] ?? data) as JsonObject)
          })
        expect(links).toHaveLength(1)
        const childSessionId = links[0]?.['childSessionId']
        const facts = {
          writeAccess: links[0]?.['writeAccess'],
          childCwdIsProject: typeof childSessionId === 'string' && childSessionId.length > 0
            && header['cwd'] === join(cwd, 'project-alpha'),
          descriptorProvider: descriptor?.['provider'],
          outputMarker: output.includes('INPROCESS_EXECUTION_DONE'),
        }
        if (refreshing) {
          await mkdir(scenarioDir, { recursive: true })
          await writeFile(childFactsExpected, `${JSON.stringify(facts, null, 2)}\n`)
        }
        expect(JSON.stringify(facts, null, 2)).toBe((await readFile(childFactsExpected, 'utf8')).trimEnd())
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
