# Agent Note: Desktop standalone win32 runtime (single-exe inside the installer)

Status: implemented

## Problem

Stage 1 of the desktop packaging (2026-09-01, `2026-09-01-desktop-windows-packaging-stage1.md`) made the shell double-clickable but still booted the runtime from a checkout on disk with system Node and tsx — the installer depended on a deepseek-harness clone and a Node install. The goal for stage 2: an installer whose real-model profiles run with no checkout and no Node on the machine.

## Decision

**The packaging route gains win32 and the installer ships the resulting single-file exe.** The
single-exe pipeline (`scripts/build-exe-for-python-sdk.ts`, route owned by
[2026-07-10](2026-07-10-single-file-executable-sdk-runtime-distribution.md)) accepts `node24-win32-x64`;
the product `dsh-jsonrpc-agent-pkg-win32-x64.exe` is staged into `examples/desktop/resources/runtime/`
by `examples/desktop/scripts/sync-bundled-runtime.js` and packed as an electron-builder extraResource.
The Windows product stays out of the Python runtime directory: the wheel set remains linux/macos, and
desktop packaging owns its own copy.

**Closure-scoped build (`--build-closure`)** replaces the full-workspace `pnpm run build` for that
path. The script traverses the deploy manifest's dependency + workspace-peer closure, emits a
solution tsconfig referencing every closure package for `tsc -b`, and narrows tsdown through
`DSH_TSDOWN_WORKSPACE_DIRS` (tsdown 0.22.2 parses its `-F` CLI filter but never applies it). The
reason is a checkout-shape reality: a workspace can hold junctioned packages owned by a separate
repository whose sources fail the full build — the full-workspace step is not a safe dependency for
artifact packaging. `vendor/*` packages resolve through the same closure traversal. The Typert
generator joins the build set explicitly because the tsdown config imports its built plugin. Linux
builds are unaffected: without the flag the pipeline runs `pnpm run build` as before.

**Bundled profile mode.** When the staged exe is present, `profiles.js` resolves the deepseek
profiles against it: `cmd` is the exe, the argument is a real-file cordis leaf beside it
(`resources/runtime/config/bundled-*.yml`, bare names only — every one resolves inside the exe's
VFS), the workspace is the user profile (cwd plus `DSH_CWD`/`DSH_SESSION_ROOT` env), and the env
carries only `DEEPSEEK_API_KEY`. Development keeps checkout profiles as the default; a staged
runtime flips nothing until the app is packaged or `DSH_BUNDLED_RUNTIME_DIR` is set. Preflight for
bundled profiles checks only the exe and the leaf, failing loud with the rebuild command.

## What was given up

- **Keyless echo stays checkout-bound in standalone installs**: the echo adapter is a shell-owned
  relative plugin, and the exe's VFS is a closed set — shipping it would mean a new workspace
  package inside the deploy closure. The standalone app boots the real-model profiles; the missing-
  key card still guides users to set the key.
- **daemon-echo / daemon-vibe-echo are unchanged** (no `daemon-demo` bin on master; leaves stale).
- **node-pty rides its win32-x64 prebuild** — no spawn-helper equivalent is staged (macOS-only concept).

## Required verification

- `pnpm exec tsx scripts/build-exe-for-python-sdk.ts --build-closure --targets node24-win32-x64`
  produces `dist-exe/dsh-jsonrpc-agent-pkg-win32-x64.exe` (165.0 MB on this machine).
- The exe driven directly over NDJSON with the bundled leaf completes a real
  `deepseek-v4-flash` turn: assistant text `standalone-ok`, `turn/end` reason `completed`, clean exit —
  with no repo and no system Node in the child.
- The packaged app copied **outside** the repository (walk-up cannot find a checkout), with an
  isolated `DSH_DESKTOP_HOME`, spawns `dsh-jsonrpc-agent-pkg-win32-x64.exe` as its runtime child with
  zero repository paths in argv.
- `node --test test/*.test.js` in `examples/desktop`: 2032 pass, the same 9 pre-existing
  Windows-host failures as the base branch.
