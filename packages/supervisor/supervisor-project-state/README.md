# `@deepseek-ai/dsh-supervisor-project-state`

English | [中文](README.zh.md)

This package is the read-only governance adapter for the Personal Supervisor. It locates one root-level `Docs`/`docs` directory, reads the current Active Packet, Work Order, and a bounded tail of `LOOP_RUNS.jsonl`, then returns a compact project state with provenance and an authority fingerprint.

Reads are bounded and path-contained. A missing packet, duplicate authority file, malformed loop record, missing source, or fingerprint mismatch is reported as a conflict. `refresh()` never writes: later composition packages may add an explicitly authorized atomic writer after the state has passed the conflict gate.

`createSkillHandoff()` returns only a purpose and a load-on-demand source hint for `cms-project-governance` or `agent-loop-engineering`. Skill bodies and hidden reasoning are not copied into project state or the Supervisor prompt.

## Model Experience

### Project state summary

#### What the model sees

The model receives project identity, packet/work-order summaries, recent loop deltas, a fingerprint, and conflict status. It does not receive complete project history by default.

#### Token effect

The adapter returns a bounded recent-loop tail and short fields, so prompt growth is controlled by `recentLoopCount` and `maxFileBytes`.

#### KV Cache effect

The compact field order is stable while the selected authority files and adapter options remain unchanged.

## Known Limitations and Deferred Work

- **No durable writer** — conflict-safe reads are complete here; an authorized bootstrap writer belongs to a later composition layer.
- **Markdown parsing is intentionally narrow** — current-state frontmatter and headings are projected, while arbitrary legacy prose remains source evidence for governance review.
- **No runtime acceptance** — execution reports and Independent QA remain separate authority decisions.
