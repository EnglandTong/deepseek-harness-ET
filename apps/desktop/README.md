# DSH Desktop (thin Web shell)

Opens the **official dsh web UI** in a desktop window. No Studio / debug sidebar.

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

The shell sets `DSH_HOME` to `~/.dsh` (same as the CLI) unless `DSH_HOME` is already set, so packaged and checkout launches share profiles and `$DSH_HOME/.env`.

## Portable Windows build

1. Build the win-x64 runtime (once per release), from the repo root:

   ```sh
   pnpm exec tsx scripts/build-exe-for-python-sdk.ts --targets node24-win-x64 --skip-build
   ```

   Use without `--skip-build` if `lib/` is stale.

2. Package:

   ```sh
   cd apps/desktop
   pnpm install
   pnpm run dist:portable
   ```

   That syncs `dist-exe/deepseek-harness-sdk-runtime-win-x64.exe` (+ `-rg` sidecar) into `resources/runtime/` and writes `dist/DSH-Desktop-Portable-0.0.1.exe`.

Double-click the portable exe. It starts the bundled runtime with `web --no-open` and loads the printed URL. Put the API key in `~/.dsh/.env` or the process environment (override with `DSH_HOME` if needed).

NSIS installer packaging is deferred.

## Plugin import

Use **Settings → Plugins** in the Web UI (same as the browser). This shell does not add a separate plugin page.
