/** The optional bundle is validated as a patch artifact, not by starting a provider process. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

interface Manifest {
  readonly name?: string
  readonly dependencies?: Record<string, string>
  readonly dsh?: { readonly bundle?: { readonly patch?: string } }
}

interface Row {
  readonly id?: string
  readonly name?: string
  readonly config?: Record<string, unknown>
}

function packageRoot(): string {
  return fileURLToPath(new URL('..', import.meta.url))
}

function readManifest(): Manifest {
  return JSON.parse(readFileSync(resolve(packageRoot(), 'package.json'), 'utf8')) as Manifest
}

function readRows(file = 'cordis.patch.yml'): Row[] {
  const parsed = yaml.load(readFileSync(resolve(packageRoot(), file), 'utf8'), { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new TypeError(`${file} must contain a patch list`)
  return parsed.flatMap((patch) => {
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return []
    const rows = (patch as { insert?: unknown }).insert
    return Array.isArray(rows) ? rows.filter((row): row is Row => typeof row === 'object' && row !== null && !Array.isArray(row)) : []
  })
}

function flattenStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(flattenStrings)
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(flattenStrings)
  return []
}

describe('@deepseek-ai/dsh-personal-supervisor bundle', () => {
  it('declares a parseable optional bundle and all mounted services', () => {
    const manifest = readManifest()
    expect(manifest.name).toBe('@deepseek-ai/dsh-personal-supervisor')
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const rows = readRows()
    expect(rows.map(row => row.id)).toEqual([
      'supervisor',
      'supervisor-session',
      'supervisor-project-registry',
      'supervisor-project-host',
      'supervisor-executors',
      'supervisor-orchestrator',
      'supervisor-memory',
      'supervisor-interaction',
      'supervisor-api',
      'supervisor-ui',
    ])
    expect(rows.map(row => row.name)).toContain('@deepseek-ai/dsh-supervisor')
    expect(rows.find(row => row.id === 'supervisor-orchestrator')?.config).toEqual({
      maxRepairAttempts: 2,
      autoDispatch: true,
      retryOnFailure: true,
    })
    expect(rows.find(row => row.id === 'supervisor-memory')?.config).toEqual({
      maxSummaryChars: 1200,
      maxBriefSummaries: 12,
      maxBriefNotifications: 12,
      compactionThreshold: 0.75,
    })
  })

  it('does not mount production tools, credentials, or external CLI bundles', () => {
    const manifest = readManifest()
    const rows = readRows()
    const rowNames = new Set(rows.map(row => row.name))
    for (const prohibited of [
      '@deepseek-ai/dsh-tool-bash',
      '@deepseek-ai/dsh-tool-pwsh',
      '@deepseek-ai/dsh-tool-fs',
      '@deepseek-ai/dsh-tool-str-replace-editor',
      '@deepseek-ai/dsh-tool-subagent',
      '@deepseek-ai/dsh-tool-web',
      '@deepseek-ai/dsh-tool-goal',
      '@deepseek-ai/dsh-subagent-codex',
      '@deepseek-ai/dsh-subagent-claude-code',
    ]) {
      expect(rowNames.has(prohibited), prohibited).toBe(false)
      expect(manifest.dependencies).not.toHaveProperty(prohibited)
    }
    expect(flattenStrings(yaml.load(readFileSync(resolve(packageRoot(), 'cordis.patch.yml'), 'utf8'), { schema: entryListSchema })))
      .not.toEqual(expect.arrayContaining([expect.stringMatching(/api[_-]?key|password|token|secret|credential/i)]))
  })

  it('ships a controller-only preset without changing the profile default', () => {
    const manifest = readManifest()
    const preset = yaml.load(readFileSync(resolve(packageRoot(), 'preset/supervisor/agent.cordis.yml'), 'utf8'), { schema: entryListSchema })
    expect(Array.isArray(preset)).toBe(true)
    const rows = preset as Row[]
    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe('@deepseek-ai/dsh-persona')
    expect(rows[0]?.config?.complete).toBe(true)
    expect(rows[0]?.config?.includeRuntimeContext).toBe(false)
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-persona')
    expect(readFileSync(resolve(packageRoot(), 'preset/supervisor/preset.yml'), 'utf8')).toMatch(/Personal Supervisor/)
    expect(readFileSync(resolve(packageRoot(), 'routing-policy.example.yml'), 'utf8')).toMatch(/approval: confirm/)
  })
})
