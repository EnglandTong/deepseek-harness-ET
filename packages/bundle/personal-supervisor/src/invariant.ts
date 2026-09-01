/** Package-owned invariant companion for the personal supervisor bundle. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-personal-supervisor'

/** Cordis companion plugin name. */
export const name = 'personal-supervisor-invariant'
/** Invariant service required to install the companion. */
export const inject = ['invariants']

/**
 * No runtime invariant: the bundle is a pure composition layer. Every mounted
 * service owns and checks its own state — controller identity, project hosts,
 * routing policy, executor admission — so a bundle-level scan would duplicate
 * their ownership without adding a relation of its own.
 */
const install: InvariantInstaller = () => {}

/** Register the package invariant companion. @param ctx - invariant context. @returns disposer. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
