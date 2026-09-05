# DSH Desktop (thin Web shell)

Opens the **official dsh web UI** in a desktop window. No Studio / debug sidebar.

**Product packaging order:** stabilize the shell → **NSIS installer** (primary) → optional install-time bootstrap plugins → Portable last (deferred for day-to-day work).

## Dev start (checkout)

From the **repository root**:

```sh
pnpm install
pnpm run build
```

Put `DEEPSEEK_API_KEY` in the repo `.env`, the environment, or `$DSH_HOME/.env`.

Then:

```sh
cd apps/desktop
pnpm install
pnpm start
```

`pnpm start` prefers a staged sdk-runtime under `resources/runtime/` when present; otherwise it runs system Node against `apps/cli/lib/bin.js`. Root `pnpm-workspace.yaml` sets `allowBuilds.electron: true` so the Electron binary downloads on install.

The shell sets `DSH_HOME` to `~/.dsh` (same as the CLI) unless `DSH_HOME` is already set.

## Windows installer (primary)

1. Build the win-x64 runtime (once per release), from the repo root:

   ```sh
   pnpm exec tsx scripts/build-exe-for-python-sdk.ts --targets node24-win-x64 --skip-build
   ```

2. Package the Setup installer:

   ```sh
   cd apps/desktop
   pnpm install
   pnpm run dist:installer
   ```

   That:

   - syncs `dist-exe/deepseek-harness-sdk-runtime-win-x64.exe` (+ `-rg`) into `resources/runtime/`
   - stages `pnpm.exe` into `resources/tools/` (copy from PATH or download)
   - builds `dist/DSH-Desktop-Setup-0.0.1.exe` (NSIS: choose install dir, Start Menu + desktop shortcuts)

The installed app embeds the runtime and prepends bundled `pnpm` to `PATH` so **Settings → Plugins → Import** works without a global pnpm.

### Optional first-run plugin bootstrap

Edit `resources/bootstrap/plugins.json` before packaging:

```json
{ "plugins": ["@example/some-bundle"] }
```

On the first packaged launch, the shell runs `dsh plugin --profile web add …` for each entry (via the bundled runtime + pnpm) and writes `%USERPROFILE%\.dsh\desktop-bootstrap-plugins.done`. Leave `plugins` empty to skip.

## Portable (deferred)

```sh
pnpm run dist:portable
```

Still available for smoke tests; product distribution prefers the installer.

## Plugin import

Use **Settings → Plugins** in the Web UI (same as the browser). Bundled `pnpm.exe` covers the host-tool requirement for packaged installs.

## Local-edge helper (optional)

### Install-time choice (NSIS)

The Setup wizard asks how helpers should run and writes
`$INSTDIR\resources\helper-mode.json`:

| Mode | Behavior |
|---|---|
| **Online API** (`cloud`) | No local sidecar. Compaction reuses the chat route; input-optimize follows the model chosen in **Settings → Models** (product preset is DeepSeek cloud). Optional pin: `DSH_HELPER_CLOUD_PROVIDER` + `DSH_HELPER_CLOUD_MODEL`. |
| **Local small model** (`local`) | Start or reuse an OpenAI-compatible localhost server; pin helpers to `local-edge`. |
| **Disable helpers** (`off`) | No helper patch; Optimize / Voice stay off. |

Checkout / missing file defaults to `local` with soft-fail. Precedence: `DSH_HELPER_MODE` → `$DSH_HOME/desktop-helper-mode.json` (Settings) → install `helper-mode.json` → default `local`.

Change mode after install via **Settings → General → Helper mode** (writes the home override; restart the desktop app). Env `DSH_HELPER_MODE` locks the choice until unset.

When `local` is healthy the shell writes `$DSH_HOME/desktop-helper.patch.yml` and starts `dsh web --no-open --patch …`. Missing binary or weights soft-fails. See [resources/sidecar/README.md](resources/sidecar/README.md).

Env overrides: `DSH_LOCAL_EDGE_BIN`, `DSH_LOCAL_EDGE_MODEL_PATH`, `DSH_LOCAL_STT_BIN`.

### Local weights and STT

Weights are never in the default NSIS blob. For `local` mode:

1. Download an OpenAI-compatible server binary (e.g. llama.cpp `llama-server`) into `resources/sidecar/bin/` or set `DSH_LOCAL_EDGE_BIN`.
2. Download GGUF / weights outside the installer and set `DSH_LOCAL_EDGE_MODEL_PATH` or `sidecar/config.json` `modelPath`.
3. Optional STT: set `DSH_LOCAL_STT_BIN` to an executable that accepts `--input <path>` and prints transcript text on stdout (Host `inputOptimize/transcribe`).

### Smoke checklist (three modes)

| Check | cloud | local | off |
|---|---|---|---|
| App boots Web UI | yes | yes (even if sidecar missing) | yes |
| `$DSH_HOME/desktop-helper.patch.yml` | present when ready | present when sidecar healthy | absent |
| Optimize / Voice | follow Settings → Models (needs API key) | `local-edge` when healthy; else unavailable | unavailable |
| Compaction helper | chat route (empty summarization pair) | pinned to local model when healthy | N/A |
| Change mode in Settings | restart required | restart required | restart required |

Hand-test each mode once with and without `DEEPSEEK_API_KEY`, and for `local` with and without a healthy sidecar.

### Copyright / third-party

See [resources/THIRD_PARTY_NOTICES.md](resources/THIRD_PARTY_NOTICES.md): Spark-X2.5 weights are Apache-2.0 (Copyright 2026 XHToken) when you supply them; llama.cpp is MIT; the default installer does not ship weights or the inference binary.