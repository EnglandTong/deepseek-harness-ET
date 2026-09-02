// Stage the bundled standalone runtime for electron-builder: the win32
// single-file exe built by scripts/build-exe-for-python-sdk.ts plus the
// bundled cordis leaves. Fails loud with the build command when the exe
// has not been built yet. resources/runtime/ is gitignored build output.
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const desktopRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(desktopRoot, '..', '..')
const exeName = 'dsh-jsonrpc-agent-pkg-win32-x64.exe'
const sourceExe = path.join(repoRoot, 'dist-exe', exeName)
const target = path.join(desktopRoot, 'resources', 'runtime')

if (!fs.existsSync(sourceExe)) {
  console.error(`sync-bundled-runtime: ${sourceExe} is missing. Build it first:`)
  console.error('  pnpm exec tsx scripts/build-exe-for-python-sdk.ts --build-closure --targets node24-win32-x64')
  process.exit(1)
}

fs.rmSync(target, { recursive: true, force: true })
fs.mkdirSync(path.join(target, 'config'), { recursive: true })
fs.copyFileSync(sourceExe, path.join(target, exeName))
for (const leaf of ['bundled-deepseek.yml', 'bundled-deepseek-vibe.yml']) {
  fs.copyFileSync(path.join(desktopRoot, 'config', leaf), path.join(target, 'config', leaf))
}
const megabytes = (fs.statSync(path.join(target, exeName)).size / (1024 * 1024)).toFixed(1)
console.log(`sync-bundled-runtime: staged ${exeName} (${megabytes} MB) + 2 cordis leaves into resources/runtime/`)
