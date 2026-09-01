# 2026-09-01 — Electron desktop Windows packaging (local-checkout stage)

## Context

The fork's only non-upstream change is the Electron desktop shell
(`examples/desktop` on `agent/desktop-electron`). Until now it ran only
through `pnpm start` from a terminal, and only against the July dev clone
it was written against. The owner wants a Windows app that opens on
double-click like Codex or Cursor; a fully self-contained bundle (runtime
inside the installer) is stage two.

## Decision

**Stage one packages the shell with electron-builder while the runtime
keeps coming from a checkout on disk.** `pnpm dist` emits an NSIS
installer and a portable exe; `src/main/dev-root.js` resolves the checkout
at packaged startup (`DSH_DEV_ROOT` → `config.json` `harnessDevRoot` →
walk-up from the portable/exe directory → `~/deepseek-harness(-dev)`) and
materializes it as `DSH_DEV_ROOT` before `profiles.js` loads, so every
existing consumer (spawn paths, plugin validation, playground) sees one
value.

Packaging forced three runtime-bridge fixes that also apply to dev mode:

- **The `--import` tsx specifier is a file URL.** A Windows drive path
  (backslashes) parses as a bare ESM specifier and fails
  `ERR_MODULE_NOT_FOUND`; `pathToFileURL` is correct on every platform.
- **The runtime spawns under system Node, not the Electron binary.** The
  rc.7 runtime needs Node ≥ 22.19 (`createZstdDecompress`), and Electron 33
  embeds Node 20.18. `profiles.js` probes `node` (or `DSH_RUNTIME_NODE`)
  once and preflight fails loud with the fix when only an old embedded
  Node exists. Plain-node smoke tests keep `process.execPath`.
- **The cordis leaves stay in the checkout** (`configDir` anchored at
  `HARNESS_DEV`): their relative plugin entries resolve against the
  checkout tree, so a copy inside `app.asar`-adjacent resources would
  strand them. The build therefore ships no `extraResources` config.

**The stdio leaves were rewritten against the current composition**
(`examples/jsonrpc-agent/cordis.yml` is the maintained reference): renamed
plugins (`dsh-jsonrpc` → `dsh-sdk-jsonrpc-server`, `dsh-fs-policy` →
`dsh-fs-observation-policy`), added the subprocess + checkpoint-policy
rows the current spine needs, and `initialize` now carries the profile's
`provider`, which the SDK server validates. The keyless echo profiles
mount a new shell-owned mock adapter (`plugins/mock-llm.mjs`, provider
route `mock-echo`) because the old `echo-agent` mock no longer exists on
master; the adapter is a plain object meeting the structural
`registerAdapter` contract (`stream`, `providerInfo`,
`providerRetryPolicy`, `resolveModel` — the last two are called
unconditionally).

## What was given up

- **daemon-echo / daemon-vibe-echo stay unavailable**: the `daemon-demo`
  bin is not on master and their leaves still name stale plugins. The
  profiles table already documents the unavailability; rewriting those
  leaves waits for the daemon bin.
- **No `session.finished` handling change**: the current wire ends turns
  with the `turn/end` session-log event; the renderer already keyed turn
  completion on it, and the smoke driver now accepts either completion
  signal. Sidebar/session-list wire methods that the July shell calls but
  the current server does not serve degrade to tolerated failures.
- **The echo tool demo card is dropped** from the echo leaves (the tool
  plugin lived in the old echo-agent leaf); the mock adapter alone covers
  the keyless UI walkthrough.

## Required verification

- `node --test test/*.test.js` in `examples/desktop`: 2032 pass; the only
  9 failures are the pre-existing Windows-host set (POSIX-path fixtures,
  artifact-server electron import) unchanged from the base branch.
- `node test/smoke-runtime.js stdio`: real jsonrpc-demo boot + one turn
  completes with `reason.kind === 'completed'` via the mock adapter.
- `pnpm dist` produces `dist/DSH Desktop Setup 0.0.1.exe` (NSIS) and
  `dist/DSH-Desktop-Portable-0.0.1.exe` (portable).
- Packaged cold boot on Windows: `pnpm dist:dir`, launch `dist/win-unpacked/DSH
  Desktop.exe` with an isolated `DSH_DESKTOP_HOME` and no `DSH_DEV_ROOT`;
  the runtime child appears as `node.exe --import file:///…tsx… bin.ts
  …config/echo-jsonrpc.yml` with the checkout-resolved paths and stays
  alive. The portable exe repeats the same boot from its own directory
  (`PORTABLE_EXECUTABLE_DIR` walk-up finds the checkout), also verified.
