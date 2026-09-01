import { describe, expect, it } from 'vitest'
import { SupervisorId, SupervisorProjectId, SupervisorTaskId } from '@deepseek-ai/dsh-supervisor'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SupervisorEvent } from '@deepseek-ai/dsh-supervisor'
import { assertSupervisorMemoryCheckpoint, assertSupervisorRollingSummary } from '../src/invariant.ts'
import {
  createMemoryCheckpoint,
  createSupervisorQueryBrief,
  digestMemoryRecords,
  projectSupervisorMemory,
  reconcileSupervisorMemory,
  shouldCompactMemory,
  summarizeSupervisorMemory,
} from '../src/index.ts'
import type { ProjectGovernanceState } from '@deepseek-ai/dsh-supervisor-project-state'
import type { SupervisorMemoryRecord } from '../src/types.ts'

const project = SupervisorProjectId('project-a')
const task = SupervisorTaskId('task-a')

function eventFixture(title = 'Implement memory'): readonly SupervisorMemoryRecord[] {
  const events: SupervisorEvent[] = [
    { type: 'supervisor/identity', version: 1, snapshot: { revision: 1, id: SupervisorId('supervisor'), sessionId: SessionId('supervisor-main'), createdAt: '2026-08-31T00:00:00.000Z' } },
    { type: 'supervisor/project', version: 1, snapshot: { revision: 1, id: project, displayName: 'Project A', realPath: 'C:/work/a', status: 'registered', registeredAt: '2026-08-31T00:00:00.000Z' } },
    { type: 'supervisor/task', version: 1, snapshot: { revision: 1, id: task, projectId: project, title, description: 'A bounded task', status: 'Captured', nextAction: 'Classify task' } },
  ]
  return events.map((event, index) => ({ seq: index + 1, event }))
}

function governance(fingerprint = 'sha256:one'): { projectId: typeof project; state: ProjectGovernanceState } {
  return {
    projectId: project,
    state: {
      workspacePath: 'C:/work/a',
      authorityFingerprint: fingerprint,
      authoritySources: ['docs/ACTIVE_PACKET.md'],
      recentLoops: [],
      conflicts: [],
      status: 'valid',
    },
  }
}

describe('Supervisor memory projection', () => {
  it('replays structured state and emits provenance-bearing summaries', () => {
    const records = eventFixture()
    const projection = projectSupervisorMemory(records, [governance()])
    const summaries = summarizeSupervisorMemory(records, projection, '2026-08-31T01:00:00.000Z')
    expect(projection.sourceSeq).toBe(3)
    expect(summaries[0]).toMatchObject({ projectId: project, taskIds: [task], projectRevision: 1, authorityFingerprint: 'sha256:one', sourceRange: { start: 2, end: 3 } })
    expect(summaries[0]?.evidence.some(reference => reference.kind === 'event' && reference.seq === 3)).toBe(true)
    assertSupervisorRollingSummary(summaries[0]!)
  })

  it('rejects gaps and produces a deterministic raw digest', () => {
    const records = eventFixture()
    expect(() => projectSupervisorMemory([{ ...records[1]!, seq: 4 }])).toThrow(/contiguous/)
    expect(digestMemoryRecords(records)).toBe(digestMemoryRecords(records))
    expect(digestMemoryRecords(records)).not.toBe(digestMemoryRecords(eventFixture('Changed title')))
  })

  it('reuses, tail-replays, and fully replays checkpoints on restart', () => {
    const records = eventFixture()
    const projection = projectSupervisorMemory(records, [governance()])
    const summaries = summarizeSupervisorMemory(records, projection, '2026-08-31T01:00:00.000Z')
    const checkpoint = createMemoryCheckpoint(records, summaries, projection)
    expect(reconcileSupervisorMemory(records, checkpoint, [governance()]).action).toBe('reused')
    const appended = [...records, { seq: 4, event: { type: 'supervisor/task', version: 1, snapshot: { revision: 2, id: task, projectId: project, title: 'Implement memory', description: 'A bounded task', status: 'Classified', nextAction: 'Dispatch task' } } as SupervisorEvent }]
    expect(reconcileSupervisorMemory(appended, checkpoint, [governance()]).action).toBe('tail-replayed')
    expect(reconcileSupervisorMemory(eventFixture('Changed title'), checkpoint, [governance()]).action).toBe('fully-replayed')
  })

  it('invalidates summaries when the authority fingerprint changes', () => {
    const records = eventFixture()
    const projection = projectSupervisorMemory(records, [governance()])
    const checkpoint = createMemoryCheckpoint(records, summarizeSupervisorMemory(records, projection), projection)
    const result = reconcileSupervisorMemory(records, checkpoint, [governance('sha256:two')])
    expect(result.action).toBe('invalidated')
    expect(result.invalidatedProjectIds).toEqual([project])
    expect(result.checkpoint.summaries[0]?.authorityFingerprint).toBe('sha256:two')
  })

  it('bounds query briefs and separates pressure from compaction execution', () => {
    const records = eventFixture()
    const projection = projectSupervisorMemory(records, [governance()])
    const summaries = summarizeSupervisorMemory(records, projection)
    const brief = createSupervisorQueryBrief(projection, [...summaries, ...summaries], 'What is next?', { maxSummaryChars: 80, maxBriefSummaries: 1, maxBriefNotifications: 1, compactionThreshold: 0.75 })
    expect(brief.summaries).toHaveLength(1)
    expect(brief.truncated).toBe(true)
    expect(shouldCompactMemory({ promptTokens: 75, contextLimit: 100 })).toBe(true)
    expect(shouldCompactMemory({ promptTokens: 74, contextLimit: 100 })).toBe(false)
  })

  it('rejects malformed checkpoint versions and unsafe summary ranges', () => {
    const records = eventFixture()
    const projection = projectSupervisorMemory(records)
    const checkpoint = createMemoryCheckpoint(records, summarizeSupervisorMemory(records, projection), projection)
    expect(() =>{  assertSupervisorMemoryCheckpoint({ ...checkpoint, version: 2 }) }).toThrow(/unsupported/)
    expect(() => {
      assertSupervisorRollingSummary({ ...checkpoint.summaries[0]!, sourceRange: { start: 3, end: 2 } })
    }).toThrow(/source range/)
  })
})
