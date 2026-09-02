/** Package-owned workspace-snapshot event-data invariants. @module @deepseek-ai/dsh-snapshot/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-snapshot'

/** Cordis companion plugin name. */
export const name = 'snapshot-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Assert that an event payload id is a usable opaque identity. */
function validateId(value: unknown, fail: InvariantFailure): void {
  if (typeof value !== 'string' || value.length === 0) fail('snapshot event id must be a non-empty string')
}

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Validate the package-owned event fields and ignore unrelated events. */
function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type === 'snapshot/create') {
    validateId(event.data.id, fail)
    if (typeof event.data.reason !== 'string') fail('snapshot/create reason must be a string')
  }
  if (event.type === 'snapshot/restore') {
    validateId(event.data.id, fail)
    if (!Number.isSafeInteger(event.data.restored) || event.data.restored < 0) {
      fail('snapshot/restore restored must be a non-negative safe integer')
    }
    if (!Number.isSafeInteger(event.data.removed) || event.data.removed < 0) {
      fail('snapshot/restore removed must be a non-negative safe integer')
    }
  }
}

/** Install validation for loaded and newly appended snapshot events. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) {
    for (const event of session.snapshotEvents()) validateEvent(event, fail)
  }
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const event = (args as [Session, SessionEvent])[1]
    validateEvent(event, fail)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register the snapshot invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
