// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SupervisorClient, SupervisorClientState } from '@deepseek-ai/dsh-client-runtime/client'
import type { SupervisorChildTranscriptPage } from '@deepseek-ai/dsh-client-runtime/client'
import { SupervisorDashboard, type SupervisorDashboardProps } from '../src/client/SupervisorDashboard.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const transcriptPage: SupervisorChildTranscriptPage = {
  sessionId: 'child-a',
  messages: [
    { role: 'user', text: 'Collect the current status of every registered project.', seq: 4 },
    { role: 'assistant', text: 'E2E_EXECUTION_DONE task-a', seq: 6 },
  ],
  oldestSeq: 4,
  hasOlder: false,
}

function client(state: SupervisorClientState): SupervisorClient & {
  action: ReturnType<typeof vi.fn>
  childTranscript: ReturnType<typeof vi.fn>
} {
  const store = {
    getSnapshot: () => state,
    subscribe: (_listener: () => void) => () => {},
  }
  return {
    state: store,
    refresh: vi.fn(async () => {}),
    action: vi.fn(async () => undefined),
    childTranscript: vi.fn(async () => transcriptPage),
  } as unknown as SupervisorClient & { action: ReturnType<typeof vi.fn>; childTranscript: ReturnType<typeof vi.fn> }
}

function renderDashboard(overrides: Partial<SupervisorClientState> = {}) {
  const state: SupervisorClientState = {
    identity: { id: 'supervisor', sessionId: 'supervisor-main', revision: 1, createdAt: new Date(0).toISOString() },
    projects: [{ id: 'project-a', revision: 1, displayName: 'Project A', realPath: 'C:/Project A', status: 'registered', registeredAt: new Date(0).toISOString() }],
    tasks: [{ id: 'task-a', revision: 3, projectId: 'project-a', title: 'Review release', description: 'Review the release candidate', status: 'NeedsOwnerDecision', nextAction: 'Approve the route' }],
    runs: [{ revision: 1, runId: 'run-a', taskId: 'task-a', projectId: 'project-a', hostSessionId: 'host-a', childSessionId: 'child-a', executor: 'codex', model: 'sol', writeAccess: true }],
    notifications: [{ revision: 1, id: 'notice-a', taskId: 'task-a', projectId: 'project-a', kind: 'owner-decision', message: 'Approval is required', unread: true, createdAt: new Date(0).toISOString() }],
    loading: false,
    error: undefined,
    ...overrides,
  }
  const supervisor = client(state)
  const props = { wide: true, supervisor, t: makeTranslate(zh) } as unknown as SupervisorDashboardProps
  return { supervisor, ...render(<SupervisorDashboard {...props} />) }
}

describe('SupervisorDashboard', () => {
  it('opens a single dashboard with projects, task state, and notifications', () => {
    renderDashboard()
    fireEvent.click(screen.getByRole('button', { name: zh['button.open.label'] }))
    expect(screen.getByRole('dialog', { name: zh['dialog.title'] })).toBeDefined()
    expect(screen.getByText('Project A')).toBeDefined()
    expect(screen.getByText('Review release')).toBeDefined()
    expect(screen.getByText('Approval is required')).toBeDefined()
    expect(screen.getByText('阻塞')).toBeDefined()
  })

  it('uses Host compare-and-set actions with the rendered task revision', async () => {
    const { supervisor } = renderDashboard()
    fireEvent.click(screen.getByRole('button', { name: zh['button.open.label'] }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['task.approve'] })) })
    expect(supervisor.action).toHaveBeenCalledWith({ taskId: 'task-a', action: 'approve', expectedRevision: 3 })
  })

  it('offers the approve/reject pair at the approval gate, not only after failures', async () => {
    renderDashboard({ tasks: [{ id: 'task-a', revision: 5, projectId: 'project-a', title: 'Rewrite the pipeline', description: 'Replace the publish job', status: 'AwaitingApproval', nextAction: 'Wait for the owner approval decision' }] })
    fireEvent.click(screen.getByRole('button', { name: zh['button.open.label'] }))
    expect(screen.getByText('阻塞')).toBeDefined()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['task.approve'] })) })
    expect(screen.getByRole('button', { name: zh['task.reject'] })).toBeDefined()
  })

  it('expands a read-only child reference with its transcript, never a composer', async () => {
    const { supervisor } = renderDashboard()
    fireEvent.click(screen.getByRole('button', { name: zh['button.open.label'] }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['task.child'] })) })
    expect(supervisor.childTranscript).toHaveBeenCalledWith({ taskId: 'task-a', runId: 'run-a' })
    expect(screen.getByText(zh['task.child.ref'].replace('{session}', 'child-a'))).toBeDefined()
    expect(screen.getByText(zh['task.child.readonly'])).toBeDefined()
    expect(screen.getByText('E2E_EXECUTION_DONE task-a')).toBeDefined()
    expect(screen.getByText(zh['transcript.assistant'])).toBeDefined()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('offers an older-page control only when the transcript has more history', async () => {
    renderDashboard()
    fireEvent.click(screen.getByRole('button', { name: zh['button.open.label'] }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['task.child'] })) })
    expect(screen.queryByText(zh['transcript.older'])).toBeNull()
  })

  it('shows a clear Host error without fabricating project state', () => {
    renderDashboard({ identity: undefined, error: 'supervisor-unavailable' })
    fireEvent.click(screen.getByRole('button', { name: zh['button.open.label'] }))
    expect(screen.getByRole('alert').textContent).toContain('supervisor-unavailable')
    expect(screen.queryByText('Project A')).toBeNull()
  })
})
