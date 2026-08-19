# Evidence And Completion 2.1

## Delivery Classes

| Class | What may be claimed | Minimum typical evidence |
| --- | --- | --- |
| `Contract` | schema, type, interface, or agreement exists and validates | parser/type/schema checks |
| `Governance` | authority, decision, or process state is coherent | state validation and decision source |
| `Artifact` | a generated package/file is valid | deterministic inspection and consumer check |
| `Runtime` | behavior works for a user or operator | automatic plus functional evidence |
| `Mixed` | several classes in one packet | every criterion labels its class |

Never promote a lower-class result into a runtime or release claim.

## Evidence Ladder

1. `Declared`: plan, file, code path, or checkbox exists.
2. `Automatic`: focused tests, regression, typecheck, build, lint, schema, or deterministic artifact checks pass.
3. `Functional`: API, CLI, browser, generated-file consumer, operator workflow, or target-environment behavior works.
4. `Independent`: another reviewer reproduces the required evidence from task-local artifacts.

The completion claim cannot exceed the weakest required criterion.

## Evidence Quality

Record what ran, environment, timestamp, exit code/result, artifact path, and material limits. Keep successful output concise and link raw logs. For a failure, preserve the useful tail and root-cause evidence.

## Ready For Review

Use only when all authorized Must Pass criteria are checked, required automatic and functional evidence pass, regression is appropriate, limits are explicit, alignment holds, and no stop gate is active.

For Standard/Full Layered work, leave `qa_decision: Not Reviewed` and request independent acceptance.

## Accepted With Risk

Use only when the core outcome works and the remaining edge is explicit, non-blocking, owned, and time-bounded. Missing primary flow, required environment, security/data-integrity gate, or final independent evidence is not a risk-qualified pass.

The same material risk carried twice or three consecutive formal `Accepted With Risk` decisions triggers governance review.

## Conflicting Evidence

Use the weaker result:

- build pass plus user-flow fail -> open;
- focused tests pass plus root gate fail -> open;
- screenshot pass plus interaction fail -> open;
- Developer Complete plus independent QA fail -> `Needs Fix`;
- diagnostic shards pass while the authorized full gate is unresolved -> open.

Activity, elapsed time, file count, documentation volume, and checker success alone are not completion evidence.
