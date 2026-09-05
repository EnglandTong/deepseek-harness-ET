'use strict'

/**
 * Optional helper LLM for desktop: local OpenAI-compatible sidecar, cloud API
 * helpers, or helpers off — chosen at install time via helper-mode.json.
 */

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { URL } = require('node:url')

const DEFAULT_PORT = 8765
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_MODEL = 'local-default'
const API_KEY_ENV = 'DSH_LOCAL_EDGE_API_KEY'
const API_KEY_VALUE = 'local-edge'
const PROVIDER = 'local-edge'
const PATCH_NAME = 'desktop-helper.patch.yml'
const LEGACY_PATCH_NAME = 'desktop-local-edge.patch.yml'
/** User override written from Settings; outranks install-dir helper-mode.json. */
const HOME_MODE_FILE = 'desktop-helper-mode.json'
/** Last resolved mode written for Settings display (install-dir is not always readable from Host). */
const EFFECTIVE_MODE_FILE = 'desktop-helper-effective.json'

/** @typedef {'cloud' | 'local' | 'off'} HelperMode */

/** @type {import('node:child_process').ChildProcess | null} */
let sidecarChild = null

/**
 * @param {unknown} value
 * @returns {HelperMode | null}
 */
function parseHelperMode(value) {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  if (v === 'cloud' || v === 'local' || v === 'off') return v
  return null
}

/**
 * @param {string} resourcesRoot
 * @param {string} [dshHome]
 * @returns {{ mode: HelperMode, source: 'env' | 'home' | 'install' | 'default' }}
 */
function resolveHelperModeDetail(resourcesRoot, dshHome) {
  const fromEnv = parseHelperMode(process.env.DSH_HELPER_MODE)
  if (fromEnv !== null) return { mode: fromEnv, source: 'env' }

  if (typeof dshHome === 'string' && dshHome.trim() !== '') {
    const homePath = path.join(dshHome, HOME_MODE_FILE)
    if (fs.existsSync(homePath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(homePath, 'utf8'))
        const mode = parseHelperMode(raw.mode)
        if (mode !== null) return { mode, source: 'home' }
      } catch (err) {
        process.stderr.write(
          `helper-mode: invalid ${HOME_MODE_FILE} (${err instanceof Error ? err.message : String(err)})\n`,
        )
      }
    }
  }

  const modePath = path.join(resourcesRoot, 'helper-mode.json')
  if (fs.existsSync(modePath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(modePath, 'utf8'))
      const mode = parseHelperMode(raw.mode)
      if (mode !== null) return { mode, source: 'install' }
    } catch (err) {
      process.stderr.write(
        `helper-mode: invalid helper-mode.json (${err instanceof Error ? err.message : String(err)})\n`,
      )
    }
  }
  return { mode: 'local', source: 'default' }
}

/**
 * @param {string} resourcesRoot
 * @param {string} [dshHome]
 * @returns {HelperMode}
 */
function resolveHelperMode(resourcesRoot, dshHome) {
  return resolveHelperModeDetail(resourcesRoot, dshHome).mode
}

/**
 * @param {string} resourcesRoot
 * @returns {{
 *   enabled: boolean,
 *   host: string,
 *   port: number,
 *   model: string,
 *   bin: string | null,
 *   modelPath: string | null,
 *   args: string[],
 *   healthPath: string,
 * }}
 */
function loadConfig(resourcesRoot) {
  const configPath = path.join(resourcesRoot, 'sidecar', 'config.json')
  /** @type {Record<string, unknown>} */
  let raw = {}
  if (fs.existsSync(configPath)) {
    try {
      raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    } catch (err) {
      process.stderr.write(
        `local-edge sidecar: invalid config.json (${err instanceof Error ? err.message : String(err)})\n`,
      )
    }
  }

  const host = typeof raw.host === 'string' && raw.host.trim() !== '' ? raw.host.trim() : DEFAULT_HOST
  const port = typeof raw.port === 'number' && Number.isFinite(raw.port) ? raw.port : DEFAULT_PORT
  const model = typeof raw.model === 'string' && raw.model.trim() !== '' ? raw.model.trim() : DEFAULT_MODEL
  const healthPath = typeof raw.healthPath === 'string' && raw.healthPath.trim() !== ''
    ? raw.healthPath.trim()
    : '/v1/models'
  const enabled = raw.enabled !== false
  const envBin = process.env.DSH_LOCAL_EDGE_BIN
  const configuredBin = typeof raw.bin === 'string' && raw.bin.trim() !== '' ? raw.bin.trim() : null
  const stagedBin = path.join(resourcesRoot, 'sidecar', 'bin', process.platform === 'win32' ? 'llama-server.exe' : 'llama-server')
  const bin = (typeof envBin === 'string' && envBin.trim() !== '' && fs.existsSync(envBin.trim()))
    ? envBin.trim()
    : (configuredBin !== null && fs.existsSync(configuredBin))
      ? configuredBin
      : (fs.existsSync(stagedBin) ? stagedBin : null)

  const envModelPath = process.env.DSH_LOCAL_EDGE_MODEL_PATH
  const configuredModelPath = typeof raw.modelPath === 'string' && raw.modelPath.trim() !== ''
    ? raw.modelPath.trim()
    : null
  const modelPath = (typeof envModelPath === 'string' && envModelPath.trim() !== '' && fs.existsSync(envModelPath.trim()))
    ? envModelPath.trim()
    : (configuredModelPath !== null && fs.existsSync(configuredModelPath) ? configuredModelPath : null)

  const args = Array.isArray(raw.args)
    ? raw.args.filter((a) => typeof a === 'string')
    : []

  return { enabled, host, port, model, bin, modelPath, args, healthPath }
}

