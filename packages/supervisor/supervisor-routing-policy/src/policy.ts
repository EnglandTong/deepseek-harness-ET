/** Compilation, deterministic route resolution, and confirmation-safe updates. */

import { createHash } from 'node:crypto'
import type { RouteDecision } from '@deepseek-ai/dsh-supervisor'
import { RoutingPolicyError } from './error.ts'
import { parseRoutingPolicyYaml, validateRoutingPolicyDocument } from './schema.ts'
import type {
  PermissionCeiling,
  PolicyDiff,
  PolicyUpdatePreview,
  RouteRequest,
  RouteTarget,
  ResolvedRouteDecision,
  RoutingPolicy,
  RoutingPolicyDocument,
  RoutingPolicyRouter as RoutingPolicyRouterContract,
  RoutingRule,
  TimeWindow,
} from './types.ts'

const PERMISSION_RANK: Readonly<Record<PermissionCeiling, number>> = { none: 0, read: 1, write: 2, execute: 3, admin: 4 }

/**
 * Convert a policy document into a detached, immutable policy with stable hash.
 * @param input - parsed policy document or YAML source.
 * @returns compiled immutable routing policy.
 */
export function compileRoutingPolicy(input: RoutingPolicyDocument | string): RoutingPolicy {
  const document = typeof input === 'string' ? parseRoutingPolicyYaml(input) : validateRoutingPolicyDocument(input)
  const defaults = {
    approval: document.defaults?.approval ?? 'confirm',
    permissionCeiling: document.defaults?.permissionCeiling ?? 'read',
    timeoutMs: document.defaults?.timeoutMs ?? 30_000,
    costTier: document.defaults?.costTier ?? 'unknown',
  }
  const routes: RoutingRule[] = document.routes.map((route, index) => ({
    ...route,
    id: route.id ?? `route-${index + 1}`,
    approval: route.approval ?? defaults.approval,
    permissionCeiling: route.permissionCeiling ?? defaults.permissionCeiling,
    timeoutMs: route.timeoutMs ?? defaults.timeoutMs,
    costTier: route.costTier ?? defaults.costTier,
    fallback: route.fallback ?? [],
    timeWindows: route.timeWindows ?? [],
  }))
  const plain = {
    version: String(document.version ?? '1'),
    ...(document.timezone === undefined ? {} : { timezone: document.timezone }),
    timeWindows: document.timeWindows ?? [],
    defaults,
    ...(document.budget === undefined ? {} : { budget: document.budget }),
    ...(document.concurrency === undefined ? {} : { concurrency: document.concurrency }),
    routes,
  }
  const hash = stablePolicyHash(plain)
  return deepFreeze({ ...plain, hash })
}

/**
 * Return the SHA-256 hash of canonical policy data.
 * @param policy - compiled or un-hashed policy value.
 * @returns stable SHA-256 policy hash.
 */
