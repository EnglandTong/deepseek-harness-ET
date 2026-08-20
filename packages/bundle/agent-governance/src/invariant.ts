import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-agent-governance-bundle'

/** Bundle invariant companion. */
export const name = 'agent-governance-bundle-invariant'
export const inject = ['invariants']

/** No runtime invariant: the mounted plugin owns the skill registration. */
const install: InvariantInstaller = () => {}

/** Register this bundle's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