/**
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
function probeUrl(url, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume()
      resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 500)
    })
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      resolve(false)
    })
    req.on('error', () => resolve(false))
  })
}

/**
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
async function waitHealthy(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await probeUrl(url, 1500)) return true
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

/**
 * @param {{ host: string, port: number, modelPath: string | null, args: string[] }} cfg
 * @returns {string[]}
 */
function resolveArgs(cfg) {
  if (cfg.args.length > 0) return [...cfg.args]
  const out = ['--host', cfg.host, '--port', String(cfg.port)]
  if (cfg.modelPath) out.push('-m', cfg.modelPath)
  return out
}

/**
 * @param {string} dshHome
 * @returns {string}
 */
function patchPath(dshHome) {
  return path.join(dshHome, PATCH_NAME)
}

/**
 * @param {string} dshHome
 * @param {{ host: string, port: number, model: string }} cfg
 * @returns {string}
 */
function writeLocalEdgePatch(dshHome, cfg) {
  const baseURL = `http://${cfg.host}:${cfg.port}/v1`
  const body = `# Generated by DSH Desktop (helper mode=local) when the sidecar is healthy.
- id: llm-pi-ai
  config:
    providers:
      ${PROVIDER}:
        displayName: Local edge helper
        apiKeyEnv: ${API_KEY_ENV}
        api: openai-completions
        baseURL: ${JSON.stringify(baseURL)}
        models:
          - id: ${JSON.stringify(cfg.model)}
            name: Local edge helper
            contextWindow: 131072
            maxTokens: 8192
- id: compaction-basic
  config:
    summarizationProvider: ${PROVIDER}
    summarizationModel: ${JSON.stringify(cfg.model)}
- id: input-optimize
  config:
    provider: ${PROVIDER}
    model: ${JSON.stringify(cfg.model)}
    enabled: true
`
  fs.mkdirSync(dshHome, { recursive: true })
  fs.writeFileSync(patchPath(dshHome), body)
  return patchPath(dshHome)
}

/**
 * Enable helpers that follow the Settings-selected chat model (agent-default-model
 * / session selection). DeepSeek cloud remains the product preset via Models UI.
 * Optional env pins: DSH_HELPER_CLOUD_PROVIDER + DSH_HELPER_CLOUD_MODEL.
 * @param {string} dshHome
 * @returns {string}
 */
function writeCloudHelperPatch(dshHome) {
  const pinProvider = process.env.DSH_HELPER_CLOUD_PROVIDER
  const pinModel = process.env.DSH_HELPER_CLOUD_MODEL
  const pinned =
    typeof pinProvider === 'string' && pinProvider.trim() !== ''
    && typeof pinModel === 'string' && pinModel.trim() !== ''

  let body = `# Generated by DSH Desktop (helper mode=cloud).
# Helpers follow the model chosen in Settings (preset: DeepSeek cloud).
# Compaction keeps an empty summarization pair so it reuses the chat route.
`
  if (pinned) {
    body += `- id: compaction-basic
  config:
    summarizationProvider: ${JSON.stringify(pinProvider.trim())}
    summarizationModel: ${JSON.stringify(pinModel.trim())}
- id: input-optimize
  config:
    enabled: true
    provider: ${JSON.stringify(pinProvider.trim())}
    model: ${JSON.stringify(pinModel.trim())}
`
  } else {
    body += `- id: input-optimize
  config:
    enabled: true
    provider: ""
    model: ""
`
  }
  fs.mkdirSync(dshHome, { recursive: true })
  fs.writeFileSync(patchPath(dshHome), body)
  return patchPath(dshHome)
}

/**
 * @param {string} dshHome
 * @param {HelperMode} mode
 * @param {'env' | 'home' | 'install' | 'default'} source
 */
function writeEffectiveMode(dshHome, mode, source) {
  try {
    fs.mkdirSync(dshHome, { recursive: true })
    fs.writeFileSync(
      path.join(dshHome, EFFECTIVE_MODE_FILE),
      `${JSON.stringify({ mode, source }, null, 2)}\n`,
      'utf8',
    )
  } catch {
    // display-only snapshot; soft-fail
  }
}

