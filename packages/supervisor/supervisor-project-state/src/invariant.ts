/** Package-owned invariant companion for the project governance adapter. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-supervisor-project-state'

/** Cordis companion plugin name. */
export const name = 'supervisor-project-state-invariant'
/** Invariant service required to install the companion. */
export const inject = ['invariants']

/**
 * No runtime invariant: this adapter owns no store and no scheduled work. The
 * relation it depends on — a governance projection is only published from a
 * consistent packet/source read — is enforced per refresh by the conflict
 * codes it reports, and every observation is recomputed from disk.
 */
const install: InvariantInstaller = () => {}

/** Register the package invariant companion. @param ctx - invariant context. @returns disposer. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
