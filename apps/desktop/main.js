'use strict'

/**
 * Thin product desktop: spawn `dsh web --no-open`, wait for its printed URL,
 * open that URL in a BrowserWindow. Packaged builds use the bundled
 * sdk-runtime exe and prepend bundled pnpm to PATH for plugin import.
 * Checkout `pnpm start` falls back to system Node + apps/cli when no staged
 * runtime is present. Optionally starts a local OpenAI-compatible sidecar and
 * passes `--patch` when that helper is healthy (soft-fail otherwise).
 */

const { app, BrowserWindow, dialog } = require('electron')
const { spawn, spawnSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')
const {
  prepareDesktopHelper,
  stopLocalEdgeSidecar,
  clearHelperPatch,
} = require('./sidecar.js')

const repoRoot = path.resolve(__dirname, '..', '..')
const cliBin = path.join(repoRoot, 'apps', 'cli', 'lib', 'bin.js')
const RUNTIME_EXE = 'deepseek-harness-sdk-runtime-win-x64.exe'
const WEB_URL_RE = /dsh web:\s*(https?:\/\/\S+)/i
const BOOTSTRAP_MARKER = 'desktop-bootstrap-plugins.done'

/** @type {import('node:child_process').ChildProcess | null} */
let webChild = null
/** @type {BrowserWindow | null} */
let mainWindow = null
let quitting = false
/** @type {string | null} */
let helperPatchPath = null

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

function fail(title, message) {
  dialog.showErrorBox(title, message)
  app.quit()
}

function waitForUrl(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = ''
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for dsh web URL`))
    }, timeoutMs)

    const onData = (chunk) => {
      const text = String(chunk)
      process.stderr.write(text)
      buf += text
      const m = buf.match(WEB_URL_RE)
      if (m) {
        cleanup()
        resolve(m[1].replace(/[),.;]+$/, ''))
      }
    }
    const onExit = (code, signal) => {
      cleanup()
      reject(new Error(`dsh web exited before ready (code=${code} signal=${signal})`))
    }
    const cleanup = () => {
      clearTimeout(timer)
      child.stdout?.off('data', onData)
      child.stderr?.off('data', onData)
      child.off('exit', onExit)
    }

    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('exit', onExit)
  })
}

function probe(url, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume()
      resolve(true)
    })
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      resolve(false)
    })
    req.on('error', () => resolve(false))
  })
}

async function waitUntilReachable(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await probe(url, 1500)) return
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error(`URL not reachable: ${url}`)
}

function resourcesRoot() {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, 'resources')
}

function bundledRuntimePath() {
  return path.join(resourcesRoot(), 'runtime', RUNTIME_EXE)
}

function checkoutRuntimePath() {
  return path.join(__dirname, 'resources', 'runtime', RUNTIME_EXE)
}

function bundledPnpmDir() {
  return path.join(resourcesRoot(), 'tools')
}

/**
 * @param {string | null} patchPath
 * @returns {{ command: string, args: string[], cwd: string }}
 */
function resolveLaunch(patchPath) {
  const patchArgs = patchPath ? ['--patch', patchPath] : []
  if (app.isPackaged) {
    const exe = bundledRuntimePath()
    if (!fs.existsSync(exe)) {
      throw new Error(`Missing bundled runtime: ${exe}`)
    }
    return { command: exe, args: ['web', '--no-open', ...patchArgs], cwd: path.dirname(exe) }
  }

  const localExe = checkoutRuntimePath()
  if (fs.existsSync(localExe)) {
    return { command: localExe, args: ['web', '--no-open', ...patchArgs], cwd: path.dirname(localExe) }
  }

  if (!fs.existsSync(cliBin)) {
    throw new Error(
      `Missing ${cliBin}. From the repo root run: pnpm install && pnpm run build` +
        `\nOr stage a runtime: pnpm run sync-runtime`,
    )
  }
  const nodeBin = process.env.DSH_RUNTIME_NODE || 'node'
  return { command: nodeBin, args: [cliBin, 'web', '--no-open', ...patchArgs], cwd: repoRoot }
}

function ensureDshHome() {
  if (process.env.DSH_HOME && process.env.DSH_HOME.trim() !== '') {
    return process.env.DSH_HOME
  }
  const home = path.join(app.getPath('home'), '.dsh')
  fs.mkdirSync(home, { recursive: true })
  return home
}

/**
 * @param {string} dshHome
 * @param {Record<string, string>} [extraEnv]
 */
function buildChildEnv(dshHome, extraEnv) {
  const env = {
    ...process.env,
    DSH_HOME: dshHome,
    ...(extraEnv ?? {}),
  }
  const tools = bundledPnpmDir()
  const pnpmExe = path.join(tools, 'pnpm.exe')
  if (fs.existsSync(pnpmExe)) {
    env.PATH = `${tools}${path.delimiter}${env.PATH || ''}`
  }
  return env
}

/**
 * @param {{ patchPath: string | null, extraEnv?: Record<string, string> }} options
 */
function startWeb(options) {
  const launch = resolveLaunch(options.patchPath)
  const dshHome = ensureDshHome()
  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: buildChildEnv(dshHome, options.extraEnv),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.on('error', (err) => {
    if (!quitting) fail('Failed to start dsh web', err.message)
  })
  return child
}

function stopWeb() {
  if (!webChild || webChild.killed) return
  try {
    if (process.platform === 'win32' && webChild.pid) {
      spawn('taskkill', ['/pid', String(webChild.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      })
    } else {
      webChild.kill('SIGTERM')
    }
  } catch {
    // best-effort process-tree teardown on quit
  }
  webChild = null
}

function resolveRuntimeCommand() {
  if (app.isPackaged) return bundledRuntimePath()
  const local = checkoutRuntimePath()
  if (fs.existsSync(local)) return local
  return null
}

/**
 * First packaged launch: install optional bootstrap plugin specs into the web
 * profile via the bundled runtime + bundled pnpm.
 */
function runBootstrapPlugins() {
  if (!app.isPackaged) return
  const dshHome = ensureDshHome()
  const marker = path.join(dshHome, BOOTSTRAP_MARKER)
  if (fs.existsSync(marker)) return

  const manifestPath = path.join(resourcesRoot(), 'bootstrap', 'plugins.json')
  if (!fs.existsSync(manifestPath)) {
    fs.writeFileSync(marker, `${new Date().toISOString()}\nskip: missing manifest\n`)
    return
  }

  let specs = []
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    specs = Array.isArray(raw.plugins) ? raw.plugins.filter((s) => typeof s === 'string' && s.trim()) : []
  } catch (err) {
    fs.writeFileSync(
      marker,
      `${new Date().toISOString()}\nerror: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return
  }

  if (specs.length === 0) {
    fs.writeFileSync(marker, `${new Date().toISOString()}\nskip: empty plugins list\n`)
    return
  }

  const runtime = resolveRuntimeCommand()
  const pnpmExe = path.join(bundledPnpmDir(), 'pnpm.exe')
  if (!runtime || !fs.existsSync(runtime)) {
    fs.writeFileSync(marker, `${new Date().toISOString()}\nerror: missing runtime for bootstrap\n`)
    return
  }
  if (!fs.existsSync(pnpmExe)) {
    fs.writeFileSync(marker, `${new Date().toISOString()}\nerror: missing bundled pnpm.exe\n`)
    return
  }

  const lines = [`${new Date().toISOString()}`, `runtime=${runtime}`, `pnpm=${pnpmExe}`]
  for (const spec of specs) {
    const result = spawnSync(runtime, ['plugin', '--profile', 'web', 'add', spec], {
      env: buildChildEnv(dshHome),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 600_000,
    })
    lines.push(
      `--- add ${spec} exit=${result.status}`,
      String(result.stdout || '').trim(),
      String(result.stderr || '').trim(),
    )
  }
  fs.writeFileSync(marker, `${lines.join('\n')}\n`)
}

