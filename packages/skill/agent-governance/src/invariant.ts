/**
 * Invariant entrypoint reserved for the package-level invariant registry.
 * @module @deepseek-ai/dsh-agent-governance/invariant
 */

export const name = 'agent-governance-invariant'
export const inject = ['invariants']

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-agent-governance'

/** No runtime invariant: the skill registry owns provider uniqueness and disposal. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
