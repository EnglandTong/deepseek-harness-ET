# `@deepseek-ai/dsh-supervisor`

English | [中文](README.zh.md)

The Personal Supervisor service definition owns the typed vocabulary for one controller Session coordinating registered projects. It does not create agents, read project files, route models, or render UI; those concerns are supplied by later packages.

The package exports branded identifiers, revisioned snapshots, the legal task transition function, replay-safe event validation/folding, and the `ctx.supervisor` provider registries. Registrations are Cordis effects and return disposers.

## Status lifecycle

`Captured → Classified → AwaitingApproval | Ready → Dispatched → Running → NeedsOwnerDecision | NeedsFix | ReadyForReview | Failed | Cancelled`. Approval, repair, and review transitions are explicit; an executor report never means `Accepted` without a separate authority action.

## Model Experience

### Supervisor contract

#### What the model sees

The model sees typed `SupervisorService` identities, snapshots, `supervisor/task` events, and legal transitions. This package contributes no project files or production tools; later consumers decide when to load governance context and dispatch an executor.

#### Token effect

Small fixed schema and status vocabulary; project history is loaded by later consumers only when needed.

#### KV Cache effect

Prefix-stable while the contract and event vocabulary remain unchanged.

## Known Limitations and Deferred Work

- **No persistence provider** — WO-02 and WO-09 provide durable Session recovery and projections; this package only defines their shared contract.
- **No executor implementation** — model and CLI selection belongs to the routing and executor packages.