function createWindow(url) {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    title: 'DSH Desktop',
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.loadURL(url)
  win.on('closed', () => {
    mainWindow = null
    if (!quitting) app.quit()
  })
  return win
}

function showSplash(message) {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    title: 'DSH Desktop',
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  const body = String(message)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  win.loadURL(
    'data:text/html;charset=utf-8,' +
      encodeURIComponent(
        `<!doctype html><html><head><meta charset="utf-8"><title>DSH Desktop</title>
<style>
html,body{height:100%;margin:0;font-family:Segoe UI,sans-serif;background:#0f1419;color:#e7ecf1}
main{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center}
h1{font-size:20px;font-weight:600;margin:0;letter-spacing:0.04em}
p{margin:0;opacity:0.75;max-width:36rem;line-height:1.45}
</style></head><body><main><h1>DSH Desktop</h1><p>${body}</p></main></body></html>`,
      ),
  )
  win.on('closed', () => {
    mainWindow = null
    if (!quitting) app.quit()
  })
  return win
}

/**
 * Fresh DSH_HOME needs `dsh plugin --profile web install` before `dsh web`
 * can resolve profile bundles. Packaged launches run that once when the web
 * profile directory has not been initialized. Bundle packages themselves come
 * from the bundled runtime installation, not from profile node_modules.
 */