export function stablePolicyHash(policy: Omit<RoutingPolicy, 'hash'> | RoutingPolicy): string {
  const { hash: _ignored, ...value } = policy as RoutingPolicy
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`
}

/**
 * Resolve one request against a compiled policy without mutating it.
 * @param policy - immutable routing policy.
 * @param request - task and resource context.
 * @returns explainable route decision.
 */
export function resolveRoute(policy: RoutingPolicy, request: RouteRequest): ResolvedRouteDecision {
  const candidates = policy.routes
    .filter(route => matches(route, request))
    .sort((left, right) => specificity(right) - specificity(left) || left.id.localeCompare(right.id))
  const selected = candidates[0]
  if (selected === undefined) return unresolved(policy, request, 'No routing rule matched; owner approval is required.')

  const availability = selectAvailableTarget(selected, policy.routes, request)
  if (availability === undefined) return unresolved(policy, request, `Route "${selected.id}" is unavailable and has no available fallback.`, selected.id)

  const target = availability.target
  const approval = selected.approval
  const reasons: string[] = [`Matched route "${selected.id}"`]
  if (availability.fallbackUsed) reasons.push(`primary unavailable; selected fallback ${target.provider}/${target.model ?? '(default)'}`)
  let dispatchable = approval !== 'deny'
  let requiresApproval = approval !== 'auto'
  if (approval === 'deny') reasons.push('policy disposition is deny')
  if (riskGate(request)) { requiresApproval = true; reasons.push('risk gate requires owner confirmation') }
  const permission = selected.permissionCeiling
  if (request.requestedPermission !== undefined && PERMISSION_RANK[request.requestedPermission] > PERMISSION_RANK[permission]) {
    requiresApproval = true
    dispatchable = false
    reasons.push(`requested permission exceeds ceiling ${permission}`)
  }
  const routeWindows = selected.timeWindows ?? []
  const window = isWithinWindows(
    request.now,
    selected.timezone ?? policy.timezone,
    routeWindows.length > 0 ? routeWindows : policy.timeWindows,
  )
  if (!window) { requiresApproval = true; dispatchable = false; reasons.push('outside configured execution window') }
  const budget = selected.budget ?? policy.budget
  const estimated = request.estimatedCostUnits ?? 0
  if (budget?.maxCostUnits !== undefined && (request.usage?.spentCostUnits ?? 0) + estimated > budget.maxCostUnits) {
    requiresApproval = true; dispatchable = false; reasons.push('cost budget is exhausted')
  }
  if (budget?.maxRuns !== undefined && (request.usage?.completedRuns ?? 0) >= budget.maxRuns) {
    requiresApproval = true; dispatchable = false; reasons.push('run budget is exhausted')
  }
  const maxConcurrent = selected.concurrency?.maxConcurrent ?? policy.concurrency?.maxConcurrent
  if (maxConcurrent !== undefined && (request.usage?.activeConcurrent ?? 0) >= maxConcurrent) {
    requiresApproval = true; dispatchable = false; reasons.push('concurrency limit is exhausted')
  }
  // A route awaiting an owner decision is never admitted by this resolver;
  // the orchestrator must call the explicit approval path before dispatch.
  if (requiresApproval) dispatchable = false
  const decision: RouteDecision = {
    taskId: request.taskId,
    policyVersion: policy.version,
    executor: target.executor,
    provider: target.provider,
    ...(target.model === undefined ? {} : { model: target.model }),
    fallback: selected.fallback.map(fallback => typeof fallback === 'string' ? fallback : `${fallback.executor}/${fallback.provider}/${fallback.model ?? '(default)'}`),
    reason: reasons.join('; '),
    costTier: target.costTier,
    requiresApproval,
  }
  return {
    decision,
    policyHash: policy.hash,
    matchedRuleId: selected.id,
    approval,
    dispatchable,
    permissionCeiling: permission,
    timeoutMs: selected.timeoutMs,
    ...(selected.review === undefined || !reviewApplies(selected.review, request) ? {} : { review: selected.review }),
    fallbackUsed: availability.fallbackUsed,
  }
}

/** Provider implementation suitable for registration in `ctx.supervisor`. */
export class RoutingPolicyRouter implements RoutingPolicyRouterContract {
  readonly name = 'yaml-routing-policy'
  readonly policy: RoutingPolicy

  /** @param source - compiled policy or YAML/document source. */
  constructor(source: RoutingPolicy | RoutingPolicyDocument | string) {
    this.policy = isCompiled(source) ? source : compileRoutingPolicy(source)
  }

  /** @param request - task context and current resource observations. @returns explainable route result. */
  resolve(request: RouteRequest): ResolvedRouteDecision { return resolveRoute(this.policy, request) }
}

/**
 * Build a stable preview; callers must explicitly confirm before applying it.
 * @param current - active policy.
 * @param next - candidate policy source.
 * @returns policy diff and candidate hash.
 */
export function previewRoutingPolicyUpdate(
  current: RoutingPolicy,
  next: RoutingPolicy | RoutingPolicyDocument | string,
): PolicyUpdatePreview {
  const policy = isCompiled(next) ? next : compileRoutingPolicy(next)
  return { baseHash: current.hash, nextHash: policy.hash, policy, diff: diffRoutingPolicies(current, policy) }
}

/**
 * Apply a preview only when confirmation and the current hash both match.
 * @param current - active policy.
 * @param preview - previously generated preview.
 * @param confirmed - explicit owner confirmation.
 * @returns the confirmed policy.
 */
export function applyRoutingPolicyUpdate(current: RoutingPolicy, preview: PolicyUpdatePreview, confirmed: boolean): RoutingPolicy {
  if (!confirmed) throw new RoutingPolicyError('routing policy update requires explicit confirmation')
  if (preview.baseHash !== current.hash) throw new RoutingPolicyError('routing policy update is stale; preview the diff again')
  if (preview.nextHash !== preview.policy.hash) throw new RoutingPolicyError('routing policy preview hash does not match its policy')
  return preview.policy
}

/**
 * Compare route ids and return a deterministic human-reviewable diff.
 * @param current - active policy.
 * @param next - candidate policy.
 * @returns route additions, removals, and changes.
 */
export function diffRoutingPolicies(current: RoutingPolicy, next: RoutingPolicy): PolicyDiff {
  const before = new Map(current.routes.map(route => [route.id, canonicalJson(route)]))
  const after = new Map(next.routes.map(route => [route.id, canonicalJson(route)]))
  const added = [...after.keys()].filter(id => !before.has(id)).sort()
  const removed = [...before.keys()].filter(id => !after.has(id)).sort()
  const changed = [...after.keys()].filter(id => before.has(id) && before.get(id) !== after.get(id)).sort()
  const lines = [
    ...added.map(id => `+ route ${id}: ${after.get(id)}`),
    ...removed.map(id => `- route ${id}: ${before.get(id)}`),
    ...changed.flatMap(id => [`- route ${id}: ${before.get(id)}`, `+ route ${id}: ${after.get(id)}`]),
  ]
  return { added, removed, changed, lines }
}

/** A stateful policy holder whose update path always exposes a diff first. */
export class RoutingPolicyStore {
  private currentPolicy: RoutingPolicy

  /** @param initial - initial validated policy. */
  constructor(initial: RoutingPolicy | RoutingPolicyDocument | string) {
    this.currentPolicy = isCompiled(initial) ? initial : compileRoutingPolicy(initial)
  }

  /**
   * Return the currently active immutable policy.
   * @returns active policy.
   */
  get policy(): RoutingPolicy { return this.currentPolicy }
  /**
   * Preview a candidate policy update.
   * @param next - candidate policy source.
   * @returns confirmation preview.
   */
  preview(next: RoutingPolicy | RoutingPolicyDocument | string): PolicyUpdatePreview {
    return previewRoutingPolicyUpdate(this.currentPolicy, next)
  }
  /**
   * Apply a previously previewed policy update.
   * @param preview - exact previously generated preview.
   * @param confirmed - explicit owner confirmation.
   * @returns committed policy.
   */
  apply(preview: PolicyUpdatePreview, confirmed: boolean): RoutingPolicy {
    this.currentPolicy = applyRoutingPolicyUpdate(this.currentPolicy, preview, confirmed)
    return this.currentPolicy
  }
}

function unresolved(policy: RoutingPolicy, request: RouteRequest, reason: string, matchedRuleId?: string): ResolvedRouteDecision {
  const decision: RouteDecision = {
    taskId: request.taskId,
    policyVersion: policy.version,
    executor: 'unmatched',
    provider: 'unmatched',
    fallback: [],
    reason,
    costTier: 'unknown',
    requiresApproval: true,
  }
  return { decision, policyHash: policy.hash, ...(matchedRuleId === undefined ? {} : { matchedRuleId }), approval: 'confirm', dispatchable: false, permissionCeiling: 'none', timeoutMs: policy.defaults.timeoutMs, fallbackUsed: false }
}

function matches(route: RoutingRule, request: RouteRequest): boolean {
  if (!includes(route.domain, request.domain)) return false
  if (!includes(route.taskType, request.taskType)) return false
  if (!includes(route.language, request.language)) return false
  if (route.capabilities !== undefined
    && !route.capabilities.every(capability => request.capabilities?.includes(capability) === true)) return false
  if (route.projectAllowlist !== undefined) {
    const project = request.projectId ?? request.projectPath ?? ''
    if (!route.projectAllowlist.some(allowed => allowed === project)) return false
  }
  return true
}

function includes(values: readonly string[] | undefined, value: string | undefined): boolean {
  return values === undefined || (value !== undefined && values.some(candidate => candidate.toLowerCase() === value.toLowerCase()))
}

function specificity(route: RoutingRule): number {
  return (route.domain?.length ?? 0)
    + (route.taskType?.length ?? 0)
    + (route.language?.length ?? 0)
    + (route.capabilities?.length ?? 0)
    + (route.projectAllowlist?.length ?? 0)
}

function selectAvailableTarget(
  route: RoutingRule,
  routes: readonly RoutingRule[],
  request: RouteRequest,
): { target: RouteTarget; fallbackUsed: boolean } | undefined {
  const primary: RouteTarget = {
    executor: route.executor,
    provider: route.provider,
    ...(route.model === undefined ? {} : { model: route.model }),
    costTier: route.costTier,
  }
  if (isAvailable(primary, request)) return { target: primary, fallbackUsed: false }
  for (const fallback of route.fallback) {
    const target = typeof fallback === 'string' ? targetFromRoute(routes.find(candidate => candidate.id === fallback)) : fallback
    if (target !== undefined && isAvailable(target, request)) return { target, fallbackUsed: true }
  }
  return undefined
}

function targetFromRoute(route: RoutingRule | undefined): RouteTarget | undefined {
  if (route === undefined) return undefined
  return {
    executor: route.executor,
    provider: route.provider,
    ...(route.model === undefined ? {} : { model: route.model }),
    costTier: route.costTier,
  }
}

function isAvailable(target: RouteTarget, request: RouteRequest): boolean {
  return (request.availableExecutors === undefined || request.availableExecutors.includes(target.executor))
    && (request.availableProviders === undefined || request.availableProviders.includes(target.provider))
    && (target.model === undefined || request.availableModels === undefined || request.availableModels.includes(target.model))
}

function riskGate(request: RouteRequest): boolean {
  return request.highRisk === true
    || request.paid === true
    || request.credentials === true
    || request.production === true
    || request.destructive === true
}

function reviewApplies(review: NonNullable<RoutingRule['review']>, request: RouteRequest): boolean {
  switch (review.condition) {
    case 'always': return true
    case 'onFailure': return request.failed === true
    case 'highRisk': return riskGate(request)
    case 'whenRequested': return request.reviewRequested === true
    default: return false
  }
}

function isWithinWindows(value: Date | string | number | undefined, timezone: string | undefined, windows: readonly TimeWindow[]): boolean {
  if (windows.length === 0) return true
  const date = value === undefined ? new Date() : new Date(value)
  if (Number.isNaN(date.getTime())) return false
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  const hour = Number(parts.find(part => part.type === 'hour')?.value)
  const minute = Number(parts.find(part => part.type === 'minute')?.value)
  const current = hour * 60 + minute
  return windows.some((window) => {
    const start = minutes(window.start)
    const end = minutes(window.end)
    return start <= end ? current >= start && current <= end : current >= start || current <= end
  })
}

function minutes(value: string): number { return Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) }

function isCompiled(value: RoutingPolicy | RoutingPolicyDocument | string): value is RoutingPolicy { return typeof value === 'object' && typeof (value as RoutingPolicy).hash === 'string' }

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return value
}
