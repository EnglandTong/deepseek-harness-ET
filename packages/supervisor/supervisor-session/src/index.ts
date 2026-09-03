/** Durable singleton Session provider for the Personal Supervisor. */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import { settingsNamespace, type SettingsScope } from '@deepseek-ai/dsh-settings'
import { assertSupervisorEvent, supervisorEventFromSessionEvent, SUPERVISOR_EVENT_VERSION } from '@deepseek-ai/dsh-supervisor'
import type {
  SupervisorEvent,
  SupervisorIdentitySnapshot,
  SupervisorIdentityEvent,
} from '@deepseek-ai/dsh-supervisor'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-supervisor'
import type { SupervisorIdentityData } from './session-events.ts'

export type { SupervisorIdentityData } from './session-events.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable singleton Session owned by the Personal Supervisor plugin. */
    supervisorSession: SupervisorSessionService
  }
}

/** Settings namespace containing the durable controller Session id. */
export const SUPERVISOR_SESSION_SETTINGS_NAMESPACE = settingsNamespace('supervisor-session')

/** Settings section persisted by the provider. Empty id means first boot. */
export interface SupervisorSessionSettings {
  /** The only Session id permitted for the controller. */
  supervisorSessionId: string
}

/** Runtime settings schema; an empty string is the explicit uninitialized value. */
export const SupervisorSessionSettingsSchema: z<SupervisorSessionSettings> = z.object({
  supervisorSessionId: z.string().default(''),
})

/** Stable first-boot Session id. It is a protocol constant, not a user preference. */
export const DEFAULT_SUPERVISOR_SESSION_ID = SessionId('supervisor-main')

/** Error raised when settings and durable identity facts cannot be reconciled safely. */
export class SupervisorSessionStateError extends Error {
  /** Stable error category for Host/API mapping. */
  readonly code = 'SUPERVISOR_SESSION_INVALID_STATE'

  /** @param message - precise reconciliation failure. */
  constructor(message: string) {
    super(message)
    this.name = 'SupervisorSessionStateError'
  }
}

/**
 * Owns the one controller Session. It never creates project Sessions or
 * executes an Agent. Durable identity is flushed before the settings id is
 * committed, so a restart can always choose between a valid log and first boot.
 */
export class SupervisorSessionService extends Service {
  static inject = ['settings', 'sessions', 'sessionPersistence', 'supervisor']

  static Config: z<SupervisorSessionSettings> = SupervisorSessionSettingsSchema

  private readonly settings: SettingsScope<SupervisorSessionSettings>
  private session: Session | undefined
  private detach: (() => void) | undefined
  private eventDisposers: Array<() => void> = []
  private flushTail: Promise<void> = Promise.resolve()
  private stopping = false

  /** @param ctx - context containing settings, SessionStore, persistence and Supervisor contract. */
  constructor(ctx: Context) {
    super(ctx, 'supervisorSession')
    this.settings = ctx.settings.register(
      SUPERVISOR_SESSION_SETTINGS_NAMESPACE,
      SupervisorSessionSettingsSchema,
    )
  }

  /** Create or restore the singleton after all required services are ready. */
  protected async [Service.init](): Promise<void> {
    const configured = this.settings.get().supervisorSessionId
    const requestedId = configured.length > 0 ? SessionId(configured) : DEFAULT_SUPERVISOR_SESSION_ID
    const materialized = (await this.ctx.sessionPersistence.list()).find(header => header.id === requestedId)
    if (configured.length > 0 && materialized === undefined) {
      throw new SupervisorSessionStateError(`settings points to missing Supervisor session "${requestedId}"`)
    }
    if (this.ctx.sessions.get(requestedId) !== undefined) {
      throw new SupervisorSessionStateError(`Supervisor session "${requestedId}" is already live`)
    }

    try {
      if (materialized === undefined) {
        await this.createNew(requestedId)
      } else {
        await this.restore(requestedId)
      }
      const current = this.session
      if (current === undefined || this.detach === undefined) throw new Error('Supervisor session setup completed without a live Session')
      if (configured.length === 0) {
        // Settings is written only after the identity event crossed the durable
        // flush barrier. A settings write failure therefore never hides a valid log.
        await this.settings.replace({ supervisorSessionId: String(current.id) })
      }
      this.attachSupervisorEventPersistence()
      this.ctx.effect(() => async () => {
        this.stopping = true
        const active = this.session
        if (active !== undefined) await this.ctx.sessions.flush(active)
        this.eventDisposers.splice(0).forEach((dispose) =>{  dispose() })
        await this.flushTail
        this.detach?.()
        this.session = undefined
        this.detach = undefined
      }, 'supervisor-session: final flush')
    } catch (error) {
      this.detach?.()
      this.detach = undefined
      this.session = undefined
      throw error
    }
  }

  /** Return the live singleton Session, or undefined before initialization. */
  get current(): Session | undefined {
    return this.session
  }

  /** Whether teardown has stopped new owner work. */
  get isStopping(): boolean {
    return this.stopping
  }

