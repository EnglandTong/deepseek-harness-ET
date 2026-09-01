/** Package-owned invariant companion for the in-process executor adapter. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-supervisor-executor-inprocess'

/** Cordis companion plugin name. */
export const name = 'supervisor-executor-inprocess-invariant'
/** Invariant service required to install the companion. */
export const inject = ['invariants']

/**
 * No runtime invariant: this adapter owns no durable store and no scheduled
 * work. Its data relation — the reserved child identity equals the identity
 * the driver publishes — is enforced at every dispatch by the executor
 * bridge's CHILD_ID_MISMATCH check, and identity reservation has no state
 * that survives the run.
 */
const install: InvariantInstaller = () => {}

/** Register the package invariant companion. @param ctx - invariant context. @returns disposer. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
