---
description: "Remote service installing plugin bundles into the running dsh profile: pnpm add, dsh.profile.bundles reconciliation, and live re-apply through the launcher-provided manager."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-plugin-import

English | [中文](README.zh.md)

## Summary

The web Plugins settings page can add a plugin bundle to the profile the web surface booted from. Calling `pluginImport/import` runs `pnpm add` in the profile directory (a registry name or a `file:`/`link:`/path spec), reconciles `dsh.profile.bundles` exactly as `dsh plugin add` does, and asks the launcher-provided manager to re-apply the fresh bundle layers to the running tree. Calling `pluginImport/listBundles` returns the profile's current layer list with per-bundle resolution. Both methods answer the profile named by the manager's context, which only a surface booted through a dsh profile provides.

## Use this package

The service is Remote-only and is consumed through the [`api-remotes`](../../api/remotes/README.md) assembly as `ctx.remote.pluginImport`; the web bundle composes it for the import tab.

### What an import does

One call performs three ordered steps and reports each: pnpm installs the spec (a non-zero exit or missing pnpm ends the report there), reconciliation joins every dependency that declares `dsh.bundle` to the layer list and drops ones that no longer do, and — only when a layer was added — the manager re-applies the fresh stack to the live tree. Install failures are reports, not throws, so a client can show the captured transcript; a failed hot apply leaves the layers written and the report says a restart applies them.

## Model Experience

None, as the import service registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

#### Runtime invariant

No runtime invariant companion is published because the re-apply relationship is owned by the launcher-provided manager, and the install path is covered by the app-boot and host specs that drive a real pnpm against a real profile directory.

## Known Limitations and Deferred Work

These limits follow from managing the profile a surface already booted from. They are current package constraints, not a task backlog.

- A hot apply replaces the patch stack in place. A bundle whose plugins need services this tree does not compose fails the transactional re-apply; the layers stay written and the report directs the user to restart.
- Git-hosted dependencies still need the `allowBuilds` entries pnpm prints, exactly as `dsh plugin add` does; the transcript carries pnpm's own guidance.
- Only the profile this surface booted from is manageable. Other profiles stay CLI-owned by design.
