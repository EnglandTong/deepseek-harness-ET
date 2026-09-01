/** Package-owned invariant companion for Supervisor project host lifecycle. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-supervisor-project-host'

/** Cordis companion plugin name. */
export const name = 'supervisor-project-host-invariant'
/** Invariant service required to install the companion. */
export const inject = ['invariants']

/**
 * Admission authority is enforced at the one in-process lease book. Durable
 * replay belongs to the Supervisor projection, while the child provider owns
 * liveness proof; this package has no independent global relationship to scan.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns registration disposer after the host accepts it.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
