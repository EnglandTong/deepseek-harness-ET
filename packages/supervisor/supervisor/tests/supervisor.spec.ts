import { describe, expect, it } from 'vitest'
import { assertSupervisorEvent, SUPERVISOR_EVENT_VERSION } from '../src/events.ts'
import { assertTaskTransition, foldSupervisor } from '../src/fold.ts'
import { assertSupervisorProjection } from '../src/invariant.ts'
import { SupervisorId, SupervisorProjectId, SupervisorTaskId } from '../src/types.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import SupervisorService from '../src/index.ts'

const project = SupervisorProjectId('project-a')
const task = SupervisorTaskId('task-a')

describe('Supervisor public contract', () => {
  it('exposes the Cordis loader default plugin entry', () => {
    expect(SupervisorService.name).toBe('SupervisorService')
  })

  it('accepts every documented task transition and rejects terminal or skipped edges', () => {
    const edges: [Parameters<typeof assertTaskTransition>[0], Parameters<typeof assertTaskTransition>[1]][] = [
      ['Captured', 'Classified'], ['Classified', 'AwaitingApproval'], ['Classified', 'Ready'],
      ['AwaitingApproval', 'Ready'], ['AwaitingApproval', 'Cancelled'], ['Ready', 'Dispatched'],
      ['Dispatched', 'Running'], ['Dispatched', 'Failed'], ['Running', 'NeedsOwnerDecision'],
      ['Running', 'NeedsFix'], ['Running', 'ReadyForReview'], ['Running', 'Failed'], ['Running', 'Cancelled'],
      ['NeedsOwnerDecision', 'Ready'], ['NeedsOwnerDecision', 'Cancelled'], ['NeedsFix', 'Dispatched'],
      ['NeedsFix', 'Cancelled'], ['ReadyForReview', 'Accepted'], ['ReadyForReview', 'NeedsFix'],
      ['Failed', 'Ready'], ['Failed', 'Cancelled'],
    ]
    for (const [from, to] of edges) expect(() =>{  assertTaskTransition(from, to) }).not.toThrow()
    expect(() =>{  assertTaskTransition('Captured', 'Running') }).toThrow(/illegal/)
    expect(() =>{  assertTaskTransition('Accepted', 'Ready') }).toThrow(/illegal/)
  })

  it('replays revisioned snapshots and rejects gaps', () => {
    const first = { type: 'supervisor/task' as const, version: SUPERVISOR_EVENT_VERSION, snapshot: {
      id: task, revision: 1, projectId: project, title: 'Implement contract', description: '', status: 'Captured' as const, nextAction: 'Classify',
    } }
    const second = { ...first, snapshot: { ...first.snapshot, revision: 2, status: 'Classified' as const, nextAction: 'Route' } }
    const projection = foldSupervisor([first, second])
    expect(projection.tasks.get('task-a')?.status).toBe('Classified')
    expect(() => foldSupervisor([{ ...second, snapshot: { ...second.snapshot, revision: 4 } }])).toThrow(/first revision/)
    expect(() => foldSupervisor([first, { ...second, snapshot: { ...second.snapshot, revision: 4 } }])).toThrow(/increment/)
  })

  it('validates event version and revision at the durable boundary', () => {
    const event = { type: 'supervisor/project' as const, version: SUPERVISOR_EVENT_VERSION, snapshot: {
      id: project, revision: 1, displayName: 'A', realPath: 'C:/A', status: 'registered' as const, registeredAt: '2026-01-01T00:00:00Z',
    } }
    expect(() =>{  assertSupervisorEvent(event) }).not.toThrow()
    expect(() =>{  assertSupervisorEvent({ ...event, version: 99 as typeof SUPERVISOR_EVENT_VERSION }) }).toThrow(/version/)
    expect(() =>{  assertSupervisorEvent({ ...event, snapshot: { ...event.snapshot, revision: 0 } }) }).toThrow(/revision/)
    expect(() =>{  assertSupervisorEvent({ ...event, snapshot: { ...event.snapshot, status: 'bogus' } }) }).toThrow(/status/)
    expect(() =>{  assertSupervisorEvent({ type: 'supervisor/notification', version: 1, snapshot: { revision: 1, id: 'n', message: 'x', unread: true, createdAt: 'now', kind: 'bogus' } }) }).toThrow(/kind/)
    expect(() =>{  assertSupervisorEvent({ type: 'supervisor/policy-applied', version: 1, snapshot: { revision: 1, taskId: 't', policyVersion: '1', executor: 'e', reason: 'r', requiresApproval: false, model: 3 } }) }).toThrow(/model/)
  })

  it('rejects duplicate controller identity events during replay', () => {
    const identity = { type: 'supervisor/identity' as const, version: SUPERVISOR_EVENT_VERSION, snapshot: {
      id: SupervisorId('supervisor:test'), revision: 1, sessionId: SessionId('session:test'), createdAt: '2026-01-01T00:00:00Z',
    } }
    expect(() => foldSupervisor([identity, identity])).toThrow(/only once/)
  })

  it('rejects malformed projection identity and references', () => {
    expect(() =>{  assertSupervisorProjection({ identity: { id: SupervisorId('s'), revision: 0, sessionId: SessionId('ss'), createdAt: 'now' }, projects: new Map(), tasks: new Map(), runs: new Map(), policies: new Map(), notifications: new Map() }) }).toThrow(/revision/)
  })
})
