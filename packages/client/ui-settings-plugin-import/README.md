---
description: "Import tab in the web Plugins settings: install a plugin bundle into the booted profile by package name or local path and watch the live apply result."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-plugin-import

English | [中文](README.zh.md)

## Summary

This package contributes the Import tab to the Plugins settings section. It renders an install form (a registry package name or a `file:`/`link:`/path spec), the last install report, and the profile's current bundle layer list with per-bundle resolution. The tab binds the [`plugin-import`](../../host/plugin-import/README.md) Remote through the [`api-remotes`](../../api/remotes/README.md) assembly; it owns no settings of its own and holds no state beyond the tab's draft and the last report.

## Use this package

The package is composed by the web bundle; the tab appears in Plugins settings wherever the host composes `plugin-import`. Cards and tabs in this section register through the `settings.plugins.tab` slot, so the tab needs no changes to the section owner. Clients consume the Remote through the [`api-remotes`](../../api/remotes/README.md) assembly.

## Model Experience

None, as the tab renders host facts only and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

#### Runtime invariant

No invariant companion is published: the tab renders host-reported facts only, and its registration slot is declared by the Plugins section owner.

## Known Limitations and Deferred Work

These limits follow from presenting one profile's import surface. They are current package constraints, not a task backlog.

- The tab manages only the profile the web surface booted from; it shows no profile switcher by design.
- A hot apply that failed is reported with the restart hint; the tab does not poll or auto-retry the apply.
