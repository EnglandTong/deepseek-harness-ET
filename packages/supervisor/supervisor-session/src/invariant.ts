/** Package-owned invariant companion for the singleton Supervisor Session. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-supervisor-session'

/** Cordis companion plugin name. */
export const name = 'supervisor-session-invariant'
/** Service required before this companion can register. */
export const inject = ['invariants']

/**
 * The live singleton relation is checked by the service itself at startup and
 * SessionStore checks duplicate live ids; no additional cross-service fold is
 * owned by this stateless companion.
 */
const install: InvariantInstaller = () => {}

/**
 * Register the package invariant companion.
 * @param ctx - context carrying the invariant service.
 * @returns the installed registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
