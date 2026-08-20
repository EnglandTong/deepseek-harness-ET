# @deepseek-ai/dsh-agent-governance-bundle

Optional profile bundle that mounts `@deepseek-ai/dsh-agent-governance`. It adds the two ClawHub-derived skills without changing the default profile composition.

## Model Experience

### Mounted governance plugin

#### What the model sees

Nothing directly from the patch layer. The mounted plugin contributes two catalog entries through `dsh-tool-skill`; selected instruction bodies appear only through the normal skill loader.

#### Token effect

The bundle adds no tokens by itself. When mounted, the plugin catalog adds two descriptions and each selected body adds its own retained tool-result content.

#### KV Cache effect

The bundle changes no request prefix directly. Any cache change comes from the mounted plugin's catalog or a selected skill body at their normal session-history insertion points.

## Known Limitations and Deferred Work

- The bundle is opt-in and does not alter shipped default profiles.
- Runtime enforcement remains owned by the Harness services and the loaded skills, not by the patch layer.
