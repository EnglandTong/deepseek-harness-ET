/** Package-owned invariant companion for the routing policy compiler. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-supervisor-routing-policy'

/** Cordis companion plugin name. */
export const name = 'supervisor-routing-policy-invariant'
/** Invariant service required to install the companion. */
export const inject = ['invariants']

/**
 * No runtime invariant: a policy is validated strictly at load time and the
 * compiled document is immutable afterwards; route evaluation reads it
 * without mutation. The policy hash ties every decision to an exact compiled
 * document, so there is no mutable relation for a scanner to check.
 */
const install: InvariantInstaller = () => {}

/** Register the package invariant companion. @param ctx - invariant context. @returns disposer. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
