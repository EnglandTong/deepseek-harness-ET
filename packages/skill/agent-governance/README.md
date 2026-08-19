# @deepseek-ai/dsh-agent-governance

English | [中文](README.zh.md)

One Harness Plugin that distributes the complementary `cms-project-governance` and `agent-loop-engineering` skills from ClawHub.

The plugin mounts the existing filesystem skill provider with an embedded bundled root. Skill catalog summaries remain available through the normal `dsh-tool-skill` flow; full instructions and referenced resources load only when a skill is selected. Project and user skill roots keep their normal precedence and scope behavior.

This package provides skill distribution and lifecycle only. It does not modify `agent-loop`, make governance decisions, or store project state inside the plugin. Project state remains in the target workspace's `Docs/ACTIVE_PACKET.md`, work-order files, and loop records as directed by the loaded skills.

## Mount

Add the package to a profile or bundle patch:

```yaml
- id: agent-governance
  name: '@deepseek-ai/dsh-agent-governance'
```

## Model Experience

### Bundled governance and execution skills

#### What the model sees

Two short catalog entries from `dsh-tool-skill`. A selected skill body and its referenced resource guidance appear only after the model loads that skill through the existing `skill` tool.

#### Token effect

The initial catalog adds two descriptions; each loaded body adds its own retained tool-result content. The plugin does not duplicate a body into a second synthetic prompt message.

#### KV Cache effect

The catalog and loaded bodies append model-visible history after the existing reusable prefix. Enabling or disabling this plugin changes the catalog suffix but does not alter unrelated provider behavior.

## Known Limitations and Deferred Work

- The plugin distributes instruction resources; it does not enforce every governance rule at a runtime API boundary.
- The bundled resources are versioned with this package; body changes require a package update.
- The filesystem provider may also expose project and user skills when `includeDefaultRoots` remains enabled.
