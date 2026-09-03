// Stage the bundled standalone runtime for electron-builder: the win32
// single-file exe built by scripts/build-exe-for-python-sdk.ts plus its
// ripgrep sidecar. The exe's entry is the dsh CLI bin and composes the sdk
// profile from DSH_HOME at runtime, so no cordis leaves are staged.
// Fails loud with the build command when the exe has not been built yet.
// resources/runtime/ is gitignored build output.
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const desktopRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(desktopRoot, '..', '..')
const exeName = 'deepseek-harness-sdk-runtime-win-x64.exe'
const rgName = 'deepseek-harness-sdk-runtime-win-rg.exe'
const sourceExe = path.join(repoRoot, 'dist-exe', exeName)
const sourceRg = path.join(repoRoot, 'dist-exe', rgName)
const target = path.join(desktopRoot, 'resources', 'runtime')

if (!fs.existsSync(sourceExe)) {
  console.error(`sync-bundled-runtime: ${sourceExe} is missing. Build it first:`)
  console.error('  pnpm exec tsx scripts/build-exe-for-python-sdk.ts --build-closure --targets node24-win-x64')
  process.exit(1)
}

fs.rmSync(target, { recursive: true, force: true })
fs.mkdirSync(target, { recursive: true })
fs.copyFileSync(sourceExe, path.join(target, exeName))
if (fs.existsSync(sourceRg)) fs.copyFileSync(sourceRg, path.join(target, rgName))
else console.error(`sync-bundled-runtime: warning — ripgrep sidecar ${sourceRg} is missing; tool search will degrade.`)
const megabytes = (fs.statSync(path.join(target, exeName)).size / (1024 * 1024)).toFixed(1)
console.log(`sync-bundled-runtime: staged ${exeName} (${megabytes} MB) into resources/runtime/`)
