/** `ctx.supervisor`: public Personal Supervisor service definition and registries. */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  SupervisorExecutor,
  SupervisorProjectProvider,
  SupervisorReporter,
  SupervisorRouter,
} from './providers.ts'
import { SupervisorId } from './types.ts'
import type { SupervisorEvent } from './events.ts'
import type {
  SupervisorConfig,
  SupervisorId as SupervisorIdType,
  SupervisorProjectId,
  SupervisorProjectSnapshot,
  SupervisorTaskId,
  SupervisorTaskSnapshot,
} from './types.ts'
import { assertTaskTransition, foldSupervisor } from './fold.ts'

export * from './types.ts'
export * from './events.ts'
export * from './fold.ts'
export * from './invariant.ts'
export type { SupervisorExecutor, SupervisorProjectProvider, SupervisorReporter, SupervisorRouter } from './providers.ts'

declare module '@deepseek-ai/cordis' { interface Context { supervisor: SupervisorService } }

/** Public Supervisor capability. Providers are registered as Cordis effects. */
export class SupervisorService extends Service {
  static inject = []
  private readonly supervisorId: SupervisorIdType
  private readonly projects = new Map<string, SupervisorProjectProvider>()
  private readonly routers = new Map<string, SupervisorRouter>()
  private readonly executors = new Map<string, SupervisorExecutor>()
  private readonly reporters = new Map<string, SupervisorReporter>()
  private readonly projectSnapshots = new Map<string, SupervisorProjectSnapshot>()
  private readonly taskSnapshots = new Map<string, SupervisorTaskSnapshot>()

  /** @param ctx - owning Cordis context. */
  constructor(ctx: Context, config: SupervisorConfig = {}) {
    super(ctx, 'supervisor')
    if (config.id !== undefined && config.id.length === 0) throw new Error('Supervisor identity must be non-empty')
    this.supervisorId = SupervisorId(config.id ?? 'supervisor')
    ctx.on('supervisor/project', (event) => { this.applySnapshot(this.projectSnapshots, event.snapshot.id, event.snapshot) })
    ctx.on('supervisor/task', (event) => {
      const previous = this.taskSnapshots.get(event.snapshot.id)
      if (previous !== undefined) assertTaskTransition(previous.status, event.snapshot.status)
      this.applySnapshot(this.taskSnapshots, event.snapshot.id, event.snapshot)
    })
  }

  /** Return the singleton controller identity.
   * @returns branded identity.
   */
  identity(): SupervisorIdType { return this.supervisorId }

  /**
   * Rebuild the central projection from the durable controller ledger. Only the
   * singleton-session provider calls this, and only before any live event.
   * @param events - every Supervisor event of the restored controller Session in log order.
   * @returns void.
   */
  restoreLedger(events: readonly SupervisorEvent[]): void {
    if (this.projectSnapshots.size > 0 || this.taskSnapshots.size > 0) throw new Error('Supervisor central projection cannot be restored after live events')
    const projection = foldSupervisor(events)
    if (projection.identity === undefined) throw new Error('Supervisor ledger has no identity event to restore')
    if (projection.identity.id !== this.supervisorId) throw new Error(`Supervisor ledger identity '${projection.identity.id}' does not match controller '${this.supervisorId}'`)
    for (const project of projection.projects.values()) this.projectSnapshots.set(String(project.id), project)
    for (const task of projection.tasks.values()) this.taskSnapshots.set(String(task.id), task)
  }

  /** Return registered project providers in insertion order.
   * @returns registered project providers.
   */
  listProjectProviders(): readonly SupervisorProjectProvider[] { return [...this.projects.values()] }
  /** Return registered routers in insertion order.
   * @returns registered routers.
   */
  listRouters(): readonly SupervisorRouter[] { return [...this.routers.values()] }
  /** Return registered executors in insertion order.
   * @returns registered executors.
   */
  listExecutors(): readonly SupervisorExecutor[] { return [...this.executors.values()] }
  /** Return registered reporters in insertion order.
   * @returns registered reporters.
   */
  listReporters(): readonly SupervisorReporter[] { return [...this.reporters.values()] }

  /** Return the current project snapshots in insertion order.
   * @returns detached project snapshots.
   */
  listProjects(): readonly SupervisorProjectSnapshot[] { return [...this.projectSnapshots.values()] }

  /** Look up one project snapshot.
   * @param id - project identity.
   * @returns the snapshot, or undefined when it is not projected yet.
   */
  getProject(id: SupervisorProjectId): SupervisorProjectSnapshot | undefined { return this.projectSnapshots.get(id) }

  /** Return all current task snapshots in insertion order.
   * @returns detached task snapshots.
   */
  listTasks(): readonly SupervisorTaskSnapshot[] { return [...this.taskSnapshots.values()] }

  /** Look up one task snapshot.
   * @param id - task identity.
   * @returns the snapshot, or undefined when it is not projected yet.
   */
  getTask(id: SupervisorTaskId): SupervisorTaskSnapshot | undefined { return this.taskSnapshots.get(id) }

  /** Register a project provider.
   * @param provider - provider to register.
   * @returns disposer.
   */
  registerProjectProvider(provider: SupervisorProjectProvider): () => void { return this.register(this.projects, provider) }
  /** Register a router.
   * @param router - router to register.
   * @returns disposer.
   */
  registerRouter(router: SupervisorRouter): () => void { return this.register(this.routers, router) }
  /** Register an executor.
   * @param executor - executor to register.
   * @returns disposer.
   */
  registerExecutor(executor: SupervisorExecutor): () => void { return this.register(this.executors, executor) }
  /** Register a reporter.
   * @param reporter - reporter to register.
   * @returns disposer.
   */
  registerReporter(reporter: SupervisorReporter): () => void { return this.register(this.reporters, reporter) }

  private register<T extends { readonly name: string }>(map: Map<string, T>, value: T): () => void {
    const name = value.name.trim()
    if (name.length === 0) throw new Error('Supervisor provider names must be non-empty')
    if (map.has(name)) throw new Error(`Supervisor provider already registered: ${name}`)
    const effect = this.ctx.effect(() => {
      map.set(name, value)
      return () => { if (map.get(name) === value) map.delete(name) }
    }, `supervisor.provider:${name}`)
    return () => { void effect() }
  }

  private applySnapshot<T extends { readonly revision: number }>(map: Map<string, T>, key: string, snapshot: T): void {
    const previous = map.get(key)
    if (previous === undefined && snapshot.revision !== 1) throw new Error(`Supervisor first revision for ${key} must be 1`)
    if (previous !== undefined && snapshot.revision !== previous.revision + 1) {
      throw new Error(`Supervisor revision for ${key} must increment from ${previous.revision} to ${previous.revision + 1}`)
    }
    map.set(key, snapshot)
  }
}

export default SupervisorService
