# Bootstrap plugins (installer / first run)

`plugins.json` lists bundle specs to install into the **web** profile on first
packaged launch (before the shell starts `dsh web`).

Example:

```json
{
  "plugins": [
    "@deepseek-ai/dsh-agent-governance-bundle"
  ]
}
```

Empty `plugins` means skip. Specs use the same grammar as Settings → Plugins
Import (`file:` / `link:` / registry name). Requires the staged `pnpm.exe`
under `resources/tools/` (synced by `pnpm run sync-tools`).
