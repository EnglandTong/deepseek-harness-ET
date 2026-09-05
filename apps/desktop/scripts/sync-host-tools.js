// Stage win-x64 host tools for the installed desktop app.
// Today: pnpm (required by Settings → Plugins import / `dsh plugin`).
// Prefers DSH_PNPM_EXE; else downloads the GitHub release zip (pnpm v11+
// win32-x64 asset: pnpm.exe + dist/) via curl and extracts into
// resources/tools/. The lone @pnpm/win-x64 npm tarball exe is not enough —
// it still resolves dist/pnpm.mjs next to itself.
// resources/tools/ is gitignored build output.
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const os = require('node:os')

const desktopRoot = path.resolve(__dirname, '..')
const targetDir = path.join(desktopRoot, 'resources', 'tools')
const targetExe = path.join(targetDir, 'pnpm.exe')
/** Keep in sync with root package.json packageManager when bumping. */
const PNPM_VERSION = '11.7.0'
const DOWNLOAD_URLS = [
  `https://ghfast.top/https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/pnpm-win32-x64.zip`,
  `https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/pnpm-win32-x64.zip`,
]

function whichPnpmExe() {
  const fromEnv = process.env.DSH_PNPM_EXE && process.env.DSH_PNPM_EXE.trim()
  if (fromEnv && fs.existsSync(fromEnv) && looksLikeStandalonePnpm(fromEnv)) {
    return fromEnv
  }
  const result = spawnSync(
    process.platform === 'win32' ? 'where' : 'which',
    ['pnpm'],
    { encoding: 'utf8', windowsHide: true },
  )
  if (result.status !== 0) return null
  const lines = String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  for (const candidate of lines) {
    if (candidate.toLowerCase().endsWith('.exe') && looksLikeStandalonePnpm(candidate)) {
      return candidate
    }
  }
  return null
}

/** True when pnpm.exe has a sibling dist/pnpm.mjs (release zip layout). */
function looksLikeStandalonePnpm(exePath) {
  if (!fs.existsSync(exePath)) return false
  return fs.existsSync(path.join(path.dirname(exePath), 'dist', 'pnpm.mjs'))
}

function downloadWithCurl(url, dest) {
  const result = spawnSync(
    'curl.exe',
    ['-fsSL', '--retry', '3', '--retry-delay', '2', '-o', dest, url],
    { encoding: 'utf8', windowsHide: true },
  )
  if (result.status !== 0) {
    throw new Error(
      `curl failed (exit ${result.status}): ${String(result.stderr || result.stdout || '').trim()}`,
    )
  }
  if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
    throw new Error(`curl wrote empty file for ${url}`)
  }
}

function extractZip(zipPath, destDir) {
  const expand = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
    ],
    { encoding: 'utf8', windowsHide: true },
  )
  if (expand.status !== 0) {
    throw new Error(
      `Expand-Archive failed: ${String(expand.stderr || expand.stdout || '').trim() || `exit ${expand.status}`}`,
    )
  }
}

function stageFromZip() {
  console.log(`sync-host-tools: downloading pnpm v${PNPM_VERSION} (win32-x64 zip) …`)
  const zipTmp = path.join(os.tmpdir(), `pnpm-win32-x64-${PNPM_VERSION}.zip`)
  const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pnpm-zip-'))
  try {
    let lastError = null
    for (const url of DOWNLOAD_URLS) {
      try {
        downloadWithCurl(url, zipTmp)
        lastError = null
        break
      } catch (err) {
        lastError = err
        try {
          fs.unlinkSync(zipTmp)
        } catch {
          // ignore
        }
      }
    }
    if (lastError) throw lastError
    extractZip(zipTmp, extractDir)
    const stagedExe = path.join(extractDir, 'pnpm.exe')
    const stagedDist = path.join(extractDir, 'dist')
    if (!fs.existsSync(stagedExe) || !fs.existsSync(stagedDist)) {
      throw new Error(`zip missing pnpm.exe or dist/ (looked in ${extractDir})`)
    }
    fs.rmSync(targetDir, { recursive: true, force: true })
    fs.mkdirSync(targetDir, { recursive: true })
    fs.copyFileSync(stagedExe, targetExe)
    fs.cpSync(stagedDist, path.join(targetDir, 'dist'), { recursive: true })
  } finally {
    try {
      fs.unlinkSync(zipTmp)
    } catch {
      // ignore
    }
    fs.rmSync(extractDir, { recursive: true, force: true })
  }
}

function main() {
  fs.mkdirSync(targetDir, { recursive: true })
  for (const stale of [`${targetExe}.download`, path.join(targetDir, 'pnpm.exe.download')]) {
    try {
      fs.unlinkSync(stale)
    } catch {
      // ignore missing
    }
  }

  if (looksLikeStandalonePnpm(targetExe)) {
    console.log(`sync-host-tools: keeping existing staged pnpm.exe + dist/`)
    return
  }

  const source = whichPnpmExe()
  if (source) {
    fs.rmSync(targetDir, { recursive: true, force: true })
    fs.mkdirSync(targetDir, { recursive: true })
    fs.copyFileSync(source, targetExe)
    fs.cpSync(path.join(path.dirname(source), 'dist'), path.join(targetDir, 'dist'), {
      recursive: true,
    })
    console.log(`sync-host-tools: staged pnpm.exe + dist/ from ${path.dirname(source)}`)
    return
  }

  stageFromZip()
  const megabytes = (fs.statSync(targetExe).size / (1024 * 1024)).toFixed(1)
  console.log(`sync-host-tools: staged pnpm.exe (${PNPM_VERSION}, ${megabytes} MB) + dist/ into resources/tools/`)
}

try {
  main()
} catch (err) {
  console.error(`sync-host-tools: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
