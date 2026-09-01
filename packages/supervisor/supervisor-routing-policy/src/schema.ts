/** Strict YAML parser and validator for Supervisor routing policies. */

import { load } from 'js-yaml'
import { RoutingPolicyError } from './error.ts'
import type {
  ApprovalMode,
  BudgetLimit,
  CostTier,
  PermissionCeiling,
  ReviewCondition,
  ReviewPipeline,
  ReviewStrategy,
  RouteTarget,
  RoutingPolicyDocument,
  TimeWindow,
} from './types.ts'

const APPROVALS = new Set<ApprovalMode>(['auto', 'confirm', 'deny'])
const COST_TIERS = new Set<CostTier>(['free', 'low', 'medium', 'high', 'unknown'])
const PERMISSIONS = new Set<PermissionCeiling>(['none', 'read', 'write', 'execute', 'admin'])
const STRATEGIES = new Set<ReviewStrategy>(['single', 'primary-reviewer', 'parallel-synthesis'])
const CONDITIONS = new Set<ReviewCondition>(['always', 'onFailure', 'highRisk', 'whenRequested'])
const CREDENTIAL_KEY = /^(?:api[_-]?key|access[_-]?key|secret|password|token|credential|authorization|private[_-]?key|refresh[_-]?token)$/i

const ROOT_KEYS = new Set(['version', 'timezone', 'timeWindows', 'defaults', 'budget', 'concurrency', 'routes'])
const DEFAULT_KEYS = new Set(['approval', 'permissionCeiling', 'timeoutMs', 'costTier'])
const BUDGET_KEYS = new Set(['maxCostUnits', 'maxRuns'])
const CONCURRENCY_KEYS = new Set(['maxConcurrent'])
const ROUTE_KEYS = new Set([
  'id', 'domain', 'taskType', 'language', 'capabilities', 'executor', 'provider', 'model', 'costTier',
  'approval', 'permissionCeiling', 'timeoutMs', 'projectAllowlist', 'fallback', 'budget', 'concurrency',
  'timezone', 'timeWindows', 'review',
])
const TARGET_KEYS = new Set(['executor', 'provider', 'model', 'costTier'])
const REVIEW_KEYS = new Set(['strategy', 'condition', 'reviewer', 'reviewers', 'synthesis'])
const WINDOW_KEYS = new Set(['start', 'end'])

/**
 * Parse and validate one YAML policy document. Credentials and unknown keys are rejected.
 * @param source - YAML policy text.
 * @returns validated policy document.
 */
export function parseRoutingPolicyYaml(source: string): RoutingPolicyDocument {
  if (typeof source !== 'string' || source.trim().length === 0) throw new RoutingPolicyError('routing policy YAML must be non-empty')
  let parsed: unknown
  try {
    parsed = load(source, { json: false })
  } catch (error: unknown) {
    throw new RoutingPolicyError(`invalid routing policy YAML: ${error instanceof Error ? error.message : String(error)}`)
  }
  rejectCredentialKeys(parsed, '$')
  return validateDocument(parsed)
}

/**
 * Validate an already parsed policy document. The returned value is detached from input.
 * @param input - parsed policy value from a trusted or wire boundary.
 * @returns validated detached policy document.
 */
export function validateRoutingPolicyDocument(input: unknown): RoutingPolicyDocument {
  rejectCredentialKeys(input, '$')
  return validateDocument(input)
}

function validateDocument(input: unknown): RoutingPolicyDocument {
  const root = record(input, '$')
  keys(root, ROOT_KEYS, '$')
  const version = root.version === undefined ? undefined : stringOrNumber(root.version, '$.version')
  const timezone = root.timezone === undefined ? undefined : nonEmptyString(root.timezone, '$.timezone')
  if (timezone !== undefined) validateTimezone(timezone, '$.timezone')
  const defaults = root.defaults === undefined ? undefined : validateDefaults(root.defaults, '$.defaults')
  const timeWindows = root.timeWindows === undefined ? undefined : validateWindows(root.timeWindows, '$.timeWindows')
  const budget = root.budget === undefined ? undefined : validateBudget(root.budget, '$.budget')
  const concurrency = root.concurrency === undefined ? undefined : validateConcurrency(root.concurrency, '$.concurrency')
  if (!Array.isArray(root.routes) || root.routes.length === 0) throw new RoutingPolicyError('$.routes must be a non-empty array')
  const seen = new Set<string>()
  const routes = root.routes.map((value, index) => {
    const route = validateRoute(value, index, defaults)
    if (seen.has(route.id)) throw new RoutingPolicyError(`$.routes[${index}].id duplicates "${route.id}"`)
    seen.add(route.id)
    return route
  })
  const routeIds = new Set(routes.map(route => route.id))
  for (const route of routes) {
    for (const fallback of route.fallback ?? []) {
      if (typeof fallback === 'string' && (!routeIds.has(fallback) || fallback === route.id)) {
        throw new RoutingPolicyError(`$.routes[${route.id}].fallback references an unknown or self route "${fallback}"`)
      }
    }
  }
  return {
    ...(version === undefined ? {} : { version }),
    ...(timezone === undefined ? {} : { timezone }),
    ...(timeWindows === undefined ? {} : { timeWindows }),
    ...(defaults === undefined ? {} : { defaults }),
    ...(budget === undefined ? {} : { budget }),
    ...(concurrency === undefined ? {} : { concurrency }),
    routes,
  }
}

