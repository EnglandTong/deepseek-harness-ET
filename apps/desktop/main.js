'use strict'

/**
 * Thin product desktop: spawn `dsh web --no-open`, wait for its printed URL,
 * open that URL in a BrowserWindow. No Studio UI.
 */

const { app, BrowserWindow, dialog } = require('electron')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')

const repoRoot = path.resolve(__dirname, '..', '..')
const cliBin = path.join(repoRoot, 'apps', 'cli', 'lib', 'bin.js')
const WEB_URL_RE = /dsh web:\s*(https?:\/\/\S+)/i

/** @type {import('node:child_process').ChildProcess | null} */
let webChild = null
/** @type {BrowserWindow | null} */
let mainWindow = null
let quitting = false

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

function startWeb() {
  if (!fs.existsSync(cliBin)) {
    throw new Error(
      `Missing ${cliBin}. From the repo root run: pnpm install && pnpm run build`,
    )
  }
  // Electron's embedded Node (20.x) is too old for the runtime; spawn the
  // system Node (>= 22.19, the repo engines) or a DSH_RUNTIME_NODE override.
  const nodeBin = process.env.DSH_RUNTIME_NODE || 'node'
  const child = spawn(nodeBin, [cliBin, 'web', '--no-open'], {
    cwd: repoRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.on('error', (err) => {
    if (!quitting) fail('Failed to start dsh web', err.message)
  })
  return child
}

function createWindow(url) {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    title: 'DSH',
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
    // best-effort
  }
  webChild = null
}

app.whenReady().then(async () => {
  try {
    webChild = startWeb()
    const url = await waitForUrl(webChild, 120_000)
    await waitUntilReachable(url, 30_000)
    mainWindow = createWindow(url)
  } catch (err) {
    stopWeb()
    fail(
      'Could not open DSH Web',
      `${err instanceof Error ? err.message : String(err)}\n\n` +
        'Check: repo root `pnpm install` + `pnpm run build`, and DEEPSEEK_API_KEY in `.env` or the environment.',
    )
  }
})

app.on('before-quit', () => {
  quitting = true
  stopWeb()
})

app.on('window-all-closed', () => {
  app.quit()
})