function ensureWebProfile(dshHome) {
  if (!app.isPackaged) return
  const webManifest = path.join(dshHome, 'profiles', 'web', 'package.json')
  if (fs.existsSync(webManifest)) return

  const runtime = resolveRuntimeCommand()
  if (!runtime || !fs.existsSync(runtime)) {
    throw new Error('Missing bundled runtime for web profile install')
  }
  if (mainWindow) {
    mainWindow.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          `<!doctype html><html><head><meta charset="utf-8"><title>DSH Desktop</title>
<style>html,body{height:100%;margin:0;font-family:Segoe UI,sans-serif;background:#0f1419;color:#e7ecf1}
main{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center}
h1{font-size:20px;font-weight:600;margin:0}p{margin:0;opacity:0.75;max-width:36rem;line-height:1.45}</style>
</head><body><main><h1>DSH Desktop</h1><p>First launch: installing the web profile (this can take a few minutes)…</p></main></body></html>`,
        ),
    )
  }
  const result = spawnSync(runtime, ['plugin', '--profile', 'web', 'install'], {
    env: buildChildEnv(dshHome),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 900_000,
  })
  if (result.status !== 0) {
    throw new Error(
      `web profile install failed (exit ${result.status}):\n` +
        `${String(result.stderr || result.stdout || '').trim() || 'no output'}`,
    )
  }
}

if (gotLock) {
  app.whenReady().then(async () => {
    try {
      mainWindow = showSplash('Starting DSH Web…')
      const dshHome = ensureDshHome()
      try {
        ensureWebProfile(dshHome)
      } catch (profileErr) {
        throw new Error(
          `Could not prepare the web profile: ${
            profileErr instanceof Error ? profileErr.message : String(profileErr)
          }`,
        )
      }
      try {
        runBootstrapPlugins()
      } catch (bootErr) {
        process.stderr.write(
          `bootstrap plugins: ${bootErr instanceof Error ? bootErr.message : String(bootErr)}\n`,
        )
      }
      if (mainWindow) {
        mainWindow.loadURL(
          'data:text/html;charset=utf-8,' +
            encodeURIComponent(
              `<!doctype html><html><head><meta charset="utf-8"><title>DSH Desktop</title>
<style>html,body{height:100%;margin:0;font-family:Segoe UI,sans-serif;background:#0f1419;color:#e7ecf1}
main{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center}
h1{font-size:20px;font-weight:600;margin:0}p{margin:0;opacity:0.75;max-width:36rem;line-height:1.45}</style>
</head><body><main><h1>DSH Desktop</h1><p>Preparing helper mode (optional)…</p></main></body></html>`,
            ),
        )
      }
      let sidecarEnv = /** @type {Record<string, string>} */ ({})
      try {
        const helper = await prepareDesktopHelper({
          resourcesRoot: resourcesRoot(),
          dshHome,
        })
        helperPatchPath = helper.patchPath
        sidecarEnv = helper.env
        if (!helper.ready) {
          process.stderr.write(
            `desktop helper: mode=${helper.mode}; unavailable (${helper.reason ?? 'unknown'}); continuing without helper patch\n`,
          )
        } else {
          process.stderr.write(`desktop helper: mode=${helper.mode}; patch ready\n`)
        }
      } catch (sidecarErr) {
        clearHelperPatch(dshHome)
        helperPatchPath = null
        process.stderr.write(
          `desktop helper: ${sidecarErr instanceof Error ? sidecarErr.message : String(sidecarErr)}\n`,
        )
      }
      if (mainWindow) {
        mainWindow.loadURL(
          'data:text/html;charset=utf-8,' +
            encodeURIComponent(
              `<!doctype html><html><head><meta charset="utf-8"><title>DSH Desktop</title>
<style>html,body{height:100%;margin:0;font-family:Segoe UI,sans-serif;background:#0f1419;color:#e7ecf1}
main{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center}
h1{font-size:20px;font-weight:600;margin:0}p{margin:0;opacity:0.75;max-width:36rem;line-height:1.45}</style>
</head><body><main><h1>DSH Desktop</h1><p>Starting DSH Web…</p></main></body></html>`,
            ),
        )
      }
      webChild = startWeb({ patchPath: helperPatchPath, extraEnv: sidecarEnv })
      const url = await waitForUrl(webChild, 180_000)
      await waitUntilReachable(url, 60_000)
      if (mainWindow && !mainWindow.isDestroyed()) {
        await mainWindow.loadURL(url)
      } else {
        mainWindow = createWindow(url)
      }
    } catch (err) {
      stopWeb()
      stopLocalEdgeSidecar()
      fail(
        'Could not open DSH Web',
        `${err instanceof Error ? err.message : String(err)}\n\n` +
          'Installed build: reinstall with `pnpm run dist:installer`, or check `%USERPROFILE%\\.dsh`.\n' +
          'Checkout: `pnpm install` + `pnpm run build`, optional `pnpm run sync-pack`, and DEEPSEEK_API_KEY in the environment or `%USERPROFILE%\\.dsh\\.env`.',
      )
    }
  })

  app.on('before-quit', () => {
    quitting = true
    stopWeb()
    stopLocalEdgeSidecar()
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}
