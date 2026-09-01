/**
 * Client projection of the Personal Supervisor API. The Host owns all
 * current facts; this runtime keeps a revisioned, observable cache and sends
 * user actions back through the typed API client.
 */

import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import type {
  SupervisorActionKind,
  SupervisorActionReceipt,
  SupervisorActionRequest,
  SupervisorChildSessionView,
  SupervisorIdentityView,
  SupervisorNotificationView,
  SupervisorProjectView,
  SupervisorRunView,
  SupervisorTaskView,
} from '@deepseek-ai/dsh-host-apiproxy/client'
import { createSnapshotStore, type SnapshotStore } from './contract/store.ts'

/** Observable state held by the Supervisor client projection. */
export interface SupervisorClientState {
  identity: SupervisorIdentityView | undefined
  projects: SupervisorProjectView[]
  tasks: SupervisorTaskView[]
  runs: SupervisorRunView[]
  notifications: SupervisorNotificationView[]
  loading: boolean
  error: string | undefined
}

/** Public client-side Supervisor operations consumed by the dashboard. */
export interface SupervisorClient {
  readonly state: SnapshotStore<SupervisorClientState>
  /** Reload all Supervisor lists from one Host snapshot boundary. */
  refresh(signal?: AbortSignal): Promise<void>
  /** Apply one compare-and-set user action and refresh the projection. */
  action(request: SupervisorActionRequest, signal?: AbortSignal): Promise<SupervisorActionReceipt | undefined>
  /** Resolve a task's child session without granting write access. */
  childSession(taskId: string, runId?: string, signal?: AbortSignal): Promise<SupervisorChildSessionView | undefined>
}

/**
 * Host-backed Supervisor client projection.
 * @param api - typed API carrier.
 */
export class SupervisorRuntime implements SupervisorClient {
  readonly state = createSnapshotStore<SupervisorClientState>({
    identity: undefined,
    projects: [],
    tasks: [],
    runs: [],
    notifications: [],
    loading: false,
    error: undefined,
  })

  constructor(private readonly api: IApiClient) {}

  async refresh(signal?: AbortSignal): Promise<void> {
    this.state.update((state) => { state.loading = true; state.error = undefined })
    try {
      const supervisor = this.api.supervisor
      if (supervisor === undefined) throw new Error('Supervisor API is unavailable')
      const [identity, projects, tasks, runs, notifications] = await Promise.all([
        supervisor.identity({}, signal),
        supervisor.projects({}, signal),
        supervisor.tasks({}, signal),
        supervisor.runs({}, signal),
        supervisor.notifications({}, signal),
      ])
      const failures = [identity, projects, tasks, runs, notifications].filter(result => !result.result.ok)
      if (failures.length > 0) {
        const first = failures[0]
        if (first === undefined || first.result.ok) throw new Error('Supervisor refresh failed')
        throw new Error(first.result.error.message)
      }
      if (!identity.result.ok || !projects.result.ok || !tasks.result.ok
        || !runs.result.ok || !notifications.result.ok) throw new Error('Supervisor refresh failed')
      this.state.set({
        identity: identity.result.value,
        projects: [...projects.result.value.projects],
        tasks: [...tasks.result.value.tasks],
        runs: [...runs.result.value.runs],
        notifications: [...notifications.result.value.notifications],
        loading: false,
        error: undefined,
      })
    } catch (error: unknown) {
      this.state.update((state) => {
        state.loading = false
        state.error = error instanceof Error ? error.message : String(error)
      })
    }
  }

  async action(request: SupervisorActionRequest, signal?: AbortSignal): Promise<SupervisorActionReceipt | undefined> {
    const supervisor = this.api.supervisor
    if (supervisor === undefined) {
      this.state.update((state) => { state.error = 'Supervisor API is unavailable' })
      return undefined
    }
    const result = await supervisor.action(request, signal)
    const outcome = result.result
    if (outcome.ok === false) {
      this.state.update((state) => { state.error = outcome.error.message })
      return undefined
    }
    await this.refresh(signal)
    return outcome.value
  }

  async childSession(taskId: string, runId?: string, signal?: AbortSignal): Promise<SupervisorChildSessionView | undefined> {
    const supervisor = this.api.supervisor
    if (supervisor === undefined) {
      this.state.update((state) => { state.error = 'Supervisor API is unavailable' })
      return undefined
    }
    const result = await supervisor.childSession({ taskId, ...(runId === undefined ? {} : { runId }) }, signal)
    const outcome = result.result
    if (outcome.ok === false) {
      this.state.update((state) => { state.error = outcome.error.message })
      return undefined
    }
    return outcome.value
  }
}

export type { SupervisorActionKind }
