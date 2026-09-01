/** Package-owned invariant companion for executor registration and run ownership. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-supervisor-executor-subagent'

/** Cordis companion plugin name. */
export const name = 'supervisor-executor-subagent-invariant'
/** Invariant service required to install the companion. */
export const inject = ['invariants']

/**
 * Executor ownership is checked at dispatch and host lease settlement. There
 * is no independent durable store for this package to scan.
 */
const install: InvariantInstaller = () => {}

/** Register the package invariant companion. @param ctx - invariant context. @returns disposer. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
