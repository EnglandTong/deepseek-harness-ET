/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-snapshot-local`.
 * @module @deepseek-ai/dsh-snapshot-local/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-snapshot-local'

/** Cordis companion plugin name. */
export const name = 'snapshot-local-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the session events this provider appends carry
 * `@deepseek-ai/dsh-snapshot`'s vocabulary (validated by that package's
 * companion), and its store is private durable state with no event-sequence
 * relationship beyond the owning seam.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
