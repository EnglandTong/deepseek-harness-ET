/**
 * Keyless dual-plugin snapshot entry: documents the assembled cordis profile and
 * asserts the composition suite remains the executable proof until a live
 * HarnessAdapter fixture is available for loader-smoke.
 * @module supervisor-governance-snapshot
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = dirname(fileURLToPath(import.meta.url))
const ymlPath = join(root, '../supervisor-governance.cordis.snapshot.yml')

describe('personal supervisor governance dual-plugin snapshot profile', () => {
  it('mounts both supervisor executors bridge and the governance executor adapter', async () => {
    const yml = await readFile(ymlPath, 'utf8')
    expect(yml).toContain("name: '@deepseek-ai/dsh-supervisor-executor-subagent'")
    expect(yml).toContain("name: '@deepseek-ai/dsh-agent-governance'")
    expect(yml).toContain("name: '@deepseek-ai/dsh-supervisor-executor-governance'")
    expect(yml).toContain('providerName: supervisor-governance')
    expect(yml).toContain("name: '@deepseek-ai/dsh-supervisor-memory'")
  })
})
