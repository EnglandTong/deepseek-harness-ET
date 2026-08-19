# Agent governance Plugin

`@deepseek-ai/dsh-agent-governance` packages the ClawHub `cms-project-governance` and `agent-loop-engineering` skills as one Harness Plugin. It mounts the existing filesystem skill provider against a package-owned bundled root, so the ordinary skill catalog, scope resolution, on-demand loading, resource guidance, and disposal behavior remain authoritative.

`@deepseek-ai/dsh-agent-governance-bundle` provides an opt-in `cordis.patch.yml` row. The plugin does not change `agent-loop`, make governance decisions, or store project state; the two skills continue to define file-based Active Packet, Work Order, Loop Runs, evidence, and handoff behavior.

Verification includes the package composition test, isolated bundled-root test, TypeScript project builds, workspace constraints, Skill invocation metadata, and direct package publication lint. The full host build remains separately blocked by pre-existing errors in `packages/mcp/mcp-client`.
