# Subagent

English | [中文](subagent.zh.md)

The subagent seam lets an agent delegate work to a child agent. Like [bash](shell.md), it is **one optional capability**, not part of the agent loop, so its types live here rather than in [core.md](core.md). It differs from the other capability seams because **multiple provider implementations coexist** in one context, registered by name (`ctx.subagents`), while bash allows only one executor. Its registry follows the [LLM adapter registry](llm-streaming.md), not the single-service bash executor.

Service Definition: [dsh-subagent](../../packages/subagent/subagent) (`ctx.subagents` + the vocabulary below). Service Providers are sibling packages (`dsh-subagent-spawn-in-process`, `-fork`, `-acp`, `-codex`, `-claude-code`, `-dsh-sdk`); the model-facing Consumers are [dsh-tool-subagent](../../packages/subagent/tool-subagent) (per-provider delegation), [dsh-tool-subagent-control](../../packages/subagent/tool-subagent-control) (the optional global `send_message`, `interrupt_agent`, and `list_agents` controls), and [dsh-tool-subagent-report](../../packages/subagent/tool-subagent-report) (the optional child-scoped `report` return channel). The same `ctx.subagents` service owns continuable-child orchestration through an internal activation manager and read-only child and descendant discovery straight from the session store and optional session persistence. Product-provider rationale lives in [the Codex and Claude Code Agent Note](../../.agents/notes/implemented/feature/2026-08-04-claude-code-and-codex-subagent-backends.md); common-seam rationale lives in [the subagent Agent Note](../../.agents/notes/implemented/feature/2026-06-21-subagent-capability-seam.md), [the continuable subagents Agent Note](../../.agents/notes/implemented/feature/2026-07-28-continuable-subagent-conversations.md), [the report-tool Agent Note](../../.agents/notes/implemented/feature/2026-07-30-continuable-subagent-report-tool.md), [the durable catalog Agent Note](../../.agents/notes/implemented/feature/2026-07-22-durable-subagent-catalog-and-list-agents.md), [the list-identity-projection Agent Note](../../.agents/notes/implemented/architecture/2026-08-06-subagent-list-identity-projection.md), and [the merged-service Agent Note](../../.agents/notes/implemented/simplification/2026-07-26-merge-subagent-control-service.md).

Sources: [`packages/subagent/subagent/src/types.ts`](../../packages/subagent/subagent/src/types.ts), [`packages/subagent/subagent/src/index.ts`](../../packages/subagent/subagent/src/index.ts), and [`packages/subagent/subagent/src/continuation.ts`](../../packages/subagent/subagent/src/continuation.ts)

## Two kinds of capability, discovered two ways

