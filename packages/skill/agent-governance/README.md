# @deepseek-ai/dsh-agent-governance

English | [中文](README.zh.md)

One optional Harness Plugin that distributes governance Skills and coordinates Codex, Claude Code, and a child DeepSeek Harness runtime through `ctx.subagents`.

The plugin mounts the existing filesystem skill provider with an embedded bundled root. Skill catalog summaries remain available through the normal `dsh-tool-skill` flow; full instructions and referenced resources load only when a skill is selected. Project and user skill roots keep their normal precedence and scope behavior.

The runtime provides deterministic recommendations and model-facing `governance_*` tools for listing Agents, routing, approval, delegation, reporting, and acceptance. Routing never grants execution authority: delegation requires a recorded approval, and a child report is not acceptance.

Governance facts are appended as `governance/*` Session Events. Large task packets remain in workspace files and are referenced by the session rather than copied into every prompt. The Plugin does not modify `agent-loop`; Codex and Claude Code use their existing Providers, while DeepSeek Harness uses the existing `subagent-dsh-sdk` process boundary when that Provider is loaded.

## Mount

Add the package to a profile or bundle patch:

```yaml
- id: agent-governance
  name: '@deepseek-ai/dsh-agent-governance'
```

## Model Experience

### Bundled governance and execution skills

#### What the model sees

Three short catalog entries from `dsh-tool-skill`, including `agent-governance-routing`. A selected skill body and its referenced resource guidance appear only after the model loads that skill through the existing `skill` tool.

#### Token effect

The initial catalog adds three descriptions; each loaded body adds its own retained tool-result content. The plugin does not duplicate a body into a second synthetic prompt message.

#### KV Cache effect

The catalog and loaded bodies append model-visible history after the existing reusable prefix. Enabling or disabling this plugin changes the catalog suffix but does not alter unrelated provider behavior.

## Known Limitations and Deferred Work

- The Plugin does not modify `agent-loop`; provider availability still depends on the selected Profile Bundle.
- The bundled resources are versioned with this package; body changes require a package update.
- The filesystem provider may also expose project and user skills when `includeDefaultRoots` remains enabled.