function validateDefaults(value: unknown, path: string): NonNullable<RoutingPolicyDocument['defaults']> {
  const object = record(value, path)
  keys(object, DEFAULT_KEYS, path)
  return {
    ...(object.approval === undefined ? {} : { approval: enumValue(object.approval, APPROVALS, `${path}.approval`) }),
    ...(object.permissionCeiling === undefined ? {} : { permissionCeiling: enumValue(object.permissionCeiling, PERMISSIONS, `${path}.permissionCeiling`) }),
    ...(object.timeoutMs === undefined ? {} : { timeoutMs: positiveInteger(object.timeoutMs, `${path}.timeoutMs`) }),
    ...(object.costTier === undefined ? {} : { costTier: enumValue(object.costTier, COST_TIERS, `${path}.costTier`) }),
  }
}

function validateRoute(
  value: unknown,
  index: number,
  defaults: RoutingPolicyDocument['defaults'],
): RoutingPolicyDocument['routes'][number] & { readonly id: string } {
  const path = `$.routes[${index}]`
  const object = record(value, path)
  keys(object, ROUTE_KEYS, path)
  const id = object.id === undefined ? `route-${index + 1}` : nonEmptyString(object.id, `${path}.id`)
  const executor = nonEmptyString(object.executor, `${path}.executor`)
  const provider = nonEmptyString(object.provider, `${path}.provider`)
  const model = object.model === undefined ? undefined : nonEmptyString(object.model, `${path}.model`)
  const timezone = object.timezone === undefined ? undefined : nonEmptyString(object.timezone, `${path}.timezone`)
  if (timezone !== undefined) validateTimezone(timezone, `${path}.timezone`)
  return {
    id,
    ...optionalStringList(object.domain, `${path}.domain`),
    ...optionalStringList(object.taskType, `${path}.taskType`),
    ...optionalStringList(object.language, `${path}.language`),
    ...optionalStringList(object.capabilities, `${path}.capabilities`),
    executor,
    provider,
    ...(model === undefined ? {} : { model }),
    costTier: enumValue(object.costTier ?? defaults?.costTier ?? 'unknown', COST_TIERS, `${path}.costTier`),
    approval: enumValue(object.approval ?? defaults?.approval ?? 'confirm', APPROVALS, `${path}.approval`),
    permissionCeiling: enumValue(object.permissionCeiling ?? defaults?.permissionCeiling ?? 'read', PERMISSIONS, `${path}.permissionCeiling`),
    timeoutMs: positiveInteger(object.timeoutMs ?? defaults?.timeoutMs ?? 30_000, `${path}.timeoutMs`),
    ...optionalStringList(object.projectAllowlist, `${path}.projectAllowlist`),
    fallback: object.fallback === undefined ? [] : validateFallback(object.fallback, `${path}.fallback`),
    ...(object.budget === undefined ? {} : { budget: validateBudget(object.budget, `${path}.budget`) }),
    ...(object.concurrency === undefined ? {} : { concurrency: validateConcurrency(object.concurrency, `${path}.concurrency`) }),
    ...(timezone === undefined ? {} : { timezone }),
    timeWindows: object.timeWindows === undefined ? [] : validateWindows(object.timeWindows, `${path}.timeWindows`),
    ...(object.review === undefined ? {} : { review: validateReview(object.review, `${path}.review`) }),
  }
}

function validateFallback(value: unknown, path: string): readonly (RouteTarget | string)[] {
  if (!Array.isArray(value)) throw new RoutingPolicyError(`${path} must be an array`)
  return value.map((item, index) => typeof item === 'string' ? nonEmptyString(item, `${path}[${index}]`) : validateTarget(item, `${path}[${index}]`))
}

function validateTarget(value: unknown, path: string): RouteTarget {
  const object = record(value, path)
  keys(object, TARGET_KEYS, path)
  return {
    executor: nonEmptyString(object.executor, `${path}.executor`),
    provider: nonEmptyString(object.provider, `${path}.provider`),
    ...(object.model === undefined ? {} : { model: nonEmptyString(object.model, `${path}.model`) }),
    costTier: enumValue(object.costTier ?? 'unknown', COST_TIERS, `${path}.costTier`),
  }
}