  private async createNew(id: SessionId): Promise<void> {
    const prepared = this.ctx.sessions.prepare(id)
    // Register the ownerless persistence intent before publication. JSONL and
    // SQLite then perform their normal collision checks on the first append.
    await this.ctx.sessionPersistence.create(prepared.header)
    const detach = this.ctx.sessions.enter(prepared)
    try {
      this.ctx.sessions.announce(prepared)
      const snapshot: SupervisorIdentitySnapshot = {
        revision: 1,
        id: this.ctx.supervisor.identity(),
        sessionId: prepared.id,
        createdAt: new Date(prepared.header.createdAt).toISOString(),
      }
      const data: SupervisorIdentityData = { version: SUPERVISOR_EVENT_VERSION, snapshot }
      const event = prepared.append('supervisor/identity', data)
      this.ctx.emit('supervisor/identity', this.toCordisEvent(event))
      await this.ctx.sessions.flush(prepared)
      this.session = prepared
      this.detach = detach
    } catch (error) {
      detach()
      throw error
    }
  }

  private async restore(id: SessionId): Promise<void> {
    const preparation = await this.ctx.sessionPersistence.prepare(id)
    const restored = preparation.session
    try {
      const identities = restored.events.filter(event => event.type === 'supervisor/identity')
      if (identities.length !== 1) {
        throw new SupervisorSessionStateError(`Supervisor session "${id}" must contain exactly one identity event`)
      }
      const event = identities[0] as SessionEvent<'supervisor/identity'>
      const data = event.data as SupervisorIdentityData
      // SessionPersistence validates the generic Session envelope, but it
      // cannot know the Supervisor event vocabulary. Validate the complete
      // versioned payload before accepting it as controller identity.
      const envelope = this.toCordisEvent(event)
      try {
        assertSupervisorEvent(envelope)
      } catch (error) {
        throw new SupervisorSessionStateError(`invalid Supervisor identity event in session "${id}": ${String(error)}`)
      }
      this.assertIdentity(data.snapshot, id)
      this.ctx.supervisor.restoreLedger(restored.events.flatMap((event) => {
        const supervisorEvent = supervisorEventFromSessionEvent(event)
        return supervisorEvent === undefined ? [] : [supervisorEvent]
      }))
      const detach = this.ctx.sessions.enter(restored)
      try {
        this.ctx.sessions.announce(restored)
        this.ctx.emit('supervisor/identity', envelope)
        await this.ctx.sessions.flush(restored)
        this.session = restored
        this.detach = detach
      } catch (error) {
        detach()
        throw error
      }
    } finally {
      preparation[Symbol.dispose]()
    }
  }

  private assertIdentity(snapshot: SupervisorIdentitySnapshot, id: SessionId): void {
    if (snapshot.revision !== 1 || snapshot.sessionId !== id || snapshot.id !== this.ctx.supervisor.identity()) {
      throw new SupervisorSessionStateError(`Supervisor identity event does not match session "${id}"`)
    }
  }

  private toCordisEvent(event: SessionEvent<'supervisor/identity'>): SupervisorIdentityEvent {
    const data = event.data as SupervisorIdentityData
    return { type: 'supervisor/identity', version: data.version, snapshot: data.snapshot }
  }

  /** Subscribe to controller events after identity setup and persist each snapshot. */
  private attachSupervisorEventPersistence(): void {
    const record = (event: Exclude<SupervisorEvent, SupervisorIdentityEvent>): void => {
      if (!this.stopping) this.recordSupervisorEvent(event)
    }
    for (const eventType of ['supervisor/project', 'supervisor/task', 'supervisor/run-linked', 'supervisor/id-binding', 'supervisor/policy-applied', 'supervisor/notification'] as const) {
      this.eventDisposers.push(this.ctx.on(eventType, record))
    }
  }

  /** Append and flush one live event in order; append is synchronous and flush is serialized. */
  private recordSupervisorEvent(event: Exclude<SupervisorEvent, SupervisorIdentityEvent>): void {
    const active = this.session
    if (active === undefined) return
    // The append stays on the publishing stack: a deferred append can run after
    // Session persistence has torn down its write path, and that event is then
    // lost with no failure to report.
    switch (event.type) {
      case 'supervisor/project':
      case 'supervisor/task':
      case 'supervisor/run-linked':
      case 'supervisor/id-binding':
      case 'supervisor/policy-applied':
      case 'supervisor/notification': {
        const { type, ...data } = event
        active.append(type, data)
        break
      }
    }
    this.flushTail = this.flushTail.then(async () => {
      // A barrier with no participants persisted nothing, so refuse it loudly.
      if (!await this.ctx.sessions.flush(active)) {
        throw new Error(`controller session "${active.id}" has no Session persistence listener`)
      }
    }).catch((error: unknown) => {
      this.ctx.logger.error('supervisor-session: failed to persist controller event: %s', String(error))
    })
  }
}

export default SupervisorSessionService
