/** Package-owned invariant companion for the Personal Supervisor registry. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-supervisor-project-registry'

/** Cordis companion plugin name. */
export const name = 'supervisor-project-registry-invariant'
/** Invariant service required to install the companion. */
export const inject = ['invariants']

/**
 * No runtime invariant: canonical-path uniqueness and status revisions are
 * enforced at the registry commit point; the durable Supervisor projection
 * owns replay checks once that projection package is composed.
 */
const install: InvariantInstaller = () => {}

/** Register the package invariant with the host invariant service.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns disposer for the registration.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
