/** Personal Supervisor executor registry and project-host admission bridge. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { SupervisorRunLease } from '@deepseek-ai/dsh-supervisor-project-host'
import type { PermissionCeiling } from '@deepseek-ai/dsh-supervisor-routing-policy'
import { SupervisorExecutorError } from './error.ts'
import { normalizeExecutionResult } from './normalize.ts'
import type {
  ExecutorCapabilities,
  SupervisorExecutionHandle,
  SupervisorExecutionRequest,
  SupervisorExecutorProvider,
} from './types.ts'

export * from './error.ts'
export * from './normalize.ts'
export * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { supervisorExecutors: SupervisorExecutorService }
}

/** Permission ordering used for admission checks. */
const PERMISSION_RANK: Record<PermissionCeiling, number> = {
  none: 0,
  read: 1,
  write: 2,
  execute: 3,
  admin: 4,
}

/**
 * Registers provider adapters and turns routed work into host-owned runs.
 * Providers must reserve a child identity before {@link dispatch}; this keeps
 * the host writer gate active before model or CLI work begins.
 */
export class SupervisorExecutorService extends Service {
  static inject = ['supervisorProjectHost']
  private readonly executors = new Map<string, SupervisorExecutorProvider>()
  private readonly active = new Map<string, SupervisorExecutionHandle>()

  /** @param ctx - context carrying project-host admission. */
  constructor(ctx: Context) {
    super(ctx, 'supervisorExecutors')
    ctx.effect(() => async () => {
      const handles = [...this.active.values()]
      await Promise.all(handles.map(handle => handle.cancel().catch(() => undefined)))
      this.active.clear()
    }, 'supervisor-executors.runtime')
  }

  /**
   * Register one executor adapter using Cordis effect ownership.
   * @param provider - trusted adapter for a model or CLI provider family.
   * @returns disposer that removes new-dispatch visibility.
   */
  register(provider: SupervisorExecutorProvider): () => void {
    const name = provider.name.trim()
    if (name.length === 0) throw new Error('Supervisor executor name must not be empty')
    if (this.executors.has(name)) throw new Error(`Supervisor executor '${name}' is already registered`)
    const dispose = this.ctx.effect(() => {
      this.executors.set(name, provider)
      return () => { this.executors.delete(name) }
    }, 'supervisorExecutors.register()')
    return () => { void dispose() }
  }

  /**
   * Return registered executor names in insertion order.
   * @returns executor names.
   */
  list(): string[] { return [...this.executors.keys()] }

  /**
   * Look up one registered executor.
   * @param name - executor name.
   * @returns provider, if registered.
   */
  get(name: string): SupervisorExecutorProvider | undefined { return this.executors.get(name) }