A provider advertises its **start-time** features on a static descriptor the service checks BEFORE a one-shot run exists; a request that needs one the provider lacks is rejected loud (`SubagentError('UNSUPPORTED_CAPABILITY')`), never accepted-then-ignored. Those flags describe only the one-shot [`start()`](#the-provider-contract-subagentprovider) path, where the provider composes the child. **Continuable** children are composed by the continuation manager itself, so they are gated by one optional method whose presence IS the capability, with TS narrowing as the discovery mechanism: [`SubagentProvider.prepareContinuable`](#the-provider-contract-subagentprovider).

```ts type-equiv
/**
 * Which START-TIME features a provider supports. Checked by the service before delegating to
 * {@link SubagentProvider.start}: a request that needs a capability the chosen provider lacks
 * is rejected with a typed error rather than accepted-then-ignored (the "fail loud, no silent
 * degradation" rule). These flags describe the ONE-SHOT
 * {@link SubagentProvider.start} path, where the provider composes the child;
 * continuable children are composed by the continuation manager itself and are
 * gated by {@link SubagentProvider.prepareContinuable} instead. Each flag
 * corresponds one-to-one to a {@link SubagentStartRequest} option: `depthLimit`
 * to `maxDepth`; the other names match.
 */
interface SubagentCapabilities {
  readonly outputSchema: boolean
  readonly depthLimit: boolean
  readonly toolFilter: boolean
  readonly persona: boolean
}
```

## The one-shot start request

The tool layer builds this request from the model input and its own config; the service validates it against the named provider before `start`. Required `parent` supplies the session cwd, lineage, and delegation depth. Optional output schema, depth, tool filter, and persona require matching capability flags. Unsupported schemas fail at start; in-process backends scope filters and personas to child creation and implement the supported object-rooted schema with a forced capture tool.

```ts type-equiv
/**
 * What a caller asks for when starting a ONE-SHOT subagent. The tool layer
 * builds this from the model's `{ description, prompt }` plus its own config;
 * the service validates {@link SubagentCapabilities} against the named provider
 * and resolves the durable descriptor before dispatching to
 * {@link SubagentProvider.start}.
 */
interface SubagentStartRequest {
  /** Optional short display label persisted with a session-backed child. */
  readonly label?: string
  /** Content delivered as the child's user message. */
  readonly prompt: ContentBlock[]
  /**
   * The spawning agent. In-process providers derive workspace, lineage, and
   * delegation depth from its durable session state. ACP reads only its cwd,
   * and only when no deployment `cwd` override is configured.
   */
  readonly parent: Agent
  /**
   * Cancellation signal from the spawning context (the tool's `exec.signal`).
   * This is the canonical cancellation channel both before and after startup:
   * a provider rejects `start()` after cleaning partial resources when it
   * fires before the run is published, and cancels the published run's
   * remaining turn work when it fires afterward.
   */
  readonly signal: AbortSignal
  readonly agentOptions?: AgentOptions
  /**
   * Object-rooted JSON Schema within `assertObjectJsonSchema`'s enforced subset. Start rejects
   * unsupported schemas or providers without the capability. Data must be plain host-realm JSON;
   * a successful child returns the matching value as {@link SubagentResult.structured}.
   */
  readonly outputSchema?: ObjectJsonSchema
  /**
   * Optional absolute delegation-depth cap for the child being started: its
   * computed depth must be less than or equal to this non-negative safe
   * integer. Requires {@link SubagentCapabilities.depthLimit}; rejected at
   * start otherwise.
   */
  readonly maxDepth?: number
  /**
   * Optional child tool scoping. Requires {@link SubagentCapabilities.toolFilter};
   * rejected at start otherwise. In-process backends apply it as a scoped
   * `tools.restrict()` in the child's creation window: the named tools vanish
   * from the child's prompt AND refuse to execute (one visibility), with loud
   * unknown-name validation.
   */
  readonly toolFilter?: ToolRestriction
  /**
   * Optional per-child persona. Requires {@link SubagentCapabilities.persona};
   * rejected at start otherwise. In-process backends register it as a scoped
   * `deployment:persona` section on the child, SHADOWING the deployment's
   * persona for this child alone — same template semantics as the deployment
   * persona (strict `{{…}}` interpolation against the registered variables).
   */
  readonly persona?: string
}
```

`signal` is the single cancellation channel before and after readiness. The [subagent composition-controls Agent Note](../../.agents/notes/implemented/feature/2026-07-12-subagent-persona-tool-filter-and-depth.md) owns the persona, live global-tool filter, absolute-depth, and visibility-not-authority rationale.

The caller-facing request does not carry catalog format details or continuation state. `SubagentRuntime.start()` resolves the detached one-shot descriptor after capability checks, then passes this provider-facing request to the selected transport; a continuable child never reaches `SubagentProvider.start()`:

```ts type-equiv
/**
 * Provider-facing one-shot request after {@link SubagentRuntime.start} resolves
 * the durable child descriptor.
 */
interface ResolvedSubagentStartRequest extends SubagentStartRequest {
  /** Detached descriptor a session-backed provider persists in the child log. */
  readonly descriptor: SubagentDescriptorData
}
```

## Continuable children and activations

A **continuable background subagent** is one durable child Session with at most one process-local **Activation**, the period when a reconstructed child Agent is resident. An Activation is not a request, result, cancellation, or Task: it may execute many FIFO turns and stays resident while descendants it created are still running. The continuation manager owns activation admission, direct-parent authorization, the live ownership graph, cold resume, and child-first disposal; the Agent loop owns all turn ordering and execution. No continuable path creates a Task or an intermediate result-bearing wrapper.

```text
persisted Session
  -> optional live Activation
       -> one retained AgentHandle
       -> Agent inbox as the only turn FIFO
       -> zero or more owned child Activations
```

`SubagentRuntime.startContinuable()` reserves the stable child id, snapshots the versioned `subagent/descriptor` payload, asks the named provider for its detached `ContinuableCreateSpec`, creates the child Agent through a private activation-owner scope, establishes any continuable-parent ownership, and submits the initial prompt. It resolves with `{ childId, messageId }` when inbox acceptance yields the message id — without waiting for the turn to start or for the message to enter the Session log. Every failure before that acceptance rejects with neither id, disposing any created handle and rolling back the Activation and parent ownership.

`SubagentRuntime.followup()` is the sole continuation-message operation, and routing depends only on Activation residency:

| Activation state | `followup` |
|---|---|
| `running` | enqueue in the same Activation |
| `waiting` | wake the same Activation |
| no Activation | cold-resume a new Activation |

`running` means the Agent has an active admission or turn, or waking inbox work; `waiting` means it is quiescent but still owns at least one child Activation that has not completed disposal; `settled` means quiescent with every owned child disposed, at which point the manager disposes the [`AgentHandle`](core.md#creation-and-ownership) and removes the Activation. The manager derives these internal conditions from Agent quiescence and the owned-child set rather than maintaining a second execution state machine.

The Agent inbox is the only queue. Every continuation message becomes one `Agent.followup()` FIFO turn, so accepted messages have one observable order and a follow-up cannot redirect a turn already underway. Successful delivery returns the accepted `MessageId`; the existing `agent/inbox/inserted`, `agent/inbox/claimed`, and `agent/inbox/discarded` events remain the message-lifecycle observations, and the continuation layer defines no subagent-specific delivery route.

Follow-up authority comes from an exact live Agent tool context. The authenticated Agent must be the durable child's direct parent recorded in `SessionHeader.parentSession`. `MessageSource` and `senderSessionId` record who supplied an admitted message but grant no authority; the optional model-facing tool uses `CoordinatorMessageSource`.

For both operations the caller signal owns lookup, materialization, and admission only until inbox acceptance. Afterwards the manager owns the Activation independently: later caller cancellation neither cancels the accepted turn nor disposes the child, and the seam exposes no steering operation.

`SubagentRuntime.interrupt(targetSessionId, authority)` is the one public stop: it authorizes synchronously, issues `Agent.cancel(cause, { keepInbox: true })` on the live target, and returns without awaiting quiescence. The Activation, its unclaimed pending inbox work, and published descendants are untouched; work already claimed into the interrupted turn is not requeued. Once the interrupted driver is idle, a waking send resumes the parked FIFO queue. An absent target — unknown, one-shot, or already settled — and a manager-less composition are accepted no-ops. For a live target, a mismatched parent address or caller outside its live ancestry rejects with `UNAUTHORIZED`; stale ancestor objects and self-targeting ancestor requests reject before target lookup.

```ts type-equiv
/**
 * Authority under which one interrupt request is admitted. `user` carries the
 * durable direct-parent address a human client presented; `ancestor` carries
 * the exact live Agent object whose recorded lineage must contain the caller.
 */
type SubagentInterruptAuthority =
  | { readonly kind: 'user'; readonly parentSessionId: SessionId }
  | { readonly kind: 'ancestor'; readonly agent: Agent }
```

Every Activation owns its `AgentHandle` and an `ownedChildren: Set<SessionId>`; because one Session has at most one live Activation, the child Session id identifies the live child without another runtime-incarnation reference. Starting a child or submitting parent-originated work registers the child in a continuation-managed parent's set before the child can run, and that parent cannot settle while the set is non-empty. A top-level or other non-continuation Agent has no Activation and stays outside the waiting graph. Child release happens only after the child Agent is quiescent, every child of that child is disposed, the best-effort final session flush settles, and the child's `AgentHandle` completes disposal.

Final settlement awaits `ctx.sessions.flush(session)` but ignores its participation boolean because an arbitrary listener cannot prove that a persistence backend stored the state. Rejection is logged without failing the Activation, and the manager still disposes the handle and releases ownership; the persisted child state may then be missing or stale on a later resume. Manager unload invokes an internal manager-wide drain that closes admission and disposes every live forest; `drainContinuableDescendants(parents)` closes admission only below exact live host-owned Agents and disposes their continuable descendants while unrelated forests remain live. Both await already-admitted materializations in their scope, propagate cancellation top-down, release handles child-first, and await every selected branch despite individual failures. Durable child Sessions survive that process-local teardown.

```ts type-equiv
/** Attribution for a model coordinator's follow-up to one of its children. */
interface CoordinatorMessageSource {
  readonly kind: 'coordinator'
  /** A message another agent addressed to this one (`relay` context form). */
  readonly form: 'relay'
  /** Session id of the agent whose tool call produced the follow-up. */
  readonly senderSessionId: SessionId
}
```

```ts type-equiv
/** Options for following up with one continuable child. */
interface SubagentFollowupOptions {
  /** Durable attribution retained on the delivered message; it grants no authority. */
  readonly source: MessageSource
  /** Caller cancellation, owning the operation only until inbox acceptance. */
  readonly signal: AbortSignal
}
```

```ts type-equiv
/** Identities returned once a continuable child accepted its initial prompt. */
interface ContinuableStart {
  /** The durable child session id, stable across activations. */
  readonly childId: SessionId
  /** The accepted initial prompt's inbox message id. */
  readonly messageId: MessageId
}
```

An optional continuable-child setup contribution can install scope-local capabilities after base child composition and before Activation publication. The registry is ordered and transactional: a failed or revoked setup rolls back the unpublished Activation, child-scope disposal releases every installation, new registrations affect the next Activation, and registration removal revokes every resident installation immediately.

`SubagentRuntime.reportFrom()` uses that extension point without adding a second queue or a result-bearing child wrapper. The exact live child Agent authorizes the call; callers cannot name a recipient. The manager derives the only recipient from the child's durable `parentSession`, requires that parent Agent to be live, frames the selected content as one `subagent-report` user message, and returns the message's stable `MessageId`. Quiet delivery uses `Agent.inject()` and does not wake the parent; next-step delivery uses `Agent.steer()`, waking an idle parent or joining a running parent's nearest step boundary. Neither mode concludes the child's turn, and no final answer reports implicitly.

```ts type-equiv
/** Durable attribution for a continuable child's explicit parent report. */
interface SubagentReportMessageSource {
  readonly kind: 'subagent-report'
  /** A message another agent addressed to this one (`relay` context form). */
  readonly form: 'relay'
  /** Session id of the reporting child. */
  readonly senderSessionId: SessionId
}
```

```ts type-equiv
/** Deployment scheduling policy for accepted child reports. */
type SubagentReportDelivery = 'quiet' | 'next-step'
```

Reporting is the child's own choice, so the manager keeps a separate account of its own: when a resident Activation settles, it delivers one notice to the child's durable direct parent describing how that epoch ended and carrying its final assistant content. That delivery is unconditional for every child whose id a caller received, happens before the ownership release that would let the parent be judged settled, and reaches a resident parent through the same waking-admission accounting as a report. A parent whose own lineage is already tearing down receives it without a wake, because waking a quiescent Agent starts a turn rather than queueing work. Its provenance is a distinct kind so a transcript never presents a runtime account as something the child wrote.

```ts type-equiv
/**
 * Durable attribution for the runtime's own account of a continuable child
 * settling. Deliberately a different kind from
 * {@link SubagentReportMessageSource}: a report is content the child chose,
 * while this message is the manager stating what became of the child, and a
 * transcript that merged them would credit the child with words it never wrote.
 */
interface SubagentSettledMessageSource {
  readonly kind: 'subagent-settled'
  /** A runtime account shown without expanding the row (`notice` context form). */
  readonly form: 'notice'
  /** One-line account of how the child ended. */
  readonly summary: string
  /** Session id of the child that settled. */
  readonly senderSessionId: SessionId
}
```

```ts type-equiv
/** Options for one continuable child's report to its direct parent. */
interface SubagentReportOptions {
  /** Already-resolved parent scheduling policy. */
  readonly delivery: SubagentReportDelivery
  /** Caller cancellation, owning authorization and admission until acceptance. */
  readonly signal: AbortSignal
}
```

The provider participates only in preparing the initial creation spec, where `spawn` and `fork` differ. Its returned spec carries only detached provider-specific creation inputs — today the optional parent-history seed — and no Agent, `AgentHandle`, prompt delivery, result, disposal, or resume operation. Cold resume does not dispatch through a provider at all: the manager folds the generic descriptor, calls `ctx.agents.resume()` through the same activation-owner scope, and submits the waiting turn.

```ts type-equiv
/**
 * What the continuation manager asks a provider for while materializing one
 * continuable child's FIRST activation. The manager has already reserved the
 * durable child identity and owns every later operation, so this request
 * carries only what distinguishes a fresh child from one seeded with parent
 * history.
 */
interface ContinuableCreateRequest {
  /** The reserved durable child session id, for provider diagnostics. */
  readonly sessionId: SessionId
  /** The delegating parent agent whose history a seeding provider reads. */
  readonly parent: Agent
  /**
   * Caller cancellation, which owns preparation only until the manager accepts
   * the initial prompt into the child's inbox.
   */
  readonly signal: AbortSignal
}
```

```ts type-equiv
/**
 * A provider's detached contribution to one continuable child's creation. This
 * is DATA, never a capability: it carries no Agent, `AgentHandle`, prompt
 * delivery, result, disposal, or resume operation, because the continuation
 * manager owns the child's whole lifecycle after preparation.
 */
interface ContinuableCreateSpec {
  /**
   * Completed-turn prefix of the parent's log to seed the child session with,
   * or absent for a fresh child. Same durable contract as
   * `CreateAgentOptions.seed`: contiguous from seq 0, lossless JSON, balanced.
   */
  readonly seed?: readonly SessionEvent[]
}
```

The descriptor (`SubagentDescriptorData` in [descriptor.ts](../../packages/subagent/subagent/src/descriptor.ts)) is a mode-discriminated durable identity for every session-backed subagent. Both modes carry the provider name. A `one-shot` descriptor optionally carries a caller-owned display `label`; a `continuable` descriptor requires the delegation `description` as its durable creation label and additionally snapshots resolved child `agentOptions.provider`/`model` and optional `persona`/`toolFilter` for cold resume. It never snapshots the merge-extensible `AgentOptions` object, so an unrelated extension value cannot break continuation and a later composition input is a deliberate version change. It omits `subagentDepth` (cold resume trusts the persisted header's `delegationDepth` as the monotone floor) and `outputSchema` (one run or Activation's result contract, not durable identity).

A local one-shot provider appends the descriptor inside the child's initial turn before its first request. The continuation manager appends the descriptor after any provider-supplied lineage and before the initial prompt is admitted; `header.seedLength` remains the fork-lineage boundary: resume-time descriptor authority reads the child's own suffix, while the list-serving identity projection folds `subagent/descriptor` last-wins so the child's own descriptor overrides a fork-seeded ancestor's. The event is log-only: no `surfaceOp`, never in model history, and retained across compaction by the append-only log. Malformed current-version descriptors are corrupt; unsupported versions cannot be classified by this runtime.

## Durable enumeration: `listChildren()`, `listDescendants()`, and their entries

`SubagentRuntime.listChildren(parentSessionId)` enumerates the parent's direct session-backed subagents from the live-preferred merge of `ctx.sessions.list()` and optional `ctx.sessionPersistence.list()` — no query service, and no Agent is loaded or resumed. Candidates are the direct children whose durable header carries `origin: 'subagent'`; the marker classifies enumeration and coarse generic-route denial but cannot establish a valid descriptor, resumability, or authorization — the projection fold owns identity, and the Activation contract owns resume. Each row's `mode`/`label` is the registered `subagent` projection unit's value, served through a three-rung ladder: the registry's watermark cache for a live child (zero log reads); the optional projection checkpoint cache for a cold one (`cachedSnapshot` — an identity passing the own-suffix seq gate is final, because an own descriptor is immutable once appended); otherwise one `persistence.inspect()` reading folded through the registry (bounded concurrency, recomputed per listing). The cache is a pure optional accelerator: absent, serving the `null` sentinel or missing the key, failing the seq gate, or faulting, it falls silently through to the authoritative refold. The fold is `subagent/descriptor` last-wins with no failure channel: the child's own descriptor overrides a fork-seeded ancestor's, and a malformed or unknown-version payload folds to a serializable `null` sentinel, treated as no value. The result is one `SubagentListEntry[]` in `createdAt`-then-id order: a served identity yields a `child` entry with `mode: 'one-shot' | 'continuable'` and `activity: 'running' | 'inactive'`; continuable entries always carry `label`, while one-shot entries carry it only when the start caller supplied presentation metadata. A settled candidate whose fold served no identity yields a `corrupt` diagnostic — missing, malformed, and unknown-version descriptors deliberately undistinguished (`unsupported` remains in the type but is never produced); a running candidate without an identity is omitted (the creation window before its descriptor lands); a failed cold inspection yields one `unavailable` diagnostic retried on the next listing, so one damaged sibling cannot hide healthy children. `hasChildren` marks a direct descendant with durable subagent origin, read from the same merged material. Activity snapshots only whether the logical record is live in `ctx.sessions`, not outcome or resumability. Absent persistence, enumeration is live-only rather than an error — a cold child cannot be resumed then either. `listChildren()` throws `SubagentError` with code `SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE` when the `ctx.sessionProjections` registry is absent and `SUBAGENT_CONTROL_SESSION_STORE_UNAVAILABLE` when the session store is, both checked before any read so a deployment with zero children still fails deterministically; the list tool requires `ctx.subagents` and `ctx.agents` at plugin load. A service consumer such as a UI can display both modes and choose an unlabeled one-shot fallback, while the model-facing `list_agents` adapter (the separately loadable `/list-agents` plugin of [dsh-tool-subagent-control](../../packages/subagent/tool-subagent-control)) keeps only continuable entries and refines status through the live Agent registry into its own `running`/`idle`/`ready` vocabulary, whose `ready` names a storage-only child as resumable rather than terminal. Listing does not consult the continuation manager's Activation map, Agent registry, or provider availability; `send_message` remains the authoritative delivery-time operation, and a listed running continuable child may still reject delivery as an ownership conflict. The read-path rationale lives in [the list-identity-projection Agent Note](../../.agents/notes/implemented/architecture/2026-08-06-subagent-list-identity-projection.md).

`SubagentRuntime.listDescendants(rootSessionId)` applies the same live-preferred corpus and projection-backed interpretation to the root's complete descendant tree in stable pre-order. Ordinary sessions and one-shot children remain traversal nodes, so continuable descendants below them are discovered; only `origin: 'subagent'` candidates produce rows. Each returned child or diagnostic adds its position from the enumerated durable header, while a cold inspection revalidates that complete lifecycle before serving identity:

```ts type-equiv
/**
 * One entry of a descendant listing: the interpreted subagent facts plus its
 * position in the complete session tree. `parentId` is the durable direct
 * parent from the enumerated header, and `depth` counts edges from the root.
 */
type SubagentDescendantListEntry = SubagentListEntry & {
  /** Durable direct parent of this candidate in the enumerated tree. */
  readonly parentId: SessionId
  /** Edge distance from the requested root; direct children are `1`. */
  readonly depth: number
}
```


## The terminal result: `SubagentResult`

The outcome of a one-shot run, resolved by `SubagentRun.result`. `structured` is present only after a requested `outputSchema` was successfully satisfied; requesting a schema does not guarantee it, and a provider may return `stopReason: 'error'` when the child fails or finishes without a valid capture. A provider may attach a safe, non-assistant `diagnostic` to a non-`completed` result; the provider removes tool inputs, file contents, environment values, credentials, and raw protocol payloads and limits the complete value to 4096 UTF-8 bytes before consumers present it separately from `output`. A non-`completed` `stopReason` means `output` may be partial — the consumer maps it to an `isError` tool result rather than reporting partial output as success.

```ts type-equiv
/**
 * The terminal outcome of a subagent run, resolved by {@link SubagentRun.result}.
 */
interface SubagentResult {
  /**
   * The child's final assistant output is the content of its last non-empty
   * assistant message. Empty-content messages, including usage-only messages,
   * are skipped. Without a non-empty message, the output is its accumulated
   * assistant text stream, or `[]` when the child produced neither.
   */
  readonly output: ContentBlock[]
  /**
   * The structured result after a requested `outputSchema` was successfully
   * satisfied. Requesting a schema does not guarantee presence: a provider can
   * end with `stopReason: 'error'` when the child fails or finishes without a
   * valid capture. The structured value is validated against the requested
   * output schema by the provider; `unknown` here because the seam is
   * schema-agnostic.
   */
  readonly structured?: unknown
  /**
   * Provider-authored, non-assistant failure detail for a non-`completed`
   * result. Providers keep this text free of tool inputs, file contents,
   * environment values, credentials, and raw protocol payloads, and limit it
   * to 4096 UTF-8 bytes. Consumers present it separately from {@link output}.
   */
  readonly diagnostic?: string
  /** Why the run ended. A non-`completed` reason means `output` may be partial. */
  readonly stopReason: SubagentStopReason
}
```

`SubagentStopReason` is a [merge-extensible derived union](core.md#the-map--derived-union-pattern) — a backend may add variants, so consumers branch on the known cases and treat an unknown terminal reason as a failure:

```ts type-equiv
/**
 * Why a subagent run ended. Merge-extensible (a backend may add variants);
 * consumers branch on the known cases and fall through `default`. The known
 * cases mirror the harness turn-end vocabulary so the tool layer can map a
 * non-`completed` result to an `isError` tool result.
 */
interface SubagentStopReasonMap {
  /** The child finished its turn normally. */
  completed: 'completed'
  /** Cancelled through the request signal or disposal. */
  aborted: 'aborted'
  /** Model or transport failure. */
  error: 'error'
  /** The child hit its token ceiling before finishing. */
  'max-tokens': 'max-tokens'
  /** The child declined the task. */
  refusal: 'refusal'
}
```

## A one-shot run: `SubagentRun`

`SubagentRun` is the consumer-owned handle for a published one-shot child — one disposable foreground delegation with one result, never a durable child handle. Prompt submission, turn work, and infrastructure faults after publication belong to `result`. Consumers await that result and always dispose the run to reach quiescence. Child failures resolve with a non-completed stop reason; only unrepresentable infrastructure faults reject. A run has no steering and no resume: continuable conversations have no run at all, because the continuation manager holds their `AgentHandle` directly and orders every turn through the child's own inbox.

```ts type-equiv
/**
 * ONE-SHOT child handle returned after publication. Prompt submission, turn
 * work, and infrastructure faults after that boundary belong to {@link result}.
 * Consumers await that result and must always {@link dispose} to cancel
 * remaining work and reach quiescence. A run is one disposable foreground
 * delegation with one result; continuable conversations have no run — the
 * continuation manager holds their `AgentHandle` directly and orders every
 * turn through the child's own inbox.
 */
interface SubagentRun {
  /**
   * Parent-scoped run id. For a local run, this MUST equal the published child
   * session id, whose `parentSession` records `request.parent.session.id`; a
   * remote provider mints an id unique in the parent namespace.
   */
  readonly id: SessionId
  /**
   * The exact published in-process child, or `undefined` for a remote run.
   * When present, its id is {@link id}; the provider retains no ownership
   * implication beyond the run's ordinary {@link dispose} contract.
   */
  readonly localAgent: Agent | undefined
  /**
   * Resolves with the child's terminal {@link SubagentResult} when the run
   * settles. Does NOT reject on a child-level failure — a model/transport
   * failure resolves with `stopReason: 'error'` so the consumer maps it to an
   * `isError` tool result. Rejects on an infrastructure fault the seam cannot
   * represent as a stop reason.
   */
  readonly result: Promise<SubagentResult>
  /**
   * Cancel remaining work, reach child quiescence, and release resources.
   * Idempotent.
   */
  dispose(): Promise<void>
}
```

A local one-shot run MUST publish an ordinary child agent/session before `start()` fulfills, return that child session id as `SubagentRun.id`, expose the exact child as `localAgent`, record `request.parent.session.id` in the child's `parentSession` header, and append the resolved descriptor inside the child's initial turn before its first request. Runtime ownership may place the child under the parent, provider, or root scope. A remote provider instead returns a parent-scoped lifecycle id and `localAgent: undefined`; without a local child Session, it is absent from durable enumeration.

## The provider contract: `SubagentProvider`

Each provider is a named child-agent transport, and multiple providers may coexist. The service validates requested start-time capabilities before `start()`, and rejects a continuable start on a provider without `prepareContinuable`. `inheritsParentContext` describes only conversation seeding (`fork`: true; `spawn` and `acp`: false), allowing consumers to generate accurate model-facing wording without implying inherited tools, services, or authority.

```ts type-equiv
/**
 * One registered transport for running child agents. Providers are trusted
 * same-process implementations; callers treat descriptors and returned values
 * as borrowed immutable data. The service may call one provider concurrently
 * for distinct children. Providers isolate operation-local mutable state; a
 * shared capacity controller may delay an operation but must not couple its
 * settlement or cleanup to a sibling.
 */
interface SubagentProvider {
  /** Unique registry name (e.g. `spawn`, `fork`, `acp`). */
  readonly name: string
  /** The start-time features this provider supports (see {@link SubagentCapabilities}). */
  readonly capabilities: SubagentCapabilities
  /**
   * Whether the child sees the parent's completed-turn prefix. This is descriptive, not a
   * service-validated start capability: the model-facing tool derives truthful wording from it.
   * It says nothing about tool registration, injected services, or authority inheritance.
   */
  readonly inheritsParentContext: boolean
  /**
   * Establish a ONE-SHOT child and return its handle after publication.
   * The service has already validated that every requested start-time
   * capability is supported and resolved `request.descriptor`, so a
   * session-backed implementation appends that descriptor inside the child's
   * initial turn. Before fulfillment, the provider owns setup and cleans any
   * unpublished partial resources before rejecting. Ownership transfers on
   * fulfillment; subsequent turn or infrastructure failure settles through
   * the returned run. Distinct starts may overlap; cancellation, failure,
   * result settlement, and disposal remain independent for each run.
   */
  start(request: ResolvedSubagentStartRequest): Promise<SubagentRun>
  /**
   * OPTIONAL (continuable-creation capability): contribute the detached
   * creation inputs that distinguish this provider's continuable children —
   * only whether the child session is seeded with parent history. Method
   * presence IS the capability: the service rejects continuable starts on
   * providers without it, while a provider that has it may still serve
   * ordinary one-shot delegations.
   *
   * This is the provider's ONLY participation in a continuable child. The
   * continuation manager owns identity reservation, composition, Agent
   * creation, prompt delivery, cold resume, ownership, and disposal, so a
   * provider never sees the child's Agent, handle, turns, or teardown.
   * Distinct preparations may overlap; each follows its own signal and returns
   * data belonging only to `request.sessionId`.
   */
  prepareContinuable?(request: ContinuableCreateRequest): Promise<ContinuableCreateSpec>
}
```

Provider `start()` fulfills with a published run. The service mints a unique `runId`, snapshots `local` from the provider's exact `localAgent`, observes the result, emits `subagent/start`, and returns the same run; a `start()` rejection implies cleanup of unpublished resources and emits no lifecycle pair, while a post-publication result rejection closes the emitted pair. Each continuable Activation emits the same observe-only pair for its residency epoch, so a cold resume is a new epoch with its own `runId`. The paired `subagent/end` carries the same identity and the final output or infrastructure failure. Both events are observe-only and contain listener exceptions. Their `provider` field names the provider that started the run or Activation epoch; it does not claim that the provider remains registered when the edge is emitted.

## In-process backends: depth and seed

The spawn and fork backends create an ordinary one-shot agent through `parent.ctx`, pass cancellation into core creation, and dispose through `AgentHandle`; a continuable child is instead created by the continuation manager through its own activation-owner scope. Provider removal blocks new starts without revoking accepted runs. Each child gets a new flat scope rather than inheriting parent registrations. Depth and fork seeding reuse existing agent and session vocabulary:

- **Delegation depth** is durable `SessionHeader.delegationDepth` plus the merge-extensible runtime field `AgentOptions.subagentDepth`; absence means top-level depth zero, and the greater present value is authoritative. The seam owns both fields — the loop neither sets nor reads them — so an in-process child persists parent depth + 1, cold resume cannot lower it, and every start rejects a derived depth outside the safe-integer domain or above a defined absolute `request.maxDepth` cap.
- **Fork seeding** uses [`CreateAgentOptions.seed`](core.md#creation-and-ownership) (a `SessionEvent[]` prefix threaded through `AgentLoop.createAgent` → `ctx.sessions.prepare({ seed })`, the same primitive `ctx.agents.resume()` uses). The fork backend passes a *balanced completed-turn prefix* of the parent's log — the parent's events up to and including its last `turn/end` — so the seed is contiguous-from-0 and the [invariants](../../packages/runtime-diagnostics/invariants) replay accepts it (the in-flight, unbalanced turn is excluded).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsubagents--subagentruntime"></a>

### `ctx.subagents` — `SubagentRuntime`

Named provider registry with one-shot runs, durable discovery, and continuable-child operations.

```ts cordis-catalog
/**
 * Establish one durable continuable child and deliver its initial prompt.
 * Resolves when the child's inbox accepts that prompt, without waiting for the
 * turn to start or for the message to reach the Session log; any earlier
 * failure rejects with no ids and rolls back the child entirely.
 * @param spec - provider, delegation request, and caller cancellation.
 * @returns the durable child id and the accepted prompt's message id.
 * @throws when continuation services are unavailable or materialization fails.
 */
async startContinuable(spec: ContinuableStartSpec): Promise<ContinuableStart>

/**
 * Deliver one later message to a continuable child as its next FIFO turn. A
 * resident child's Agent inbox accepts it directly (waking a `waiting`
 * Activation), while an absent one is cold-resumed from its persisted
 * Session. The Agent inbox is the only queue, so every accepted message has
 * one observable order.
 * @param parent - the exact live direct parent authorizing this delivery.
 * @param childId - durable child session id.
 * @param content - user-role content to deliver.
 * @param options - the message source fields and caller cancellation, which stops the
 *   operation only before inbox acceptance.
 * @returns the accepted message's inbox id.
 * @throws when continuation services are unavailable, parent authority is
 *   rejected, or the message was not admitted.
 */
async followup( parent: Agent, childId: SessionId, content: ContentBlock[], options: SubagentFollowupOptions, ): Promise<MessageId>

/**
 * Interrupt one live continuable child's current turn under a human parent
 * address or an exact live ancestor Agent. Fire-and-return: the cancel
 * signal is issued before this returns, but the target may keep running
 * until it observes the signal. Unclaimed pending inbox work, the Activation,
 * and published descendants are preserved; claimed work is not requeued.
 * Once the interrupted driver is idle, a waking send resumes the parked FIFO
 * queue. An absent target — including a one-shot or unknown id —
 * is an accepted no-op, as is a manager-less composition, which cannot own a
 * live Activation.
 * @param targetSessionId - the durable child session id to interrupt.
 * @param authority - the human parent address or exact live ancestor Agent.
 * @throws {SubagentError} `UNAUTHORIZED` when the authority does not own the
 *   live target.
 */
interrupt(targetSessionId: SessionId, authority: SubagentInterruptAuthority): void

/**
 * Deliver selected content from one live continuable child to its durable
 * direct parent. The child is the authority credential; callers cannot name a
 * recipient. Reporting does not conclude the child's turn or Activation.
 * @param child - exact live reporting child.
 * @param content - selected model-facing content.
 * @param options - parent scheduling and pre-acceptance cancellation.
 * @returns the stable identity of the parent-accepted message.
 * @throws when continuation services are unavailable, sender authorization
 *   fails, or the direct parent is not live.
 */
async reportFrom( child: Agent, content: ContentBlock[], options: SubagentReportOptions, ): Promise<MessageId>

/**
 * Compose one deployment capability into every continuable child's
 * unpublished creation context on fresh creation and cold resume. Grants wait
 * for the next Activation; removing the contribution revokes every resident
 * installation immediately.
 * @param contribution - synchronous child-scope installer.
 * @returns the exact Cordis effect disposer.
 */
registerContinuableSetup(contribution: ContinuableSetupContribution): () => void

/**
 * Close continuable admission below exact live parent Agents, stop only their
 * visible descendant Activations synchronously, then await admitted scoped
 * materializations and release those forests child-first. The scoped cutoff
 * lasts until each exact parent leaves the registry; unrelated parent trees
 * remain live.
 * @param parents - exact host-owned parent Agents entering teardown.
 * @returns once every retained descendant Activation released its `AgentHandle`.
 * @throws an aggregate error after all branches settle when any failed.
 */
async drainContinuableDescendants(parents: readonly Agent[]): Promise<void>

/**
 * Release selected resident continuable direct children of one exact live
 * parent. Other children of the same parent remain admitted and resident.
 * Absent targets and a manager-less composition are accepted no-ops.
 * @param parent - exact live direct parent authorizing the selected release.
 * @param childIds - durable direct-child ids to release when resident.
 * @returns once every selected Activation released its `AgentHandle`.
 * @throws {SubagentError} `UNAUTHORIZED` when a resident target belongs to a
 *   different parent or the supplied parent identity is stale.
 */
async drainContinuableChildren(parent: Agent, childIds: readonly SessionId[]): Promise<void>

/**
 * Enumerate the parent's direct session-backed subagents without loading or
 * resuming an Agent and without any query service: the listing merges the live
 * session store with optional session persistence (live-preferred) and
 * serves each child's durable mode/label from the registered `subagent`
 * projection unit down a three-rung ladder — the registry's watermark
 * snapshot for a live child; for a cold one, a durable projection-cache
 * row when the optional cache serves an own-suffix identity (its `seq`
 * gate proves the value postdates the fork seed, where a child's own
 * descriptor is immutable once appended), else one persistence inspection
 * folded through the registry. The
 * projection fold is the single classification authority; per-child
 * diagnostics relay a fold that served no identity or a failed inspection,
 * never a list-time descriptor parse. Absent persistence, enumeration is
 * live-only (a cold child cannot be resumed then either, so its absence is
 * capability absence, not an error). This service consults no Agent
 * registrations, Activations, or providers.
 *
 * Every persistence read receives `signal`, and the listing rechecks
 * cancellation around each of those awaits. Read rejections that settle
 * after an abort become a stable `SubagentError` with code `CANCELLED`.
 * @param parentSessionId - parent session whose direct children are listed.
 * @param signal - caller-owned cancellation forwarded to persistence reads
 *   and observed around every read await.
 * @returns children and per-child diagnostics ordered by `createdAt`, then id.
 * @throws {@link SubagentError} when the projection registry or the session
 *   store is not mounted, or the caller cancels the listing.
 */
listChildren(parentSessionId: SessionId, signal?: AbortSignal): Promise<SubagentListEntry[]>

/**
 * Enumerate the root's complete session-backed subagent tree in stable
 * pre-order from one live-preferred corpus, without loading or resuming an
 * Agent. Ordinary sessions and one-shot children remain traversal nodes so
 * continuable descendants below them are discovered; each returned entry
 * adds its durable `parentId` and root-relative `depth`. Identity resolution,
 * diagnostics, optional persistence, and cancellation follow the same
 * projection-backed contract as {@link listChildren}.
 * @param rootSessionId - session whose complete descendant tree is listed.
 * @param signal - caller-owned cancellation forwarded to persistence reads
 *   and observed around every read await.
 * @returns children and per-candidate diagnostics with tree position, in
 *   stable pre-order.
 * @throws {@link SubagentError} under the same conditions as {@link listChildren}.
 */
listDescendants(rootSessionId: SessionId, signal?: AbortSignal): Promise<SubagentDescendantListEntry[]>

/**
 * Register a provider under its name. Registration is effect-scoped and HMR
 * safe; removing a provider blocks new starts but does not revoke runs that
 * were already returned to their holders.
 * @param provider - the trusted provider implementation.
 * @returns the exact Cordis effect disposer.
 */
registerProvider(provider: SubagentProvider): () => void

/**
 * Look up a provider by name.
 * @param name - the provider name.
 * @returns the provider, or undefined when absent.
 */
getProvider(name: string): SubagentProvider | undefined

/**
 * List registered provider names in insertion order.
 * @returns the registered names.
 */
list(): string[]

/**
 * Establish a published child on the named provider. Capability and semantic
 * checks run before delegation. Provider ownership lasts until its promise
 * fulfills; a rejection therefore has no run for the caller to dispose and
 * emits no run lifecycle events. Post-publication turn and infrastructure
 * failures settle through the returned run.
 * @param name - the provider to use.
 * @param request - child label, prompt, parent, signal, and optional capabilities.
 * @returns the published holder-owned run.
 */
async start(name: string, request: SubagentStartRequest): Promise<SubagentRun>
```

Types: [Agent](core.md) · [ContentBlock](llm-streaming.md) · [MessageId](llm-streaming.md) · [SessionId](core.md)

Source: [`packages/subagent/subagent/src/index.ts:171`](../../packages/subagent/subagent/src/index.ts)

<a id="ctxsupervisor--supervisorservice"></a>

### `ctx.supervisor` — `SupervisorService`

Public Supervisor capability. Providers are registered as Cordis effects.

```ts cordis-catalog
/** Return the singleton controller identity.
 * @returns branded identity.
 */
identity(): SupervisorIdType

/**
 * Rebuild the central projection from the durable controller ledger. Only the
 * singleton-session provider calls this, and only before any live event.
 * @param events - every Supervisor event of the restored controller Session in log order.
 * @returns void.
 */
restoreLedger(events: readonly SupervisorEvent[]): void

/** Return registered project providers in insertion order.
 * @returns registered project providers.
 */
listProjectProviders(): readonly SupervisorProjectProvider[]

/** Return registered routers in insertion order.
 * @returns registered routers.
 */
listRouters(): readonly SupervisorRouter[]

/** Return registered executors in insertion order.
 * @returns registered executors.
 */
listExecutors(): readonly SupervisorExecutor[]

/** Return registered reporters in insertion order.
 * @returns registered reporters.
 */
listReporters(): readonly SupervisorReporter[]

/** Return the current project snapshots in insertion order.
 * @returns detached project snapshots.
 */
listProjects(): readonly SupervisorProjectSnapshot[]

/** Look up one project snapshot.
 * @param id - project identity.
 * @returns the snapshot, or undefined when it is not projected yet.
 */
getProject(id: SupervisorProjectId): SupervisorProjectSnapshot | undefined

/** Return all current task snapshots in insertion order.
 * @returns detached task snapshots.
 */
listTasks(): readonly SupervisorTaskSnapshot[]

/** Look up one task snapshot.
 * @param id - task identity.
 * @returns the snapshot, or undefined when it is not projected yet.
 */
getTask(id: SupervisorTaskId): SupervisorTaskSnapshot | undefined

/** Register a project provider.
 * @param provider - provider to register.
 * @returns disposer.
 */
registerProjectProvider(provider: SupervisorProjectProvider): () => void

/** Register a router.
 * @param router - router to register.
 * @returns disposer.
 */
registerRouter(router: SupervisorRouter): () => void

/** Register an executor.
 * @param executor - executor to register.
 * @returns disposer.
 */
registerExecutor(executor: SupervisorExecutor): () => void

/** Register a reporter.
 * @param reporter - reporter to register.
 * @returns disposer.
 */
registerReporter(reporter: SupervisorReporter): () => void
```

Source: [`packages/supervisor/supervisor/src/index.ts:31`](../../packages/supervisor/supervisor/src/index.ts)

<a id="ctxsupervisorapi--supervisorapiservice"></a>

### `ctx.supervisorApi` — `SupervisorApiService`

Exposes a read-only projection and revision-guarded owner review methods. Hidden reasoning, raw stderr, and project file access are intentionally not part of this service.

```ts cordis-catalog
/** Return the detached dashboard projection for the main assistant.
 * @returns current detached dashboard projection.
 */
status(): SupervisorStatusResponse

/**
 * Return the controller identity used by the transport-agnostic gateway.
 * @returns the current Supervisor identity and durable session reference.
 */
identity(): SupervisorIdentitySnapshot

/**
 * Return detached project snapshots for the dashboard.
 * @returns registered projects.
 */
listProjects(): readonly SupervisorProjectSnapshot[]

/**
 * Return detached task snapshots for the dashboard.
 * @returns current tasks.
 */
listTasks(): readonly SupervisorTaskSnapshot[]

/**
 * Return currently linked execution runs.
 * @returns linked runs.
 */
listRuns(): readonly SupervisorRunLink[]

/**
 * Return critical notifications for the dashboard.
 * @returns pending notifications.
 */
listNotifications(): readonly SupervisorNotification[]

/**
 * Resolve the read-only child session associated with a task run.
 * @param taskId - task identity.
 * @param runId - optional exact run identity.
 * @returns the child-session link, or undefined when no run matches.
 */
childSession(taskId: string, runId?: string): { taskId: string runId: string sessionId: string parentSessionId: string readOnly: true } | undefined

/**
 * Apply a revision-guarded owner action from the client.
 * @param request - action and optimistic-concurrency revision.
 * @returns an action receipt after the request is accepted.
 */
async action(request: { taskId: string; action: 'approve' | 'reject' | 'rework' | 'pause' | 'continue'; expectedRevision: number; feedback?: string }): Promise<{ taskId: string; revision: number; accepted: true }>

/** Return one detached task and its linked execution runs.
 * @param taskId - exact task id.
 * @returns linked task or undefined.
 */
task(taskId: string): SupervisorApiTask | undefined

/** Apply an owner review to a task after checking its optimistic-concurrency revision.
 * @param taskId - task id.
 * @param revision - client revision.
 * @param outcome - owner review result.
 * @returns updated task.
 */
async review(taskId: string, revision: number, outcome: 'accepted' | 'needs-fix'): Promise<SupervisorTaskSnapshot>
```

Source: [`packages/supervisor/supervisor-api/src/index.ts:16`](../../packages/supervisor/supervisor-api/src/index.ts)

<a id="ctxsupervisorexecutors--supervisorexecutorservice"></a>

### `ctx.supervisorExecutors` — `SupervisorExecutorService`

Registers provider adapters and turns routed work into host-owned runs. Providers must reserve a child identity before dispatch; this keeps the host writer gate active before model or CLI work begins.

```ts cordis-catalog
/**
 * Register one executor adapter using Cordis effect ownership.
 * @param provider - trusted adapter for a model or CLI provider family.
 * @returns disposer that removes new-dispatch visibility.
 */
register(provider: SupervisorExecutorProvider): () => void

/**
 * Return registered executor names in insertion order.
 * @returns executor names.
 */
list(): string[]

/**
 * Look up one registered executor.
 * @param name - executor name.
 * @returns provider, if registered.
 */
get(name: string): SupervisorExecutorProvider | undefined

/**
 * Admit and start one routed child, retaining the exact lease until terminal
 * result and disposal settle. Provider startup failures release the lease.
 * @param request - routed work and caller cancellation.
 * @returns run handle with normalized terminal result.
 */
async dispatch(request: SupervisorExecutionRequest): Promise<SupervisorExecutionHandle>

/**
 * Cancel one exact active run.
 * @param runId - active run identity.
 * @returns whether a run existed.
 */
async cancel(runId: SupervisorExecutionHandle['runId']): Promise<boolean>
```

Source: [`packages/supervisor/supervisor-executor-subagent/src/index.ts:37`](../../packages/supervisor/supervisor-executor-subagent/src/index.ts)

<a id="ctxsupervisorinteraction--supervisorinteractionruntime"></a>

### `ctx.supervisorInteraction` — `SupervisorInteractionRuntime`

Owns human command registration and the process-local notification projection. It never changes project files and never turns a child report into acceptance.

```ts cordis-catalog
/**
 * Accept one mention from another conversation. A message id is committed
 * before delivery, so retries cannot send the same intake twice.
 * @param request - source identity, stable message id, and mention text.
 * @returns accepted, queued, or duplicate delivery observation.
 */
receiveIntake(request: SupervisorIntakeRequest): SupervisorIntakeResult

/**
 * Return coalesced critical notifications in first-seen order.
 * @returns notifications.
 */
listNotifications(): readonly SupervisorInteractionNotification[]

/**
 * Return notifications not acknowledged by this runtime instance.
 * @returns unread notifications.
 */
listUnreadNotifications(): readonly SupervisorInteractionNotification[]

/**
 * Mark a notification key read for this process. The durable Supervisor
 * event remains unchanged; a later projection can restore its unread fact.
 * @param id - notification id to acknowledge.
 * @returns whether a notification was found.
 */
acknowledge(id: string): boolean

/**
 * Register a listener for coalesced critical notifications.
 * @param listener - receives each notification.
 * @returns disposer.
 */
onNotification(listener: (notification: SupervisorInteractionNotification) => void): () => void

/**
 * Return a bounded status view for the main assistant and UI.
 * @returns status view.
 */
status(): SupervisorStatusView

/**
 * Handle one emitted durable critical notification.
 * @param event - notification event.
 */
handleNotification(event: { readonly snapshot: SupervisorNotification }): void

/** Dispose local listeners and reject future external intake. */
dispose(): void
```

Source: [`packages/supervisor/tool-supervisor/src/index.ts:61`](../../packages/supervisor/tool-supervisor/src/index.ts)

<a id="ctxsupervisormemory--supervisormemoryservice"></a>

### `ctx.supervisorMemory` — `SupervisorMemoryService`

Runtime service holding live raw records and read-only derived memory.

```ts cordis-catalog
/** Append one event to the raw in-memory log; persistence is owned by the session layer.
 * @param event - validated Supervisor event.
 * @param seq - next contiguous memory sequence, or the implicit next sequence.
 * @returns void.
 */
append(event: SupervisorEvent, seq?: number): void

/** Replace one project's current governance read; no project file is written.
 * @param item - current project governance state.
 * @returns void.
 */
setGovernance(item: SupervisorGovernanceMemory): void

/** Return a detached copy of the raw log for a persistence/checkpoint adapter.
 * @returns raw records in sequence order.
 */
rawRecords(): readonly SupervisorMemoryRecord[]

/** Build the current structured projection.
 * @returns authoritative folded projection.
 */
project(): SupervisorMemoryProjection

/** Build current rolling summaries from the authoritative event projection.
 * @param now - timestamp used for generated summaries.
 * @returns bounded rolling summaries.
 */
summaries(now: string = new Date().toISOString()): readonly SupervisorRollingSummary[]

/** Build a bounded brief for one main-assistant question.
 * @param question - question being answered.
 * @returns a bounded query brief.
 */
brief(question: string): SupervisorQueryBrief
```

Source: [`packages/supervisor/supervisor-memory/src/index.ts:266`](../../packages/supervisor/supervisor-memory/src/index.ts)

<a id="ctxsupervisororchestrator--supervisororchestratorservice"></a>

### `ctx.supervisorOrchestrator` — `SupervisorOrchestratorService`

Captures main-assistant requests, obtains policy decisions, and drives child execution through one bounded repair loop. It never edits project files or claims owner acceptance.

```ts cordis-catalog
/**
 * Return current task snapshots in capture order.
 * @returns task snapshots.
 */
listTasks(): readonly SupervisorTaskSnapshot[]

/**
 * Look up one task snapshot.
 * @param taskId - task identity.
 * @returns task or undefined.
 */
getTask(taskId: SupervisorTaskId): SupervisorTaskSnapshot | undefined

/**
 * Return approval groups awaiting one owner decision.
 * @returns pending approval batches.
 */
listApprovalBatches(): readonly SupervisorApprovalBatch[]

/**
 * Register a critical-notification listener.
 * @param listener - receives each notification once.
 * @returns disposer.
 */
onNotification(listener: SupervisorNotificationListener): () => void

/**
 * Capture and classify one request. Approval-required routes are grouped into
 * one batch; only policy-approved low-risk routes can auto-dispatch.
 * @param request - user request and execution context.
 * @returns task, route and optional approval batch.
 */
async capture(request: SupervisorCaptureRequest): Promise<SupervisorCaptureResult>

/**
 * Approve all tasks in a batch atomically with respect to each task revision.
 * A denied route remains non-dispatchable even after an owner response.
 * @param batchId - approval group identity.
 * @param expectedRevisions - optional stale-write guards by task id.
 * @returns dispatches started for approved tasks.
 */
async approve( batchId: string, expectedRevisions: ReadonlyMap<SupervisorTaskId, number> = new Map(), ): Promise<readonly SupervisorDispatchResult[]>

/**
 * Approve the single pending batch containing one task.
 * @param taskId - task identity.
 * @param expectedRevision - revision observed by the owner.
 * @returns the started dispatch, when auto-dispatch is enabled.
 */
async approveTask(taskId: SupervisorTaskId, expectedRevision: number): Promise<SupervisorDispatchResult | undefined>

/**
 * Reject the single pending batch containing one task.
 * @param taskId - task identity.
 * @param expectedRevision - revision observed by the owner.
 */
rejectTask(taskId: SupervisorTaskId, expectedRevision: number): void

/**
 * Reject all tasks in an approval batch.
 * @param batchId - approval group identity.
 * @param expectedRevisions - optional stale-write guards.
 */
reject(batchId: string, expectedRevisions: ReadonlyMap<SupervisorTaskId, number> = new Map()): void

/**
 * Dispatch a ready task and observe its terminal result asynchronously.
 * @param taskId - task identity.
 * @param expectedRevision - optional optimistic-concurrency guard.
 * @returns child run identity and running task snapshot.
 */
async dispatch(taskId: SupervisorTaskId, expectedRevision?: number): Promise<SupervisorDispatchResult>

/**
 * Wait for one active or completed run.
 * @param runId - exact run identity.
 * @returns terminal execution result.
 */
async wait(runId: ReturnType<typeof SupervisorRunId>): Promise<SupervisorRunResult>

/**
 * Apply an owner follow-up only to the revision the owner viewed.
 * @param request - revision-safe follow-up.
 * @returns the started repair dispatch.
 */
async followUp(request: SupervisorFollowUpRequest): Promise<SupervisorDispatchResult>

/** Record the owner's review without inferring acceptance from execution output.
 * @param taskId - exact task identity.
 * @param expectedRevision - revision shown by the owner.
 * @param outcome - explicit owner decision.
 * @returns the updated task snapshot.
 */
review(taskId: SupervisorTaskId, expectedRevision: number, outcome: 'accepted' | 'needs-fix'): SupervisorTaskSnapshot

/**
 * Cancel one exact run without touching peer projects.
 * @param taskId - task to interrupt.
 */
async interrupt(taskId: SupervisorTaskId): Promise<void>
```

Source: [`packages/supervisor/supervisor-orchestrator/src/index.ts:64`](../../packages/supervisor/supervisor-orchestrator/src/index.ts)

<a id="ctxsupervisorprojecthost--supervisorprojecthostservice"></a>

### `ctx.supervisorProjectHost` — `SupervisorProjectHostService`

Owns hidden Sessions for explicitly registered projects. The service never invokes a model or starts a subagent; the executor bridge acquires a lease before it creates its child, attaches exact child ownership, and releases it after the child settles. This makes the project writer lock cover admission, execution, cancellation, and teardown rather than a task-label convention.

```ts cordis-catalog
/**
 * Return a detached hidden-host description, if it is currently resident.
 * @param projectId - registered project identity.
 * @returns resident host metadata, if present.
 */
getHost(projectId: SupervisorProjectId): SupervisorProjectHostSnapshot | undefined

/**
 * Create or restore the exact hidden host for a registered project.
 * @param projectId - registered project identity.
 * @returns durable host metadata after publication.
 */
async ensureHost(projectId: SupervisorProjectId): Promise<SupervisorProjectHostSnapshot>

/**
 * Reserve a project execution slot before starting its child. A read-only
 * reviewer can coexist with a writer, but a second writer is rejected until
 * the first exact lease releases.
 * @param request - project, task, child, executor and permission facts.
 * @returns a lease that owns exactly one admitted child lifecycle.
 */
async admit(request: SupervisorRunAdmissionRequest): Promise<SupervisorRunLease>

/**
 * Reconcile durable links supplied by the central projection after restart.
 * A link with a live child reclaims its writer lock; an uncertain writer is
 * deliberately refused, so the orchestrator cannot repeat unsafe work.
 * @param recoveries - central-projection observations for previously linked runs.
 * @returns leases for recovered live children; the provider attaches each exact lifecycle so settlement can release its gate.
 */
async reconcile(recoveries: readonly SupervisorRunRecovery[]): Promise<readonly SupervisorRunLease[]>
```

Source: [`packages/supervisor/supervisor-project-host/src/index.ts:69`](../../packages/supervisor/supervisor-project-host/src/index.ts)

<a id="ctxsupervisorprojectregistry--supervisorprojectregistry"></a>

### `ctx.supervisorProjectRegistry` — `SupervisorProjectRegistry`

Registry for explicit project enrollment. Discovery accepts only caller supplied roots and performs metadata-only reads. Enrollment canonicalizes through `realpath`, emits one versioned project snapshot, and never changes project files or creates an execution session.

```ts cordis-catalog
/**
 * Return currently enrolled projects, excluding removed records.
 * @returns enrolled project snapshots.
 */
list(): readonly RegisteredProject[]

/**
 * Look up one enrolled project by opaque id.
 * @param id - project identity.
 * @returns the project, or undefined.
 */
get(id: SupervisorProjectId): RegisteredProject | undefined

/**
 * Enumerate immediate children of explicit roots. The method never reads file
 * contents, writes a Packet, or enrolls a candidate; callers must confirm
 * one result through {@link registerProject}.
 * @param options - explicit roots, item bound, and optional cancellation.
 * @returns metadata-only candidates in deterministic path order.
 */
async suggestProjects(options: ProjectDiscoveryOptions): Promise<readonly ProjectCandidate[]>

/**
 * Enroll an existing directory after user confirmation. Canonical realpaths
 * make symlink and junction aliases idempotent; a missing or non-directory
 * path fails without publishing state.
 * @param path - user-confirmed directory path.
 * @param displayName - optional label; defaults to the canonical basename.
 * @returns the committed project snapshot.
 */
async registerProject(path: string, displayName?: string): Promise<RegisteredProject>

/**
 * Re-check registered paths and publish `unavailable` only after a definite
 * disappearance. Other I/O failures propagate so permission faults are not
 * mistaken for missing projects.
 * @returns the refreshed project snapshots.
 */
async refreshStatuses(): Promise<readonly RegisteredProject[]>

/**
 * Remove only the central enrollment relation. Project files, directories,
 * sessions, and any governance records remain untouched; repeated removal is
 * an idempotent false result.
 * @param id - project identity to remove.
 * @returns a promise resolving to true when an active registration was removed.
 */
async removeProject(id: SupervisorProjectId): Promise<boolean>
```

Source: [`packages/supervisor/supervisor-project-registry/src/index.ts:67`](../../packages/supervisor/supervisor-project-registry/src/index.ts)

<a id="ctxsupervisorsession--supervisorsessionservice"></a>

### `ctx.supervisorSession` — `SupervisorSessionService`

Owns the one controller Session. It never creates project Sessions or executes an Agent. Durable identity is flushed before the settings id is committed, so a restart can always choose between a valid log and first boot.

Source: [`packages/supervisor/supervisor-session/src/index.ts:61`](../../packages/supervisor/supervisor-session/src/index.ts)

<a id="subagent-events"></a>

### `subagent/*` events

<a id="subagentend--emit"></a>

#### `subagent/end` — emit

A published child settled. Scope-filtered dispatch uses the same delegating parent carrier as `subagent/start`, so the lifecycle pair reaches the same scoped audience.

```ts cordis-catalog
/**
 * A published child settled. Scope-filtered dispatch uses the same delegating
 * parent carrier as `subagent/start`, so the lifecycle pair reaches the
 * same scoped audience.
 * @param info - the run identity and terminal outcome.
 * @dshScopeScan unsupported
 * @mode emit
 */
'subagent/end'(this: Scoped<SubagentRuntime>, info: SubagentRunEndInfo): void
```

Types: [Scoped](scope.md)

Source: [`packages/subagent/subagent/src/index.ts:166`](../../packages/subagent/subagent/src/index.ts)

<a id="subagentprovider-added--emit"></a>

#### `subagent/provider-added` — emit

A provider became resolvable in the registry.

```ts cordis-catalog
/**
 * A provider became resolvable in the registry.
 * @param provider - the registered provider.
 * @mode emit
 */
'subagent/provider-added'(provider: SubagentProvider): void
```

Source: [`packages/subagent/subagent/src/index.ts:140`](../../packages/subagent/subagent/src/index.ts)

<a id="subagentprovider-removed--emit"></a>

#### `subagent/provider-removed` — emit

A provider left the registry. Accepted runs remain holder-owned.

```ts cordis-catalog
/**
 * A provider left the registry. Accepted runs remain holder-owned.
 * @param name - the provider name that no longer resolves.
 * @mode emit
 */
'subagent/provider-removed'(name: string): void
```

Source: [`packages/subagent/subagent/src/index.ts:146`](../../packages/subagent/subagent/src/index.ts)

<a id="subagentstart--emit"></a>

#### `subagent/start` — emit

A provider established a published child. For in-process providers, `ctx.agents.get(info.id)` resolves during this notification. Scope-filtered dispatch keys the carrier by the delegating parent, so a parent-scoped listener observes only its own delegations. Paired with `subagent/end`.

```ts cordis-catalog
/**
 * A provider established a published child. For in-process providers,
 * `ctx.agents.get(info.id)` resolves during this notification.
 * Scope-filtered dispatch keys the carrier by the delegating parent, so a
 * parent-scoped listener observes only its own delegations. Paired with
 * `subagent/end`.
 * @param info - the provider and published child identity.
 * @dshScopeScan unsupported
 * @mode emit
 */
'subagent/start'(this: Scoped<SubagentRuntime>, info: SubagentRunInfo): void
```

Types: [Scoped](scope.md)

Source: [`packages/subagent/subagent/src/index.ts:157`](../../packages/subagent/subagent/src/index.ts)

<a id="supervisor-events"></a>

### `supervisor/*` events

<a id="supervisoridentity--emit"></a>

#### `supervisor/identity` — emit

Emitted when the singleton controller identity is created or restored.

```ts cordis-catalog
/** Emitted when the singleton controller identity is created or restored.
 * @mode emit
 * @param event - versioned controller identity event.
 */
'supervisor/identity'(event: SupervisorIdentityEvent): void
```

Source: [`packages/supervisor/supervisor/src/events.ts:89`](../../packages/supervisor/supervisor/src/events.ts)

<a id="supervisornotification--emit"></a>

#### `supervisor/notification` — emit

Emitted when a user-facing Supervisor notification is created or updated.

```ts cordis-catalog
/** Emitted when a user-facing Supervisor notification is created or updated.
 * @mode emit
 * @param event - versioned user-facing notification.
 */
'supervisor/notification'(event: SupervisorNotificationEvent): void
```

Source: [`packages/supervisor/supervisor/src/events.ts:114`](../../packages/supervisor/supervisor/src/events.ts)

<a id="supervisorpolicy-applied--emit"></a>

#### `supervisor/policy-applied` — emit

Emitted when a routing policy decision is recorded for a task.

```ts cordis-catalog
/** Emitted when a routing policy decision is recorded for a task.
 * @mode emit
 * @param event - versioned applied routing policy evidence.
 */
'supervisor/policy-applied'(event: SupervisorPolicyAppliedEvent): void
```

Source: [`packages/supervisor/supervisor/src/events.ts:109`](../../packages/supervisor/supervisor/src/events.ts)

<a id="supervisorproject--emit"></a>

#### `supervisor/project` — emit

Emitted when a registered project snapshot changes.

```ts cordis-catalog
/** Emitted when a registered project snapshot changes.
 * @mode emit
 * @param event - versioned project event.
 */
'supervisor/project'(event: SupervisorProjectEvent): void
```

Source: [`packages/supervisor/supervisor/src/events.ts:94`](../../packages/supervisor/supervisor/src/events.ts)

<a id="supervisorrun-linked--emit"></a>

#### `supervisor/run-linked` — emit

Emitted when a task is linked to its host and child execution sessions.

```ts cordis-catalog
/** Emitted when a task is linked to its host and child execution sessions.
 * @mode emit
 * @param event - versioned task execution association.
 */
'supervisor/run-linked'(event: SupervisorRunLinkedEvent): void
```

Source: [`packages/supervisor/supervisor/src/events.ts:104`](../../packages/supervisor/supervisor/src/events.ts)

<a id="supervisortask--emit"></a>

#### `supervisor/task` — emit

Emitted when a supervised task snapshot changes.

```ts cordis-catalog
/** Emitted when a supervised task snapshot changes.
 * @mode emit
 * @param event - versioned task event.
 */
'supervisor/task'(event: SupervisorTaskEvent): void
```

Source: [`packages/supervisor/supervisor/src/events.ts:99`](../../packages/supervisor/supervisor/src/events.ts)
<!-- END GENERATED cordis-surface -->
