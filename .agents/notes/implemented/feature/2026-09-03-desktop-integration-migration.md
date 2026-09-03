# Agent Note: Desktop shell integration into master (migration stage)

Status: implemented

English | [中文](2026-09-03-desktop-integration-migration.zh.md)

## Problem

The fork's Electron desktop shell lived at `examples/desktop` on three
stacked branches (`agent/desktop-electron`, `-packaging`,
`-standalone`) based on an old upstream state. Meanwhile `master`
followed upstream through a 2462-commit sync to dsh-0.1.2-alpha.4,
which retired top-level `examples/` entirely and merged the fork's
plugin-import web feature. The desktop shell needed to join `master`
so the desktop and plugin-import features coexist on one branch.

## Decision

**The desktop shell becomes `packages/desktop` (`@deepseek-ai/dsh-desktop`),
tracked on `master`.** The complete shell tree (521 files) was exported from
`agent/desktop-electron-standalone` (the stack tip holding all three PRs'
work) into `packages/desktop`, excluding build artifacts
(`dist/`, `node_modules/`, `resources/runtime/`). `package.json` was renamed
to the workspace-scoped `@deepseek-ai/dsh-desktop`.

`packages/desktop` is deliberately **not** a pnpm workspace member: the
workspace glob is `packages/*/*` (two levels), so the single-level
`packages/desktop` stays a self-contained Electron app with its own
`pnpm-lock.yaml`, matching its application (not harness-package) nature and
avoiding invariant/tsconfig/coverage gates that assume a Cordis package.

**Runtime anchoring is re-pointed to the alpha.4 surfaces.** The old
anchors referenced upstream code alpha.4 deleted:

- `profiles.js` checkout spawns run `node --import tsx/esm apps/cli/src/bin.ts
  --profile sdk` (tsx resolved as an absolute file URL from the dev checkout;
  `TSX_TSCONFIG_PATH` pins the checkout's tsconfig); bundled spawns run the
  single-file `deepseek-harness-sdk-runtime-win-x64.exe` with `--profile sdk`
  (exe name per `scripts/build-exe-for-python-sdk.ts`, staged with its
  `rg.exe` sidecar by `scripts/sync-bundled-runtime.js`).
- `dev-root.js`/`profiles.js` checkout discovery accepts only a directory
  holding `apps/cli/src/bin.ts` (was `packages/examples/jsonrpc-demo/src/bin.ts`).
- The daemon/socket runtime (`daemon-demo`), the playground scratch boot, and
  the plugin probe depended on the removed socket surface. The two daemon
  profiles and the keyless `stdio-echo` profile are disabled in
  `profiles.js` (`disabled` + `disabledReason`, surfaced greyed-out through
  `profiles:list` and `startRuntime`); `plugins:probe` and the playground
  start fail loud with the retirement reason instead of spawning a phantom
  bin. The scratch runtime is re-anchored to the `sdk` profile as follow-up
  work.
- The `config/*.yml` leaves are legacy-view assets: the `sdk` profile
  composes from bundle layers and takes no leaf argv, so the runtime never
  loads them; they feed the Plugins tab's fs-parse/legacy-leaf view (and the
  daemon-echo leaf remains the user-overlay base) with headers saying so.
- The shell speaks the SDK wire (`@deepseek-ai/dsh-sdk-protocol`:
  `initialize`/`session/prompt`/`shutdown` + four notifications). Methods
  the old jsonrpc-demo wire served but the SDK wire does not
  (`session/list`, `session/new`, `session/events`, `session/cancel`,
  `session/fork`, `session/compact`, `plugins/list`, …) degrade on
  MethodNotFound; the smoke script and README document the split.
- `smoke-runtime.js` runs stdio/kill/tree against the `sdk` profile only
  (daemon scenarios removed; kill-recovery SIGKILLs the stdio child via the
  transport) and self-skips without `DEEPSEEK_API_KEY`, since no keyless
  profile exists on the sdk runtime. The missing-key card in the renderer
  dropped its `switchTarget` accordingly.

`plugins/mock-llm.mjs` survives unchanged: the `ctx.llm.registerAdapter`
contract is unchanged (only `stream()` is required; `providerRetryPolicy`
stays optional).

## Alternatives considered

- **Merging the three old branches into master.** Rejected: they sit on the
  pre-alpha.4 upstream, so a merge drags in the 2462-commit conflict flood,
  and their runtime (`jsonrpc-demo`/`agent-spine-demo`) no longer exists to
  merge against — every merge conflict would resolve to a rebuild anyway.
- **Keeping the desktop out of tree until the upstream runtime stabilizes.**
  Rejected: the shell is the fork's product surface and plugin-import work
  needs the desktop to coexist on the same branch; parking it repeats the
  divergence this integration exists to end.
- **Retaining keyless echo on the sdk runtime via a profile patch.** Deferred:
  it needs a mock-adapter bundle overlay for the `sdk` profile; shipping the
  integration without a keyless profile is safer than blocking on new
  upstream surface (a disabled profile fails loud with its reason).

## Consequences

One branch (`agent/desktop-integration`, landing on `master`) carries the
desktop shell and plugin-import together, versioned as
`@deepseek-ai/dsh-desktop` against upstream's alpha.4 runtime. The 2044-test
desktop suite is green on Windows (2 platform-justified skips). Lost in the
move: the daemon-only UI surfaces (live plugin list, sandbox toggles,
session/compact button) have no wire on the sdk runtime and sit behind
graceful degradation; the playground and plugin probe report their
unavailability instead of booting; and the packaged app's `stdio-echo`
fallback needs a checkout-holding user until the mock overlay lands. The
full profile/protocol accounting lives in `packages/desktop/README.md`.
