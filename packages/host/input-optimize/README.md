---
description: "Remote service cleaning composer drafts and optional local STT through a helper LLM purpose (input-optimize)."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-input-optimize

English | [中文](README.zh.md)

## Summary

Desktop and web composers can clean a typed or transcribed draft before it becomes a logged user message. `inputOptimize/optimizeText` calls `ctx.llm` with `purpose: 'input-optimize'` on a configured helper route (desktop pins `local-edge` when the sidecar is healthy). `inputOptimize/transcribe` optionally runs a local STT binary (`DSH_LOCAL_STT_BIN` or `sttBin`). `inputOptimize/status` reports availability for Client chrome. `inputOptimize/helperMode` and `inputOptimize/setHelperMode` read/write `$DSH_HOME/desktop-helper-mode.json` so Settings can change cloud/local/off (restart required). Optimized text is returned to the Client for confirmation; the Host does not append session events.

## Use this package

Consumed through [`api-remotes`](../../api/remotes/README.md) as `ctx.remote.inputOptimize`. The web bundle mounts it dormant (`enabled: false`) until a `--patch` or cordis config enables it. When `provider`/`model` are empty, optimize follows `ctx.agentDefaultModel` (Settings → Models).

## Model Experience

Auxiliary helper calls only. The cleaned draft reaches the main agent only after the user confirms send in the composer (model-visible ⟺ logged).

#### KV Cache effect

None for the main chat route; the helper call is a separate `purpose: 'input-optimize'` stream.

#### Runtime invariant

No runtime invariant companion: availability is a config+llm presence check, not an independent observation pair.

## Known Limitations and Deferred Work

- Local STT is opt-in via an external binary contract (`--input <path>` → stdout text); no engine is bundled in the default installer.
- Which helper model to use for MAA / multi-agent next-step policy stays in plugin repositories; this package only exposes the draft/STT seam.
