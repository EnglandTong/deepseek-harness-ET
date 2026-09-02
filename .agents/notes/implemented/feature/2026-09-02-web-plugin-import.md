# Agent Note: Plugin import in the web Plugins settings

Status: implemented

English | [中文](2026-09-02-web-plugin-import.zh.md)

## Problem

Adding a plugin bundle to a profile meant the terminal: `dsh plugin --profile <name> add <package>`, then a restart of the surface. A user working in the web GUI had to know the profile directory, pnpm, and the `dsh.bundle` manifest convention, and the reconciliation rules lived only in `apps/cli/src/plugin.ts`, unreachable from a browser surface.

## Decision

Two new packages make the import a product surface. `@deepseek-ai/dsh-host-plugin-import` owns the `pluginImport` Remote: `import(spec)` runs `pnpm add` in the booted profile's directory through the shared `installProfileBundle` in `@deepseek-ai/dsh-app-boot`, reconciles `dsh.profile.bundles` with the same extracted `reconcileProfileBundles` the CLI now calls, and reports the transcript instead of throwing, so the browser can show what happened. `@deepseek-ai/dsh-client-ui-settings-plugin-import` contributes the Import tab to the Plugins settings section through the existing `settings.plugins.tab` slot.

**The launcher owns profile facts and the hot-apply trigger.** The web server is profile-agnostic by design, so `runProfile` provides a `ProfilePluginManager` under a host-package key: immutable context (profile name, directory, install anchor) plus one `applyInstalledBundles()` closure. The closure re-runs `prepareProfile` so a freshly installed bundle's layer joins the composition, keeps `composed` current for the existing file-watch recompositions, and replaces the root include's patch stack through the new exported `updateRootIncludePatches` — the same transactional re-apply the patch watchers perform. A failed re-apply is a report field, not a boot failure: the layers stay written and the UI says a restart applies them.

**One reconcile, two surfaces.** The CLI keeps its synchronous, terminal-streaming spawn, but `anchorPathSpec` and the reconcile now live in `dsh-app-boot` next to the other profile primitives, so the CLI and the web surface cannot drift on which dependency joins the layer stack.

**The tab renders only what the host reports.** Resolution tags come from `listBundles`, the restart hint from the report's `applied`/`applyError` fields, and the install transcript is the captured pnpm output. The tab manages only the profile the web surface booted from; there is no profile switcher, matching the Host allowlist stance taken for settings exposure.

## Alternatives considered

- **Reusing the dynamic cordis runner.** That seam defines in-memory plugins authored at runtime; it never touches `$DSH_HOME/profiles` or pnpm. An install is a different operation with different failure modes and was not folded into it.
- **Forwarding arbitrary pnpm verbs from the browser.** `dsh plugin` forwards argv verbatim, which is safe only because a terminal user typed it. The Remote accepts one spec and constructs `pnpm add` itself.
- **Restart-prompt-only MVP instead of a hot apply.** Rejected because the web profile already runs with live patch reload, so the transactional re-apply machinery exists; the incremental work is exactly the recomposition the manager owns.
- **Managing any profile from the page.** Deferred: cross-profile enumeration and writes need their own trust story, and every real consumer manages the surface it is looking at.

## Consequences

A user can install a published bundle or a local `file:` path from the Plugins settings and see the layer join the running tree, with the captured install output and an explicit restart hint when a hot apply refuses. Git-hosted dependencies still need pnpm's `allowBuilds` entries; the transcript carries pnpm's guidance. Coverage follows the existing seams: app-boot unit specs for the shared install path and the re-apply, a host spec exercising the gateway against a fake pnpm on PATH, and client specs for the tab's states.
