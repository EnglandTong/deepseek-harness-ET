---
description: "Composer left-row controls for draft optimize and optional local voice capture via the inputOptimize Remote."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-input-optimize

English | [中文](README.zh.md)

## Summary

Registers Optimize and Voice controls on `conversation.input.left`. Optimize calls `ctx.remote.inputOptimize.optimizeText` and replaces the composer draft for explicit confirmation before send. Voice captures audio in the browser, calls `transcribe`, then fills the draft the same way. Controls stay disabled when `status` reports the helper or STT unavailable (no desktop sidecar / no STT binary).

## Model Experience

None directly; the helper call is Host-side. The user-visible draft change is not model-visible until send.

#### KV Cache effect

None.

#### Runtime invariant

No runtime invariant companion; Remote availability is a Host config probe.

## Known Limitations and Deferred Work

- Auto-send after optimize is intentionally omitted; Settings-driven auto-send can land later.
- STT depends on a Host-configured local binary; browser MediaRecorder alone does not produce text.
