/** Zod schemas for the versioned Personal Supervisor API endpoints. */

import { z } from 'zod'
import type { Wire } from './rpc.schema.ts'
import type {
  SupervisorActionRequest,
  SupervisorActionReceipt,
  SupervisorChildSessionView,
  SupervisorIdentityView,
  SupervisorNotificationView,
  SupervisorProjectView,
  SupervisorRunView,
  SupervisorTaskView,
} from './supervisor.ts'

/** Current wire contract version for supervisor API values. */
export const SUPERVISOR_API_VERSION = 1

const version = z.literal(SUPERVISOR_API_VERSION)
const projectStatus = z.union([z.literal('registered'), z.literal('unavailable'), z.literal('removed')])
const action = z.union([z.literal('approve'), z.literal('reject'), z.literal('rework'), z.literal('pause'), z.literal('continue')])

/** Validate an identity lookup request. */
export const supervisorIdentityRequestSchema = z.object({})
/** Validate an optional project status filter. */
export const supervisorProjectsRequestSchema = z.object({ status: projectStatus.optional() })
/** Validate task listing filters. */
export const supervisorTasksRequestSchema = z.object({
  projectId: z.string().min(1).optional(),
  statuses: z.array(z.string().min(1)).max(32).optional(),
})
/** Validate run listing filters. */
export const supervisorRunsRequestSchema = z.object({ taskId: z.string().min(1).optional() })
/** Validate notification listing filters. */
export const supervisorNotificationsRequestSchema = z.object({
  unreadOnly: z.boolean().optional(),
  afterRevision: z.number().int().nonnegative().optional(),
})
/** Validate a child-session lookup request. */
export const supervisorChildSessionRequestSchema = z.object({ taskId: z.string().min(1), runId: z.string().min(1).optional() })
/** Validate a revision-guarded owner action. */
export const supervisorActionRequestSchema = z.object({
  taskId: z.string().min(1),
  action,
  expectedRevision: z.number().int().positive(),
  feedback: z.string().min(1).optional(),
})

const identity = z.object({
  version,
  id: z.string().min(1),
  sessionId: z.string().min(1),
  revision: z.number().int().positive(),
  createdAt: z.string().datetime(),
})
const project = z.object({
  version,
  id: z.string().min(1),
  revision: z.number().int().positive(),
  displayName: z.string().min(1),
  realPath: z.string().min(1),
  status: projectStatus,
  registeredAt: z.string().datetime(),
})
const task = z.object({
  version,
  id: z.string().min(1),
  revision: z.number().int().positive(),
  projectId: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  status: z.string().min(1),
  nextAction: z.string().min(1),
  blocker: z.string().min(1).optional(),
})
const run = z.object({
  version,
  revision: z.number().int().positive(),
  runId: z.string().min(1),
  taskId: z.string().min(1),
  projectId: z.string().min(1),
  hostSessionId: z.string().min(1),
  childSessionId: z.string().min(1),
  executor: z.string().min(1),
  model: z.string().min(1).optional(),
  writeAccess: z.boolean(),
})
const notification = z.object({
  version,
  revision: z.number().int().positive(),
  id: z.string().min(1),
  taskId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  kind: z.union([
    z.literal('owner-decision'),
    z.literal('blocked'),
    z.literal('failed'),
    z.literal('ready-for-review'),
    z.literal('review-failed'),
    z.literal('policy-gate'),
  ]),
  message: z.string().min(1),
  unread: z.boolean(),
  createdAt: z.string().datetime(),
})
const childSession = z.object({
  version,
  taskId: z.string().min(1),
  runId: z.string().min(1),
  sessionId: z.string().min(1),
  parentSessionId: z.string().min(1),
  readOnly: z.literal(true),
})
const receipt = z.object({ version, taskId: z.string().min(1), revision: z.number().int().positive(), accepted: z.literal(true) })

/** Validate the versioned identity response. */
export const supervisorIdentityValueSchema = identity as unknown as z.ZodType<Wire<SupervisorIdentityView>>
/** Validate the versioned project-list response. */
export const supervisorProjectsValueSchema = z.object({ version, projects: z.array(project) }) as unknown as z.ZodType<
  Wire<{ projects: SupervisorProjectView[] }>
>
/** Validate the versioned task-list response. */
export const supervisorTasksValueSchema = z.object({ version, tasks: z.array(task) }) as unknown as z.ZodType<
  Wire<{ tasks: SupervisorTaskView[] }>
>
/** Validate the versioned run-list response. */
export const supervisorRunsValueSchema = z.object({ version, runs: z.array(run) }) as unknown as z.ZodType<
  Wire<{ runs: SupervisorRunView[] }>
>
/** Validate the versioned notification-list response. */
export const supervisorNotificationsValueSchema = z.object({ version, notifications: z.array(notification) }) as unknown as z.ZodType<
  Wire<{ notifications: SupervisorNotificationView[] }>
>
/** Validate the versioned child-session response. */
export const supervisorChildSessionValueSchema = childSession as unknown as z.ZodType<Wire<SupervisorChildSessionView>>
/** Validate the versioned action receipt. */
export const supervisorActionValueSchema = receipt as unknown as z.ZodType<Wire<SupervisorActionReceipt>>

/**
 * Add the wire version to a Supervisor API value before validation/encoding.
 * @param value - response object without its protocol version.
 * @returns the response with the current protocol version.
 */
export function withSupervisorVersion<T extends object>(value: T): T & { version: typeof SUPERVISOR_API_VERSION } {
  return { ...value, version: SUPERVISOR_API_VERSION }
}

/**
 * Runtime validation helper for action requests at an integration boundary.
 * @param value - unknown request received from a transport boundary.
 * @returns the validated owner action request.
 */
export function parseSupervisorAction(value: unknown): SupervisorActionRequest {
  return supervisorActionRequestSchema.parse(value) as SupervisorActionRequest
}
