# @deepseek-ai/dsh-agent-governance-bundle

English | [中文](README.zh.md)

Optional profile bundle that mounts `@deepseek-ai/dsh-agent-governance` and the existing `subagent-dsh-sdk` Provider without changing the default profile composition. Codex and Claude Code remain independently installable Providers.

## Model Experience

### Mounted governance plugin

#### What the model sees

The mounted plugin contributes three Skill catalog entries and governance tools. The bundle also configures a named `dsh-governance` Harness Provider through `subagent-dsh-sdk`; a child Harness runtime must be available at the configured command and profile.

#### Token effect

The bundle adds no tokens by itself. When mounted, the plugin catalog adds three descriptions and each selected body adds its own retained tool-result content.

#### KV Cache effect

The bundle changes no request prefix directly. Any cache change comes from the mounted plugin's catalog or a selected skill body at their normal session-history insertion points.

## Known Limitations and Deferred Work

- The bundle is opt-in and does not alter shipped default profiles.
- Codex and Claude Code are not pulled into this bundle's dependency closure; install their Provider Bundles when needed.
- The default child command is a development-oriented JSON-RPC Harness runtime path and may need deployment-specific configuration.
