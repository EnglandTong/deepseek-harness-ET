/** Public data types for the Personal Supervisor routing policy. */

import type {
  RouteDecision,
  SupervisorProjectId,
  SupervisorRouter,
  SupervisorTaskId,
} from '@deepseek-ai/dsh-supervisor'

/** Policy disposition for a route. */
export type ApprovalMode = 'auto' | 'confirm' | 'deny'
/** Relative provider cost classification. */
export type CostTier = 'free' | 'low' | 'medium' | 'high' | 'unknown'
/** Maximum permission a selected executor may receive. */
export type PermissionCeiling = 'none' | 'read' | 'write' | 'execute' | 'admin'
/** Review topology applied after execution. */
export type ReviewStrategy = 'single' | 'primary-reviewer' | 'parallel-synthesis'
/** Condition that enables a review pipeline. */
export type ReviewCondition = 'always' | 'onFailure' | 'highRisk' | 'whenRequested'

/** A local-time execution window. End times may be earlier than start times. */
export interface TimeWindow {
  readonly start: string
  readonly end: string
}

/** Cost and run ceilings applied to one route or the complete policy. */
export interface BudgetLimit {
  readonly maxCostUnits?: number
  readonly maxRuns?: number
}

/** Concurrent execution ceiling. */
export interface ConcurrencyLimit {
  readonly maxConcurrent: number
}

/** Concrete provider target used by a primary or fallback route. */
export interface RouteTarget {
  readonly executor: string
  readonly provider: string
  readonly model?: string
  readonly costTier: CostTier
}

/** Reviewer selection and optional synthesis model. */
export interface ReviewPipeline {
  readonly strategy: ReviewStrategy
  readonly condition: ReviewCondition
  readonly reviewer?: RouteTarget
  readonly reviewers?: readonly RouteTarget[]
  readonly synthesis?: RouteTarget
}

/** One validated YAML route rule. */
export interface RoutingRule {
  readonly id: string
  readonly domain?: readonly string[]
  readonly taskType?: readonly string[]
  readonly language?: readonly string[]
  readonly capabilities?: readonly string[]
  readonly executor: string
  readonly provider: string
  readonly model?: string
  readonly costTier: CostTier
  readonly approval: ApprovalMode
  readonly permissionCeiling: PermissionCeiling
  readonly timeoutMs: number
  readonly projectAllowlist?: readonly string[]
  readonly fallback: readonly (RouteTarget | string)[]
  readonly budget?: BudgetLimit
  readonly concurrency?: ConcurrencyLimit
  readonly timezone?: string
  readonly timeWindows?: readonly TimeWindow[]
  readonly review?: ReviewPipeline
}

/** Input document accepted by YAML parsing or programmatic policy updates. */
export interface RoutingPolicyDocument {
  readonly version?: string | number
  readonly timezone?: string
  readonly timeWindows?: readonly TimeWindow[]
  readonly defaults?: {
    readonly approval?: ApprovalMode
    readonly permissionCeiling?: PermissionCeiling
    readonly timeoutMs?: number
    readonly costTier?: CostTier
  }
  readonly budget?: BudgetLimit
  readonly concurrency?: ConcurrencyLimit
  readonly routes: readonly (Omit<RoutingRule, 'id' | 'approval' | 'permissionCeiling' | 'timeoutMs' | 'costTier' | 'fallback'> & {
    readonly id?: string
    readonly approval?: ApprovalMode
    readonly permissionCeiling?: PermissionCeiling
    readonly timeoutMs?: number
    readonly costTier?: CostTier
    readonly fallback?: readonly (RouteTarget | string)[]
  })[]
}

/** Fully resolved immutable policy. */
export interface RoutingPolicy {
  readonly version: string
  readonly hash: string
  readonly timezone?: string
  readonly timeWindows: readonly TimeWindow[]
  readonly defaults: {
    readonly approval: ApprovalMode
    readonly permissionCeiling: PermissionCeiling
    readonly timeoutMs: number
    readonly costTier: CostTier
  }
  readonly budget?: BudgetLimit
  readonly concurrency?: ConcurrencyLimit
  readonly routes: readonly RoutingRule[]
}

/** Current resource observations used for budget and availability gates. */
export interface RouteUsage {
  readonly spentCostUnits?: number
  readonly completedRuns?: number
  readonly activeConcurrent?: number
}

/** Request context supplied by the orchestrator to route one task. */
export interface RouteRequest {
  readonly taskId: SupervisorTaskId
  readonly projectId?: SupervisorProjectId
  readonly projectPath?: string
  readonly domain?: string
  readonly taskType?: string
  readonly language?: string
  readonly capabilities?: readonly string[]
  readonly requestedPermission?: PermissionCeiling
  readonly highRisk?: boolean
  readonly paid?: boolean
  readonly credentials?: boolean
  readonly production?: boolean
  readonly destructive?: boolean
  /** Whether a prior execution failed; used by `onFailure` reviewer conditions. */
  readonly failed?: boolean
  /** Explicit owner/requester signal for `whenRequested` reviewer conditions. */
  readonly reviewRequested?: boolean
  readonly now?: Date | string | number
  readonly estimatedCostUnits?: number
  readonly usage?: RouteUsage
  readonly availableExecutors?: readonly string[]
  readonly availableProviders?: readonly string[]
  readonly availableModels?: readonly string[]
}

/** Explainable route result with policy controls needed by dispatch. */
export interface ResolvedRouteDecision {
  readonly decision: RouteDecision
  readonly policyHash: string
  readonly matchedRuleId?: string
  readonly approval: ApprovalMode
  readonly dispatchable: boolean
  readonly permissionCeiling: PermissionCeiling
  readonly timeoutMs: number
  readonly review?: ReviewPipeline
  readonly fallbackUsed: boolean
}

/** Stable route-level changes shown before a policy update is committed. */
export interface PolicyDiff {
  readonly added: readonly string[]
  readonly removed: readonly string[]
  readonly changed: readonly string[]
  readonly lines: readonly string[]
}

/** A confirmed update must match this preview before it can be applied. */
export interface PolicyUpdatePreview {
  readonly baseHash: string
  readonly nextHash: string
  readonly policy: RoutingPolicy
  readonly diff: PolicyDiff
}

/** Typed router provider exposed to the Supervisor registry. */
export interface RoutingPolicyRouter extends SupervisorRouter {
  readonly policy: RoutingPolicy
  resolve(request: RouteRequest): ResolvedRouteDecision
}
