# @deepseek-ai/dsh-tool-multiedit

English | [中文](README.zh.md)

Multi-file atomic edit tool consumer: `multi_edit` applies a list of literal edits across files in one call — either every edit applies, or the workspace rolls back to its pre-edit state.

## How atomicity works

The tool does not build a transaction layer. Before applying, it creates a workspace snapshot (`ctx.snapshots.create`, reason `multi_edit rollback point`); on any failure it restores that snapshot with `rollback: true` — the service contract's atomic self-rollback marker that skips the destructive-change approval gate — and then fails loud, reporting which file failed and that the rollback completed. The `snapshot/create` and `snapshot/restore` session events fire exactly as for any snapshot use, keeping the rollback fact replayable from the log.

Per-file edit semantics are the single-file `edit` tool's: literal `old_string` → `new_string` through `ctx.fs.editText`, the `fs/edit-intent` waterfall dispatched per target, and the `fs/observed` version recorded after each edit (so the default fs-observation-policy's read-before-edit gate applies per file — read the files first).

Both the call and the result render as one multi-file diff card; the result's diffs are the provider-reported before/after whole texts carried through `presentationMeta`, so presentation stays a pure function of the canonical value.

## Mounting

```yaml
# cordis.yml — requires ctx.fs and ctx.snapshots (e.g. dsh-snapshot-local) on the same runtime
'@deepseek-ai/dsh-tool-multiedit':
  {}
```
