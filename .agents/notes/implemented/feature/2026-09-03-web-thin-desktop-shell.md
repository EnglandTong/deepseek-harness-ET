# Agent Note: Product desktop is a thin shell over dsh web

Status: implemented

English | [中文](2026-09-03-web-thin-desktop-shell.zh.md)

## Problem

The fork briefly shipped a large Electron "Harness Studio" shell at
`packages/desktop` (`@deepseek-ai/dsh-desktop`) as a protocol reference host
with many observation and demo pages. Product intent for this fork is the
opposite: keep the official **dsh web** UI, launch it with one simple desktop
window, and grow features gradually (plugin-import already lives in Web
settings). The Studio shell raised difficulty and confused "desktop product"
with a debug surface.

## Decision

**Product desktop is `apps/desktop`: a thin Electron main process that starts
`dsh web --no-open` and loads the printed URL in a BrowserWindow.** It does not
reimplement chat, workspaces, settings, or plugin import — those remain the
web profile. The Studio tree at `packages/desktop` is removed from the
repository.

**Product packaging order is: stabilize the shell → NSIS installer (primary)
→ optional install-time / first-run bootstrap plugins → Portable last.**
Packaged Windows builds embed the sdk-runtime win-x64 exe (plus ripgrep
sidecar) under `resources/runtime/`, stage `pnpm.exe` under `resources/tools/`,
ship bootstrap manifests under `resources/bootstrap/`, and ship local-edge
sidecar config under `resources/sidecar/` (engine and weights are not in the
default NSIS blob). Sync via
`pnpm run sync-pack` / `dist:installer`. The Setup artifact is
`DSH-Desktop-Setup-<version>.exe` (NSIS: choose install dir, Start Menu +
desktop shortcuts; Directory-page leave appends the product folder name).
Bundled `pnpm` is prepended to `PATH` for Settings → Plugins import. On first
packaged launch, missing web-profile deps run
`dsh plugin --profile web install` before `dsh web`, then optional specs in
`resources/bootstrap/plugins.json` run through
`dsh plugin --profile web add`; a marker under `DSH_HOME` prevents repeats.
Before `dsh web`, the shell optionally starts or reuses an OpenAI-compatible
local-edge sidecar; when healthy it passes `--patch` for the `local-edge`
route, compaction summarizer pin, and input-optimize enablement (soft-fail
otherwise). The shell shows a splash window immediately so first-run install /
web bind is not a blank wait. Packaged launches set `DSH_HOME` to `~/.dsh`
unless the environment already provides one. Checkout `pnpm start` still falls
back to system Node + `apps/cli/lib/bin.js` when no staged runtime is present.
`dist:portable` remains for smoke tests; it is not the product distribution
path. Installed SEA web requires the client-modules `moduleFallback` follow
so `__DSH_BOOT__` is not empty under profile proxies. Local-edge helper
details: [2026-09-05-desktop-local-edge-input-optimize.md](./2026-09-05-desktop-local-edge-input-optimize.md).


## Alternatives considered

- **Keep and simplify Studio in place.** Rejected: the Studio IA (Tracing,
  Playground, Hub, Bench, …) is a different product; stripping pages still
  leaves a parallel UI and dual maintenance with web.
- **Open the system browser only (no Electron).** Deferred as an even thinner
  step; the chosen product path still wants a dedicated window without asking
  the user to manage a browser tab.
- **Portable shell without a bundled runtime.** Rejected for distribution:
  double-click would still require a checkout and system Node.
- **Portable as the primary artifact.** Rejected for the product path: users
  need install-dir choice, shortcuts, and a place to stage host tools /
  first-run plugin bootstrap; NSIS is the primary ship form, with Portable
  kept as a secondary smoke target.

## Consequences

Contributors run `cd apps/desktop && pnpm start` after a normal repo build and
`DEEPSEEK_API_KEY`, or `pnpm run dist:installer` after building
`deepseek-harness-sdk-runtime-win-x64.exe`. Root `pnpm-workspace.yaml` allows
Electron's postinstall (`allowBuilds.electron: true`). The desktop package stays
`private: true`, shares the dsh family version, and is excluded from the npm
release member set (`apps/!(desktop)` / workspace-constraint private-product-app
rules) because it ships as an Electron installer rather than a published tarball.
Import Plugin stays on the Web settings path via
`@deepseek-ai/dsh-host-plugin-import`. The earlier Studio migration note is
consolidated here and deleted; reintroducing a Studio-style host would need a
new decision. `resources/runtime/`, `resources/tools/`, and `dist/` are
gitignored build output.