  /**
   * Admit and start one routed child, retaining the exact lease until terminal
   * result and disposal settle. Provider startup failures release the lease.
   * @param request - routed work and caller cancellation.
   * @returns run handle with normalized terminal result.
   */
  async dispatch(request: SupervisorExecutionRequest): Promise<SupervisorExecutionHandle> {
    if (!request.route.dispatchable) throw new SupervisorExecutorError('ROUTE_NOT_DISPATCHABLE', 'route is awaiting approval or a policy gate')
    const provider = this.executors.get(request.route.decision.executor)
    if (provider === undefined) throw new SupervisorExecutorError('NO_EXECUTOR', `no executor '${request.route.decision.executor}' is registered`)
    this.assertCapabilities(provider.capabilities, request)
    if (rank(request.permission) > rank(request.route.permissionCeiling)) {
      throw new SupervisorExecutorError('PERMISSION_EXCEEDED', `route cannot grant '${request.permission}' permission`)
    }
    const prepared = await provider.prepare(request)
    const host = this.ctx.supervisorProjectHost
    let lease: SupervisorRunLease
    try {
      lease = await host.admit({
        projectId: request.projectId,
        taskId: request.taskId,
        runId: request.runId,
        childSessionId: prepared.childSessionId,
        executor: provider.name,
        ...(request.route.decision.model === undefined ? {} : { model: request.route.decision.model }),
        writeAccess: rank(request.permission) >= rank('write'),
      })
    } catch (error: unknown) {
      if (prepared.release !== undefined) await prepared.release().catch(() => undefined)
      throw error
    }
    let child: Awaited<ReturnType<typeof prepared.start>>
    try {
      child = await prepared.start()
      if (child.childSessionId !== prepared.childSessionId) {
        await child.dispose().catch(() => undefined)
        throw new SupervisorExecutorError('CHILD_ID_MISMATCH', 'provider returned a child different from its reserved identity')
      }
    } catch (error: unknown) {
      await lease.release().catch(() => undefined)
      if (prepared.release !== undefined) await prepared.release().catch(() => undefined)
      throw error
    }
    let timedOut = false
    let cancellation: Promise<void> | undefined
    const cancelChild = (): Promise<void> => {
      if (cancellation !== undefined) return cancellation
      cancellation = child.dispose()
      return cancellation
    }
    const cleanup = (): Promise<void> => cancelChild().catch(() => undefined).then(() => {
      if (timer !== undefined) clearTimeout(timer)
      request.signal.removeEventListener('abort', onAbort)
      this.active.delete(String(request.runId))
      // Release immediately for providers whose lease settles with the
      // result; the project-host lease independently guards the attached
      // child race and will retry release from its settlement callback.
      return lease.release().catch(() => undefined)
    })
    const result = Promise.resolve(child.result)
      .then(raw => normalizeExecutionResult({ ...raw, timedOut: raw.timedOut === true || timedOut }))
      .catch(() => normalizeExecutionResult({
        stopReason: 'error',
        diagnostic: 'provider result rejected before a terminal result was available',
      }))
      .then(value => cleanup().then(() => value))
    const onAbort = (): void => { void cancelChild() }
    request.signal.addEventListener('abort', onAbort, { once: true })
    const timer = request.route.timeoutMs > 0
      ? setTimeout(() => { timedOut = true; void cancelChild() }, request.route.timeoutMs)
      : undefined
    if (request.signal.aborted) onAbort()
    const handle: SupervisorExecutionHandle = {
      runId: request.runId,
      childSessionId: prepared.childSessionId,
      lease,
      result,
      cancel: async () => { await cancelChild(); await result.catch(() => undefined) },
    }
    this.active.set(String(request.runId), handle)
    lease.attach({
      cancel: cancelChild,
      done: result.then(() => undefined, () => undefined),
    })
    return handle
  }

  /**
   * Cancel one exact active run.
   * @param runId - active run identity.
   * @returns whether a run existed.
   */
  async cancel(runId: SupervisorExecutionHandle['runId']): Promise<boolean> {
    const handle = this.active.get(String(runId))
    if (handle === undefined) return false
    await handle.cancel()
    return true
  }

  private assertCapabilities(capabilities: ExecutorCapabilities, request: SupervisorExecutionRequest): void {
    if (!capabilities.providers.includes(request.route.decision.provider)) {
      throw new SupervisorExecutorError('PROVIDER_UNSUPPORTED', `executor '${request.route.decision.executor}' does not support provider '${request.route.decision.provider}'`)
    }
    const ceiling = Math.max(...capabilities.permissions.map(rank), 0)
    if (rank(request.permission) > ceiling) {
      throw new SupervisorExecutorError('PERMISSION_EXCEEDED', `executor '${request.route.decision.executor}' cannot grant '${request.permission}' permission`)
    }
    if (request.background && !capabilities.background) throw new SupervisorExecutorError('BACKGROUND_UNSUPPORTED', `executor '${request.route.decision.executor}' does not support background runs`)
    if (!capabilities.cancellation) throw new SupervisorExecutorError('CANCELLATION_UNSUPPORTED', `executor '${request.route.decision.executor}' does not support cancellation`)
  }
}

function rank(permission: PermissionCeiling): number { return PERMISSION_RANK[permission] }

export default SupervisorExecutorService
