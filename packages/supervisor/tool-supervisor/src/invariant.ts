/** Runtime checks for the Personal Supervisor interaction adapter. */

import type { SupervisorIntakeRequest, SupervisorInteractionNotification } from './types.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** Cordis plugin name for package-owned invariant registration. */
export const name = 'tool-supervisor-invariant'
/** Required invariant registry service. */
export const inject = ['invariants']

/**
 * Validate a message before it can enter the singleton controller Session.
 * @param request - intake request to validate.
 */
export function assertSupervisorIntake(request: SupervisorIntakeRequest): void {
  if (typeof request.messageId !== 'string' || request.messageId.trim().length === 0) throw new TypeError('Supervisor intake messageId must be a non-empty string')
  if (String(request.sourceSessionId).trim().length === 0) throw new TypeError('Supervisor intake sourceSessionId must not be empty')
  if (typeof request.text !== 'string' || request.text.trim().length === 0) throw new TypeError('Supervisor intake text must be a non-empty string')
  if (request.wakeup !== undefined && typeof request.wakeup !== 'boolean') throw new TypeError('Supervisor intake wakeup must be a boolean')
}

/**
 * Validate the coalesced notification row exposed to a client.
 * @param notification - notification row to validate.
 */
export function assertSupervisorInteractionNotification(notification: SupervisorInteractionNotification): void {
  if (notification.count < 1 || !Number.isSafeInteger(notification.count)) throw new TypeError('Supervisor notification count must be a positive integer')
  if (notification.message.trim().length === 0) throw new TypeError('Supervisor notification message must not be empty')
  if (notification.id.trim().length === 0) throw new TypeError('Supervisor notification id must not be empty')
}

const install: InvariantInstaller = () => {}

/** Register interaction checks with the configured invariant registry. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-tool-supervisor', install))
