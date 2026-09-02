# Agent Note: Desktop shell integration into master (migration stage)

Status: implemented (migration); runtime anchoring is a follow-up

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

## What the upstream sync invalidated

The desktop's dev/checkout runtime anchoring referenced upstream surfaces
that alpha.4 deleted:

- `packages/examples/jsonrpc-demo/src/bin.ts` and its package
  `@deepseek-ai/dsh-sdk-jsonrpc-demo` — removed; the SDK runtime is now
  `dsh --profile sdk` / `sdk-minimal` (apps/cli), and single-file builds
  emit `deepseek-harness-sdk-runtime-<platform>-<arch>[.exe]`.
- `packages/examples/agent-spine-demo` (`@deepseek-ai/dsh-agent-spine-demo`)
  and its `workspaceContext` config — removed; the maintained composition
  reference is `packages/bundle/sdk-minimal/cordis.patch.yml` (explicit row
  tree). Hermetic prompts are expressed by omitting the
  `agent-instructions` row or `maxBytes: 0`.
- `DSH_CORDIS_CONFIG` env discovery — replaced by `--profile <name>`
  `--patch <path>` argv (apps/cli/src/args.ts).

The following adaptions remain (follow-up commits): profiles.js spawn →
`dsh --profile sdk` (or the renamed bundled exe), dev-root.js checkout
marker, leaf configs (drop `agent-spine-demo`), bundled leaf configs, and
the sync-bundled-runtime exe name. `plugins/mock-llm.mjs` survives: the
`ctx.llm.registerAdapter` contract is unchanged (only `stream()` is
required; `providerRetryPolicy` stays optional).

## Given up

The three old branches (`agent/desktop-electron*`) are superseded; the
desktop now lives on `master`. Old PR surface is retired.

## Required verification

- `git diff --cached --stat packages/desktop`: 521 files, no
  examples-looking residue, no build artifacts.
- Desktop tests / typecheck run as part of the follow-up runtime-anchoring
  work; this migration commit only places the tree.