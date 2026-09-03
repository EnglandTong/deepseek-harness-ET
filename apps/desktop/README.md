# DSH Desktop (thin Web shell)

Opens the **official dsh web UI** in a desktop window. No Studio / debug sidebar.

## Start

From the **repository root**:

```sh
pnpm install
pnpm run build
```

Put `DEEPSEEK_API_KEY` in the repo `.env` (or export it in your shell).

Then:

```sh
cd apps/desktop
pnpm install
pnpm start
```

That runs `dsh web --no-open` and loads `http://127.0.0.1:3080/…` in Electron.
Root `pnpm-workspace.yaml` sets `allowBuilds.electron: true` so the binary downloads on install.

## Plugin import

Use **Settings → Plugins** in the Web UI (same as the browser). This shell does not add a separate plugin page.

## Not in this step

Installer / portable `.exe` packaging comes later.
