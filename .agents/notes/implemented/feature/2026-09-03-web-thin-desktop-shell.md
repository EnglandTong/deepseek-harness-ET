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
repository. Packaging a single-click installer/portable exe is deferred to a
later step.

## Alternatives considered

- **Keep and simplify Studio in place.** Rejected: the Studio IA (Tracing,
  Playground, Hub, Bench, …) is a different product; stripping pages still
  leaves a parallel UI and dual maintenance with web.
- **Open the system browser only (no Electron).** Deferred as an even thinner
  step; the chosen first product step still wants a dedicated window without
  asking the user to manage a browser tab.
- **Bundle the sdk-runtime exe inside the shell in this change.** Deferred:
  step-one only needs a checkout-backed `dsh web` launch so the path stays
  short and debuggable.

## Consequences

Contributors run `cd apps/desktop && pnpm start` after a normal repo build and
`DEEPSEEK_API_KEY`. Root `pnpm-workspace.yaml` allows Electron's postinstall
(`allowBuilds.electron: true`) so the binary downloads. Import Plugin stays on
the Web settings path via `@deepseek-ai/dsh-host-plugin-import`. The earlier
Studio migration note is consolidated here and deleted; reintroducing a
Studio-style host would need a new decision. Local untracked leftovers under
`examples/desktop` (if any) are not part of the product path and should be
deleted when no process holds them.
