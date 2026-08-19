/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-snapshot`.
 * @module @deepseek-ai/dsh-tool-snapshot/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-snapshot'

/** Cordis companion plugin name. */
export const name = 'tool-snapshot-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the tool consumer emits no package-owned events —
 * its session-visible facts flow through `ctx.snapshots` and are validated by
 * `@deepseek-ai/dsh-snapshot`'s companion.
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
