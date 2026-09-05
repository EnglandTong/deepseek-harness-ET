# Agent Note: Packaged Node Dirent methods break agent-preset discovery

Status: implemented

English | [中文](2026-09-05-packaged-node-dirent-isdirectory.zh.md)

## Problem

Installed desktop builds failed Settings → Agent presets with `child.isDirectory is not a function`, and Settings → Plugins → Plugin list failed with the generic inventory error. Both paths call agent-preset roster scanning; `pluginInventory/list` awaits `compositionInventory()` when the roster is mounted.

## Decision

**`scanRoot` and authoring tree walks use plain `readdir` names plus `stat().isDirectory()`, never `withFileTypes` Dirent methods.** SEA / packaged Node runtimes can return Dirent-shaped objects whose type predicates are not callable. Stat on the joined path is the portable directory check for these small preset roots.

Settings → Plugins → Import adds an explicit path field hint, a **Browse** control through `directoryPicker.pick()`, and a primary-styled **Import** button so local bundle folders are easy to select without typing a path.

## Alternatives considered

**Keep `withFileTypes` and guard `typeof child.isDirectory === 'function'`.** Rejected: callers still need a correct directory answer; `stat` is the one check that works in both normal and packaged Node.

## Consequences

Agent preset Settings and plugin inventory list work under the desktop installer runtime. Operators rebuild the NSIS package to pick up the Host fix; the Import UI ships with the Client bundle rebuild.

## Related

- Desktop helper / thin shell: [../feature/2026-09-05-desktop-local-edge-input-optimize.md](../feature/2026-09-05-desktop-local-edge-input-optimize.md)
