import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectStateAdapter, computeAuthorityFingerprint, createSkillHandoff, findDocsDirectory } from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(docsName = 'Docs'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-state-'))
  roots.push(root)
  await mkdir(join(root, docsName), { recursive: true })
  return root
}

async function packet(root: string, sources = ['WORK_ORDERS.md']): Promise<void> {
  const body = `---\ncontract_version: "2.0"\npacket_id: "test"\nauthority_fingerprint: "pending"\n---\n# Packet\n\n## Authority Sources\n\n${sources.map(source => `- \`${source}\``).join('\n')}\n\n## One Next Action\n\n- inspect the next task\n`
  await writeFile(join(root, 'Docs', 'ACTIVE_PACKET.md'), body)
  await writeFile(join(root, 'WORK_ORDERS.md'), '# WO-05 - State adapter\n\n## Outcome\n\n- read current project state\n\n## Non-Goal\n\n- no runtime acceptance\n')
}

describe('Personal Supervisor project state adapter', () => {
  it('locates Docs case-insensitively and rejects duplicate directories', async () => {
    const root = await fixture('docs')
    expect(await findDocsDirectory(root)).toBe(join(root, 'docs'))
    if (process.platform === 'win32') return
    const duplicate = join(root, 'DOCS')
    await mkdir(duplicate)
    await expect(findDocsDirectory(root)).rejects.toThrow(/Multiple case-insensitive/)
  })

  it('reads a compact packet, work order, and bounded recent loop records', async () => {
    const root = await fixture()
    await packet(root)
    const fingerprint = await computeAuthorityFingerprint(root, ['WORK_ORDERS.md'])
    const packetPath = join(root, 'Docs', 'ACTIVE_PACKET.md')
    const current = await readFile(packetPath, 'utf8')
    await writeFile(packetPath, current.replace('pending', fingerprint.fingerprint))
    await writeFile(join(root, 'LOOP_RUNS.jsonl'), [1, 2, 3, 4].map(loop => JSON.stringify({ record_version: '2.1', contract_version: '2.0', timestamp: '2026-08-31T00:00:00Z', packet_id: 'test', stage: 1, loop, role: 'Developer', result: 'Progress', progress_delta: `step ${loop}`, evidence: [], failure_signature: null, stage_review: 'Not Reviewed', context_stats: {}, next_action: 'continue' })).join('\n'))
    const state = await new ProjectStateAdapter({ recentLoopCount: 2 }).read(root)
    expect(state.status).toBe('valid')
    expect(state.packet?.oneNextAction).toBe('inspect the next task')
    expect(state.workOrder?.workOrderId).toBe('WO-05')
    expect(state.recentLoops.map(loop => loop.loop)).toEqual([3, 4])
    expect(state.authorityFingerprint).toBe(fingerprint.fingerprint)
  })

  it('returns conflict and performs zero writes when fingerprint is stale', async () => {
    const root = await fixture()
    await packet(root)
    const before = await readFile(join(root, 'Docs', 'ACTIVE_PACKET.md'), 'utf8')
    const state = await new ProjectStateAdapter().read(root)
    expect(state.status).toBe('conflicted')
    expect(state.conflicts.some(item => item.code === 'fingerprint-mismatch')).toBe(true)
    const refreshed = await new ProjectStateAdapter().refresh(root)
    expect(refreshed.written).toBe(false)
    expect(refreshed.reason).toBe('conflict')
    expect(await readFile(join(root, 'Docs', 'ACTIVE_PACKET.md'), 'utf8')).toBe(before)
  })

  it('accepts Markdown links and plain-list authority sources', async () => {
    const root = await fixture()
    await writeFile(join(root, 'ACCEPTANCE.md'), '# Acceptance\n')
    const packetText = '---\ncontract_version: "2.0"\npacket_id: "test"\nauthority_fingerprint: "pending"\n---\n# Packet\n\n## Authority Sources\n\n- [Work order](WORK_ORDERS.md)\n- ACCEPTANCE.md\n\n## One Next Action\n\n- inspect\n'
    await writeFile(join(root, 'Docs', 'ACTIVE_PACKET.md'), packetText)
    await writeFile(join(root, 'WORK_ORDERS.md'), '# WO-05 - State\n')
    const fingerprint = await computeAuthorityFingerprint(root, ['WORK_ORDERS.md', 'ACCEPTANCE.md'])
    await writeFile(join(root, 'Docs', 'ACTIVE_PACKET.md'), packetText.replace('pending', fingerprint.fingerprint))
    const state = await new ProjectStateAdapter().read(root)
    expect(state.status).toBe('valid')
    expect(state.authoritySources).toEqual(expect.arrayContaining(['WORK_ORDERS.md', 'ACCEPTANCE.md']))
  })

  it('flags malformed Loop Runs without promoting them to evidence', async () => {
    const root = await fixture()
    await packet(root)
    const fingerprint = await computeAuthorityFingerprint(root, ['WORK_ORDERS.md'])
    const packetPath = join(root, 'Docs', 'ACTIVE_PACKET.md')
    await writeFile(packetPath, (await readFile(packetPath, 'utf8')).replace('pending', fingerprint.fingerprint))
    await writeFile(join(root, 'LOOP_RUNS.jsonl'), '{not-json}\n{"loop": 2, "result": "Progress"}\n')
    const state = await new ProjectStateAdapter().read(root)
    expect(state.status).toBe('corrupt')
    expect(state.conflicts[0]?.code).toBe('corrupt-loop')
    expect(state.recentLoops).toHaveLength(0)
  })

  it('rejects authority sources that resolve outside the workspace', async () => {
    const root = await fixture()
    const outside = await mkdtemp(join(tmpdir(), 'dsh-supervisor-outside-'))
    roots.push(outside)
    await packet(root, [join(outside, 'secret.md')])
    const state = await new ProjectStateAdapter().read(root)
    expect(state.status).toBe('conflicted')
    expect(state.conflicts.some(item => item.code === 'missing-source')).toBe(true)
  })

  it('creates content-free, purpose-specific skill handoffs', () => {
    expect(createSkillHandoff('cms-project-governance', 'authority changed')).toEqual(expect.objectContaining({ purpose: 'state', invocation: 'load-on-demand' }))
    expect(createSkillHandoff('agent-loop-engineering', 'dispatch is authorized')).toEqual(expect.objectContaining({ purpose: 'execution', invocation: 'load-on-demand' }))
  })

  it('does not follow a Docs symlink outside the workspace', async () => {
    if (process.platform === 'win32') return
    const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-state-'))
    roots.push(root)
    const outside = await mkdtemp(join(tmpdir(), 'dsh-supervisor-docs-outside-'))
    roots.push(outside)
    await symlink(outside, join(root, 'DoCs'))
    await expect(findDocsDirectory(root)).rejects.toThrow(/escapes workspace/)
  })
})
