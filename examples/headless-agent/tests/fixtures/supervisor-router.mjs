/** Keyless routing provider: compiles the profile YAML policy the scenario writes. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RoutingPolicyRouter } from '@deepseek-ai/dsh-supervisor-routing-policy'

/** @returns policy path in the same location the product profile uses. */
function policyPath() {
  return join(process.env.DSH_HOME ?? '.', 'profiles', 'supervisor', 'supervisor-routing.yml')
}

/** Cordis plugin name. */
export const name = 'supervisor-router-fixture'
/** Supervisor registry dependency. */
export const inject = ['supervisor']

/** Register the YAML router so orchestration resolves through real policy code. */
export function apply(ctx) {
  ctx.supervisor.registerRouter(new RoutingPolicyRouter(readFileSync(policyPath(), 'utf8')))
}
