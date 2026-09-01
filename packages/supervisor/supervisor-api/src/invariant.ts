/** Package-owned invariant companion for the supervisor API projection. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-supervisor-api'

/** Cordis companion plugin name. */
export const name = 'supervisor-api-invariant'
/** Invariant service required to install the companion. */
export const inject = ['invariants']

/**
 * No runtime invariant: the API is a read-only projection with no durable
 * store or scheduled work. Every snapshot is assembled from the supervisor
 * service's revision-checked maps at request time, so the projection owns no
 * data relation that could drift between observations.
 */
const install: InvariantInstaller = () => {}

/** Register the package invariant companion. @param ctx - invariant context. @returns disposer. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
