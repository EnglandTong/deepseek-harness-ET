# Agent Note: Desktop local-edge helper and input-optimize seam

Status: implemented

English | [中文](2026-09-05-desktop-local-edge-input-optimize.zh.md)

## Problem

Desktop product users need a small on-machine helper model for draft cleanup, optional speech-to-text, and compaction summarization without sending sensitive drafts to the cloud chat route. Plugin products (MAA / governance) need a stable helper purpose and route identity so they can choose models later, without owning Electron lifecycle in those repos.

## Decision

**This fork owns the local-edge foundation; plugins own model selection and next-step policy.**

Desktop (`apps/desktop`) optionally starts or reuses an OpenAI-compatible localhost sidecar (`sidecar.js` + `resources/sidecar/`), or enables cloud helpers that follow the **Settings → Models** selection (DeepSeek is the product preset), or disables helpers. The NSIS Setup wizard writes `$INSTDIR/resources/helper-mode.json` with `mode: cloud | local | off`. After install, **Settings → General → Helper mode** writes `$DSH_HOME/desktop-helper-mode.json` (outranked only by `DSH_HELPER_MODE`). When a helper mode is ready it writes `$DSH_HOME/desktop-helper.patch.yml` and launches `dsh web --no-open --patch …`. Soft-fail is mandatory for local mode: missing binary or weights never blocks the Web UI.

`GenerateOptions.purpose` includes `input-optimize` and `context-assist` beside `compaction` and `session-title`. Host package `@deepseek-ai/dsh-host-input-optimize` exposes Remote `status` / `optimizeText` / `transcribe` / `helperMode` / `setHelperMode`. Client package `@deepseek-ai/dsh-client-ui-input-optimize` mounts Optimize / Voice on `conversation.input.left` and the helper-mode Settings row; optimized text replaces the draft for explicit confirmation before send (model-visible ⟺ logged).

Weights and STT engines stay out of the default NSIS blob (download-on-enable / env paths). Spark X2.5 is not hardcoded; `model` / `modelPath` are configuration. Copyright and redistribution notes for optional Spark (Apache-2.0, Copyright 2026 XHToken) and llama.cpp (MIT) live in `apps/desktop/resources/THIRD_PARTY_NOTICES.md`. MAA and governance consume `context-assist` / route choice in their own repositories.

Charter allowlist entry: desktop local LLM sidecar lifecycle + helper purposes + input-optimize Host/Client seam.

## Alternatives considered

- **Hardcode Spark X2.5 in Electron.** Rejected: the fork ships capability and a stable route id; plugins and operators pick weights.
- **Bundle multi-GB weights in NSIS.** Rejected for default packaging size; download-on-enable keeps the installer thin.
- **Put next-step routing in this fork.** Rejected by [FORK-CHARTER.md](../../../FORK-CHARTER.md); business routing stays in MAA / governance.
- **Invent a second LLM stack outside `ctx.llm`.** Rejected: reuse `dsh-llm-pi-ai` OpenAI-compatible routes and existing dual-model patterns (compaction / session-title).

## Consequences

Contributors stage `DSH_LOCAL_EDGE_BIN` / `DSH_LOCAL_EDGE_MODEL_PATH` (or `resources/sidecar/bin` + `config.json`) to exercise helpers; without them, Optimize / Voice stay disabled and chat still works. After install, Settings → Helper mode writes `$DSH_HOME/desktop-helper-mode.json` and requires a desktop restart. Plugin authors call `ctx.llm.stream({ purpose: 'context-assist', … })` or configure routes for MAA/governance without changing the desktop shell. Verification: host unit test for Remote method publication and helper-mode home override; desktop soft-fail path when sidecar is absent; three-mode smoke checklist in `apps/desktop/README.md`.

## Related

- Thin desktop shell: [2026-09-03-web-thin-desktop-shell.md](./2026-09-03-web-thin-desktop-shell.md)
- Fork charter allowlist: [../process/2026-09-04-fork-charter-desktop-product-patches.md](../process/2026-09-04-fork-charter-desktop-product-patches.md)
