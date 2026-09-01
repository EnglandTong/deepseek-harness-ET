/** Package-owned invariant companion for executor registration and run ownership. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-supervisor-executor-subagent'

/** Cordis companion plugin name. */
export const name = 'supervisor-executor-subagent-invariant'
/** Invariant service required to install the companion. */
export const inject = ['invariants']

/**
 * No runtime invariant: executor ownership has no durable store for this
 * package to scan. The data relation it depends on — the registered provider
 * equals the admitted executor, and the published child equals the reserved
 * identity — is enforced at every dispatch (NO_EXECUTOR, CHILD_ID_MISMATCH)
 * and at host lease settlement, so a scan would only re-read live dispatch state.
 */
const install: InvariantInstaller = () => {}

/** Register the package invariant companion. @param ctx - invariant context. @returns disposer. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