/**
 * @param {string} dshHome
 */
function clearHelperPatch(dshHome) {
  for (const name of [PATCH_NAME, LEGACY_PATCH_NAME]) {
    const p = path.join(dshHome, name)
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p)
    } catch {
      // best-effort cleanup
    }
  }
}

/**
 * Prepare helper patch / sidecar according to install-time helper mode.
 * @param {{ resourcesRoot: string, dshHome: string }} options
 * @returns {Promise<{
 *   mode: HelperMode,
 *   ready: boolean,
 *   patchPath: string | null,
 *   env: Record<string, string>,
 *   reason?: string,
 * }>}
 */
async function prepareDesktopHelper(options) {
  const detail = resolveHelperModeDetail(options.resourcesRoot, options.dshHome)
  const mode = detail.mode
  writeEffectiveMode(options.dshHome, mode, detail.source)
  const env = /** @type {Record<string, string>} */ ({})

  if (mode === 'off') {
    clearHelperPatch(options.dshHome)
    return { mode, ready: false, patchPath: null, env, reason: 'helpers disabled (install mode=off)' }
  }

  if (mode === 'cloud') {
    const patch = writeCloudHelperPatch(options.dshHome)
    process.stderr.write(`desktop helper: mode=cloud (patch ${patch})\n`)
    return { mode, ready: true, patchPath: patch, env }
  }

  // mode === 'local'
  env[API_KEY_ENV] = API_KEY_VALUE
  const cfg = loadConfig(options.resourcesRoot)
  if (!cfg.enabled) {
    clearHelperPatch(options.dshHome)
    return { mode, ready: false, patchPath: null, env, reason: 'disabled in sidecar/config.json' }
  }

  const healthUrl = new URL(cfg.healthPath, `http://${cfg.host}:${cfg.port}`).href

  if (await probeUrl(healthUrl, 1500)) {
    const patch = writeLocalEdgePatch(options.dshHome, cfg)
    process.stderr.write(`local-edge sidecar: using existing server at ${healthUrl}\n`)
    return { mode, ready: true, patchPath: patch, env }
  }

  if (!cfg.bin) {
    clearHelperPatch(options.dshHome)
    return {
      mode,
      ready: false,
      patchPath: null,
      env,
      reason: 'no sidecar binary (set DSH_LOCAL_EDGE_BIN or stage resources/sidecar/bin/llama-server.exe)',
    }
  }

  if (!cfg.modelPath && cfg.args.length === 0) {
    clearHelperPatch(options.dshHome)
    return {
      mode,
      ready: false,
      patchPath: null,
      env,
      reason: 'no model weights (set DSH_LOCAL_EDGE_MODEL_PATH or sidecar/config.json modelPath); download-on-enable',
    }
  }

  const args = resolveArgs(cfg)
  process.stderr.write(`local-edge sidecar: starting ${cfg.bin} ${args.join(' ')}\n`)
  const child = spawn(cfg.bin, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, ...env },
  })
  sidecarChild = child
  child.stdout?.on('data', (chunk) => process.stderr.write(chunk))
  child.stderr?.on('data', (chunk) => process.stderr.write(chunk))
  child.on('error', (err) => {
    process.stderr.write(`local-edge sidecar: spawn error ${err.message}\n`)
  })
  child.on('exit', (code, signal) => {
    if (sidecarChild === child) sidecarChild = null
    process.stderr.write(`local-edge sidecar: exited code=${code} signal=${signal}\n`)
  })

  const healthy = await waitHealthy(healthUrl, 45_000)
  if (!healthy) {
    stopLocalEdgeSidecar()
    clearHelperPatch(options.dshHome)
    return { mode, ready: false, patchPath: null, env, reason: `sidecar did not become healthy at ${healthUrl}` }
  }

  const patch = writeLocalEdgePatch(options.dshHome, cfg)
  return { mode, ready: true, patchPath: patch, env }
}

function stopLocalEdgeSidecar() {
  if (!sidecarChild || sidecarChild.killed) {
    sidecarChild = null
    return
  }
  try {
    if (process.platform === 'win32' && sidecarChild.pid) {
      spawn('taskkill', ['/pid', String(sidecarChild.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      })
    } else {
      sidecarChild.kill('SIGTERM')
    }
  } catch {
    // best-effort teardown on quit
  }
  sidecarChild = null
}

module.exports = {
  PROVIDER,
  API_KEY_ENV,
  API_KEY_VALUE,
  HOME_MODE_FILE,
  EFFECTIVE_MODE_FILE,
  resolveHelperMode,
  resolveHelperModeDetail,
  prepareDesktopHelper,
  startLocalEdgeSidecar: prepareDesktopHelper,
  stopLocalEdgeSidecar,
  clearLocalEdgePatch: clearHelperPatch,
  clearHelperPatch,
  loadConfig,
}