function validateReview(value: unknown, path: string): ReviewPipeline {
  const object = record(value, path)
  keys(object, REVIEW_KEYS, path)
  const strategy = enumValue(object.strategy ?? 'single', STRATEGIES, `${path}.strategy`)
  const condition = enumValue(object.condition ?? 'always', CONDITIONS, `${path}.condition`)
  const reviewer = object.reviewer === undefined ? undefined : validateTarget(object.reviewer, `${path}.reviewer`)
  const reviewers = object.reviewers === undefined ? undefined : arrayOfTargets(object.reviewers, `${path}.reviewers`)
  const synthesis = object.synthesis === undefined ? undefined : validateTarget(object.synthesis, `${path}.synthesis`)
  if (strategy === 'single' && reviewer === undefined) throw new RoutingPolicyError(`${path}.reviewer is required for single review`)
  if (strategy === 'primary-reviewer' && reviewer === undefined) throw new RoutingPolicyError(`${path}.reviewer is required for primary-reviewer`)
  if (strategy === 'parallel-synthesis' && (reviewers === undefined || reviewers.length < 2 || synthesis === undefined)) throw new RoutingPolicyError(`${path}.reviewers (at least two) and synthesis are required for parallel-synthesis`)
  return {
    strategy,
    condition,
    ...(reviewer === undefined ? {} : { reviewer }),
    ...(reviewers === undefined ? {} : { reviewers }),
    ...(synthesis === undefined ? {} : { synthesis }),
  }
}

function arrayOfTargets(value: unknown, path: string): readonly RouteTarget[] {
  if (!Array.isArray(value)) throw new RoutingPolicyError(`${path} must be an array`)
  return value.map((item, index) => validateTarget(item, `${path}[${index}]`))
}

function validateBudget(value: unknown, path: string): BudgetLimit {
  const object = record(value, path)
  keys(object, BUDGET_KEYS, path)
  return {
    ...(object.maxCostUnits === undefined ? {} : { maxCostUnits: nonNegativeNumber(object.maxCostUnits, `${path}.maxCostUnits`) }),
    ...(object.maxRuns === undefined ? {} : { maxRuns: nonNegativeInteger(object.maxRuns, `${path}.maxRuns`) }),
  }
}

function validateConcurrency(value: unknown, path: string): { readonly maxConcurrent: number } {
  const object = record(value, path)
  keys(object, CONCURRENCY_KEYS, path)
  return { maxConcurrent: positiveInteger(object.maxConcurrent, `${path}.maxConcurrent`) }
}

function validateWindows(value: unknown, path: string): readonly TimeWindow[] {
  if (!Array.isArray(value)) throw new RoutingPolicyError(`${path} must be an array`)
  return value.map((item, index) => {
    const object = record(item, `${path}[${index}]`)
    keys(object, WINDOW_KEYS, `${path}[${index}]`)
    const start = timeValue(object.start, `${path}[${index}].start`)
    const end = timeValue(object.end, `${path}[${index}].end`)
    return { start, end }
  })
}

function optionalStringList(value: unknown, path: string): Record<string, readonly string[]> | Record<string, never> {
  if (value === undefined) return {}
  const values = Array.isArray(value) ? value : [value]
  if (values.length === 0) throw new RoutingPolicyError(`${path} must not be empty`)
  return { [path.slice(path.lastIndexOf('.') + 1)]: values.map((item, index) => nonEmptyString(item, `${path}[${index}]`)) }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new RoutingPolicyError(`${path} must be an object`)
  return value as Record<string, unknown>
}

function keys(value: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new RoutingPolicyError(`${path}: unknown key "${key}"`)
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new RoutingPolicyError(`${path} must be a non-empty string`)
  return value.trim()
}

function stringOrNumber(value: unknown, path: string): string | number {
  if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'number' && !Number.isFinite(value))) throw new RoutingPolicyError(`${path} must be a finite string or number`)
  return typeof value === 'string' ? nonEmptyString(value, path) : value
}

function enumValue<T extends string>(value: unknown, allowed: ReadonlySet<T>, path: string): T {
  if (typeof value !== 'string' || !allowed.has(value as T)) throw new RoutingPolicyError(`${path} must be one of ${[...allowed].join(', ')}`)
  return value as T
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new RoutingPolicyError(`${path} must be a positive safe integer`)
  return value
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new RoutingPolicyError(`${path} must be a non-negative safe integer`)
  return value
}

function nonNegativeNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new RoutingPolicyError(`${path} must be a non-negative number`)
  return value
}

function timeValue(value: unknown, path: string): string {
  const result = nonEmptyString(value, path)
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(result)) throw new RoutingPolicyError(`${path} must use HH:mm`)
  return result
}

function validateTimezone(value: string, path: string): void {
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format() } catch { throw new RoutingPolicyError(`${path} must be a valid IANA timezone`) }
}

function rejectCredentialKeys(value: unknown, path: string): void {
  if (Array.isArray(value)) { value.forEach((item, index) =>{  rejectCredentialKeys(item, `${path}[${index}]`) }); return }
  if (typeof value !== 'object' || value === null) return
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (CREDENTIAL_KEY.test(key)) throw new RoutingPolicyError(`${path}.${key} is not allowed; credentials belong to the credential provider`)
    rejectCredentialKeys(child, `${path}.${key}`)
  }
}
