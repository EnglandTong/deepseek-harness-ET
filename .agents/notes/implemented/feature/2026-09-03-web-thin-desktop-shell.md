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

**Packaged Windows builds embed the sdk-runtime win-x64 exe** (plus ripgrep
sidecar) under `resources/runtime/`, synced from `dist-exe/` via
`pnpm run sync-runtime` / `dist:portable`. The portable artifact is
`DSH-Desktop-Portable-<version>.exe` (electron-builder portable only; NSIS is
deferred). Packaged launches set `DSH_HOME` to `~/.dsh` (the CLI default)
unless the environment already provides one, so the shell shares profiles and
credentials with a normal `dsh web` install. Checkout `pnpm start` still
falls back to system Node + `apps/cli/lib/bin.js` when no staged runtime is
present.

## Alternatives considered

- **Keep and simplify Studio in place.** Rejected: the Studio IA (Tracing,
  Playground, Hub, Bench, …) is a different product; stripping pages still
  leaves a parallel UI and dual maintenance with web.
- **Open the system browser only (no Electron).** Deferred as an even thinner
  step; the chosen product path still wants a dedicated window without asking
  the user to manage a browser tab.
- **Portable shell without a bundled runtime.** Rejected for distribution:
  double-click would still require a checkout and system Node.
- **NSIS installer in the same change.** Deferred: portable is enough to prove
  the embedded-runtime path; an installer can reuse the same `extraResources`.

## Consequences

Contributors run `cd apps/desktop && pnpm start` after a normal repo build and
`DEEPSEEK_API_KEY`, or `pnpm run dist:portable` after building
`deepseek-harness-sdk-runtime-win-x64.exe`. Root `pnpm-workspace.yaml` allows
Electron's postinstall (`allowBuilds.electron: true`). Import Plugin stays on
the Web settings path via `@deepseek-ai/dsh-host-plugin-import`. The earlier
Studio migration note is consolidated here and deleted; reintroducing a
Studio-style host would need a new decision. `resources/runtime/` and `dist/`
are gitignored build output.
