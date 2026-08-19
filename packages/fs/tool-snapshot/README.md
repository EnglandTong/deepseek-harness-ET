# @deepseek-ai/dsh-tool-snapshot

English | [中文](README.zh.md)

Tool consumer projecting the workspace-snapshot seam (`ctx.snapshots`, [dsh-snapshot](../snapshot/)) onto four model-facing tools: `snapshot_create`, `snapshot_list`, `snapshot_restore`, `snapshot_diff`.

## Tools

| Tool | Presentation | Notes |
|---|---|---|
| `snapshot_create` | generic | One `reason` string; the id comes back for later restore/diff calls |
| `snapshot_list` | generic | Oldest first, with honest partial flags |
| `snapshot_restore` | **diff card** | Computes the pre-restore diff inside `execute` and carries it through `presentationMeta`, so the diff card is a pure function of the canonical value |
| `snapshot_diff` | **diff card** | Per-file hunks with `modified`/`added`/`removed` kinds and the unmanaged-path boundary |

Restore asks for approval through the provider's own approval gate; the tool adds no second gate. The system-prompt section steers the model to snapshot before risky multi-step changes and explains the lazy-capture boundary (files never modified after creation are not recoverable).

## Mounting

```yaml
# cordis.yml — requires ctx.snapshots (e.g. dsh-snapshot-local) on the same runtime
'@deepseek-ai/dsh-tool-snapshot':
  {}
```
