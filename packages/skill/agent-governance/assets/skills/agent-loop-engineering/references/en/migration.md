# Legacy State Migration 2.1

Legacy projects are supported, but normal execution no longer stays indefinitely in a many-file compatibility mode.

## Bootstrap Rule

When no Active Packet exists:

1. run read-only Legacy Bootstrap;
2. locate Docs case-insensitively;
3. inspect canonical current files and explicit links only;
4. detect authority, route, decision, and delivery-class conflicts;
5. write one packet only when coherent and explicitly invoked with `--write`;
6. preserve all legacy history unchanged.

Conflicts produce exit code 2 and zero writes. Resolve them through governance before execution.

## Legacy Mapping

| Legacy file | 2.1 role |
| --- | --- |
| `TARGET.md` | higher-authority outcome and Non-Goals |
| `ACCEPTANCE.md` | criteria and evidence requirements |
| active `WORK_ORDER*.md` | current scope authority |
| `STATUS.md`, `CMS.md`, role instructions | current-state candidates, not higher authority |
| `NEXT_ACTIONS.md` | candidate next action |
| `PENDING.md` | blockers, decisions, later ideas |
| QA files | preserved decisions; later superseding decision wins but must remain explicit |
| `LOOP_RUNS.jsonl` | append-only evidence; legacy rows are summarized, not rewritten |

## After Migration

- Use Active Packet as the current projection.
- Stop routine writes to duplicate status journals.
- Keep one current Work Order only when it owns stable scope.
- Keep one final independent QA decision for Standard/Full work.
- Archive only at a natural release/month boundary; do not delete history.

If authority fingerprint changes, stop execution and align before refreshing the packet.
