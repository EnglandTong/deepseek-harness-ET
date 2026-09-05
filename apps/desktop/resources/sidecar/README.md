# Local-edge sidecar (desktop helper LLM)

Desktop starts an optional OpenAI-compatible HTTP server on localhost when
install mode is `local` (see `../helper-mode.json` / NSIS wizard, or
`$DSH_HOME/desktop-helper-mode.json` from Settings). When healthy it passes
`--patch` so `dsh web` mounts the `local-edge` pi-ai route and pins
compaction / input-optimize helpers to it.

## Soft-fail policy

The shell always boots `dsh web`. Missing binary, missing weights, or a failed health check only disables the helper route (no patch). Helper UI surfaces report unavailable rather than blocking chat.

## Staging

| Path | Role |
|---|---|
| `bin/llama-server.exe` (Windows) or `bin/llama-server` | OpenAI-compatible server binary (not shipped in the default NSIS blob) |
| `config.json` | host/port/model id; optional absolute `bin` / `modelPath` |
| weights (outside the installer) | Set `modelPath` or env `DSH_LOCAL_EDGE_MODEL_PATH` (download-on-enable) |

Environment overrides:

- `DSH_LOCAL_EDGE_BIN` — server executable
- `DSH_LOCAL_EDGE_MODEL_PATH` — GGUF / weight file
- `DSH_LOCAL_STT_BIN` — optional speech-to-text executable (`--input <path>` → transcript on stdout)
- If a server is already listening on the configured host:port, desktop reuses it and does not spawn.

## First-time local weights guide

1. Install or build an OpenAI-compatible server (llama.cpp `llama-server` is the usual choice; MIT — see [../THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)).
2. Place the binary under `bin/` or set `DSH_LOCAL_EDGE_BIN` to its absolute path.
3. Download weights separately (for example Spark X2.5 GGUF under Apache-2.0). Do not expect them in the Setup installer.
4. Point `DSH_LOCAL_EDGE_MODEL_PATH` or `config.json` `modelPath` at the weight file.
5. Restart the desktop app with Helper mode = Local model (Settings or install wizard).
6. Confirm Optimize becomes available; Voice needs `DSH_LOCAL_STT_BIN` as well.

## Choosing a model

This fork ships the **route and lifecycle**, not a locked weight name. Point `model` / `modelPath` at Spark X2.5, another GGUF, or any OpenAI-compatible server. License facts: [../THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## STT contract

`inputOptimize/transcribe` spawns:

```text
$DSH_LOCAL_STT_BIN --input <absolute-audio-path>
```

The process must exit 0 and print the transcript on stdout (stderr is diagnostics only). Any format the browser MediaRecorder produced may appear as the file suffix (`.webm`, `.wav`, `.mp4`).
