/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-supervisor`.
 * @module @deepseek-ai/dsh-client-ui-supervisor/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-supervisor'

/** Cordis companion plugin name. */
export const name = 'client-ui-supervisor-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the dashboard is a Host projection with no local
 * state authority. Its behavior is covered by client interaction tests; no
 * second client-side source of truth is installed here.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
