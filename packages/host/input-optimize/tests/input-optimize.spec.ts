import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import InputOptimizeGateway, {
  DESKTOP_HELPER_EFFECTIVE_FILE,
  DESKTOP_HELPER_MODE_FILE,
} from '../src/index.ts'

async function withTempHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-helper-mode-'))
  const prevHome = process.env.DSH_HOME
  const prevMode = process.env.DSH_HELPER_MODE
  const prevStt = process.env.DSH_LOCAL_STT_BIN
  delete process.env.DSH_HELPER_MODE
  delete process.env.DSH_LOCAL_STT_BIN
  process.env.DSH_HOME = home
  try {
    return await fn(home)
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
    if (prevMode === undefined) delete process.env.DSH_HELPER_MODE
    else process.env.DSH_HELPER_MODE = prevMode
    if (prevStt === undefined) delete process.env.DSH_LOCAL_STT_BIN
    else process.env.DSH_LOCAL_STT_BIN = prevStt
    await rm(home, { recursive: true, force: true })
  }
}

/** Write a Node STT stub that honors `--input` and `STT_MODE`. */
async function writeSttStub(dir: string): Promise<string> {
  const scriptPath = join(dir, 'fake-stt.mjs')
  const launcherPath = join(dir, process.platform === 'win32' ? 'fake-stt.cmd' : 'fake-stt.sh')
  await writeFile(
    scriptPath,
    [
      'const mode = process.env.STT_MODE ?? "ok"',
      'if (mode === "empty") { process.stdout.write("   \\n"); process.exit(0) }',
      'if (mode === "fail") { process.stderr.write("stt boom"); process.exit(2) }',
      'if (mode === "wait") { setInterval(() => {}, 1 << 30) }',
      'else { process.stdout.write("clean transcript") }',
      '',
    ].join('\n'),
    'utf8',
  )
  if (process.platform === 'win32') {
    await writeFile(
      launcherPath,
      `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`,
      'utf8',
    )
  } else {
    await writeFile(
      launcherPath,
      `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`,
      { encoding: 'utf8', mode: 0o755 },
    )
  }
  return launcherPath
}

describe('InputOptimizeGateway', () => {
  afterEach(() => {
    delete process.env.DSH_LOCAL_STT_BIN
  })

  it('publishes Remote methods and reports disabled status', async () => {
    const ctx = new Context()
    await ctx.plugin(InputOptimizeGateway, { enabled: false })
    const gateway = ctx.get('inputOptimize') as InputOptimizeGateway
    expect(gateway.typertRemote).toMatchObject({
      serviceKey: 'inputOptimize',
      namespace: 'inputOptimize',
    })
    expect(remoteMethods(gateway).map(method => method.method).sort()).toEqual([
      'helperMode',
      'optimizeText',
      'setHelperMode',
      'status',
      'transcribe',
    ])
    expect(gateway.status()).toMatchObject({
      optimizeAvailable: false,
      sttAvailable: false,
      reason: 'disabled',
    })
    await ctx.fiber.dispose()
  })

  it('applies constructor defaults when config fields are omitted', async () => {
    const ctx = new Context()
    const gateway = new InputOptimizeGateway(ctx, {})
    expect(gateway.status()).toMatchObject({
      optimizeAvailable: false,
      reason: 'disabled',
    })
  })

  it('refuses optimizeText when disabled', async () => {
    const ctx = new Context()
    await ctx.plugin(InputOptimizeGateway, { enabled: false })
    const gateway = ctx.get('inputOptimize') as InputOptimizeGateway
    await expect(gateway.optimizeText('hello')).rejects.toMatchObject({
      code: 'input-optimize/unavailable',
    })
    await ctx.fiber.dispose()
  })

  it('reports llm missing and missing provider/model from status', async () => {
    const ctx = new Context()
    await ctx.plugin(InputOptimizeGateway, { enabled: true, provider: '', model: '' })
    const gateway = ctx.get('inputOptimize') as InputOptimizeGateway
    expect(gateway.status()).toMatchObject({
      optimizeAvailable: false,
      reason: 'llm missing',
    })
    await expect(gateway.optimizeText('hello')).rejects.toMatchObject({
      code: 'input-optimize/unavailable',
      details: { reason: 'llm missing' },
    })
    ctx.provide('llm', { stream: async function* () { /* unused */ } })
    expect(gateway.status()).toMatchObject({
      optimizeAvailable: false,
      reason: 'missing provider/model',
    })
    await expect(gateway.optimizeText('hello')).rejects.toMatchObject({
      code: 'input-optimize/unavailable',
      details: { reason: 'missing provider/model' },
    })
    await ctx.fiber.dispose()
  })

  it('follows agentDefaultModel when provider/model config is empty', async () => {
    const ctx = new Context()
    ctx.provide('llm', { stream: async function* () { /* unused */ } })
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
    })
    await ctx.plugin(InputOptimizeGateway, { enabled: true, provider: '', model: '' })
    const gateway = ctx.get('inputOptimize') as InputOptimizeGateway
    expect(gateway.status()).toMatchObject({
      optimizeAvailable: true,
      provider: 'deepseek-official',
      model: 'deepseek-chat',
      reason: null,
    })
    await ctx.fiber.dispose()
  })

  it('uses configured provider/model and STT bin from config', async () => {
    await withTempHome(async (home) => {
      const stt = await writeSttStub(home)
      const ctx = new Context()
      ctx.provide('llm', { stream: async function* () { /* unused */ } })
      await ctx.plugin(InputOptimizeGateway, {
        enabled: true,
        provider: 'local-edge',
        model: 'local-default',
        sttBin: stt,
      })
      const gateway = ctx.get('inputOptimize') as InputOptimizeGateway
      expect(gateway.status()).toMatchObject({
        optimizeAvailable: true,
        sttAvailable: true,
        provider: 'local-edge',
        model: 'local-default',
      })
      await ctx.fiber.dispose()
    })
  })

  it('prefers DSH_LOCAL_STT_BIN over config sttBin', async () => {
    await withTempHome(async (home) => {
      const stt = await writeSttStub(home)
      process.env.DSH_LOCAL_STT_BIN = `  ${stt}  `
      const ctx = new Context()
      await ctx.plugin(InputOptimizeGateway, { enabled: false, sttBin: '/missing' })
      const gateway = ctx.get('inputOptimize') as InputOptimizeGateway
      expect(gateway.status().sttAvailable).toBe(true)
      await ctx.fiber.dispose()
    })
  })

  it('optimizes text through llm.stream', async () => {
    const ctx = new Context()
    ctx.provide('llm', {
      stream: async function* () {
        yield { type: 'text-delta', index: 0, text: ' cleaned ' }
        yield { type: 'finish', reason: { kind: 'stop' as const } }
      },
    })
    await ctx.plugin(InputOptimizeGateway, {
      enabled: true,
      provider: 'local-edge',
      model: 'local-default',
      maxTokens: 128,
    })
    const gateway = ctx.get('inputOptimize') as InputOptimizeGateway
    await expect(gateway.optimizeText('  draft  ')).resolves.toMatchObject({
      text: 'cleaned',
      provider: 'local-edge',
      model: 'local-default',
    })
    await expect(gateway.optimizeText('   ')).rejects.toMatchObject({
      code: 'input-optimize/empty',
    })
    await ctx.fiber.dispose()
  })

  it('honors abort signal during optimizeText', async () => {
    const ctx = new Context()
    ctx.provide('llm', {
      stream: async function* (options: { signal?: AbortSignal }) {
        expect(options.signal).toBeInstanceOf(AbortSignal)
        yield { type: 'text-delta', index: 0, text: 'ok' }
        yield { type: 'finish', reason: { kind: 'stop' as const } }
      },
    })
    await ctx.plugin(InputOptimizeGateway, {
      enabled: true,
      provider: 'local-edge',
      model: 'local-default',
    })
    const gateway = ctx.get('inputOptimize') as InputOptimizeGateway
    const live = new AbortController()
    await expect(gateway.optimizeText('draft', live.signal)).resolves.toMatchObject({
      text: 'ok',
    })
    const ac = new AbortController()
    ac.abort()
    await expect(gateway.optimizeText('draft', ac.signal)).rejects.toThrow()
    await ctx.fiber.dispose()
  })

  it('rejects optimizeText when the helper finishes with error, aborted, or empty text', async () => {
    const ctx = new Context()
    let mode: 'error' | 'aborted' | 'empty' = 'error'
    ctx.provide('llm', {
      stream: async function* () {
        if (mode === 'error') {
          yield {
            type: 'finish',
            reason: {
              kind: 'error' as const,
              failure: { message: 'upstream failed', code: 'UNKNOWN' as const },
            },
          }
          return
        }
        if (mode === 'aborted') {
          yield {
            type: 'finish',
            reason: {
              kind: 'aborted' as const,
              failure: { message: 'aborted mid-stream', code: 'ABORTED' as const },
            },
          }
          return
        }
        yield { type: 'finish', reason: { kind: 'stop' as const } }
      },
    })
    await ctx.plugin(InputOptimizeGateway, {
      enabled: true,
      provider: 'local-edge',
      model: 'local-default',
    })
    const gateway = ctx.get('inputOptimize') as InputOptimizeGateway
    await expect(gateway.optimizeText('draft')).rejects.toMatchObject({
      code: 'input-optimize/unavailable',
      details: { reason: 'upstream failed' },
    })
    mode = 'aborted'
    await expect(gateway.optimizeText('draft')).rejects.toMatchObject({
      code: 'input-optimize/unavailable',
      details: { reason: 'aborted mid-stream' },
    })
    mode = 'empty'
    await expect(gateway.optimizeText('draft')).rejects.toMatchObject({
      code: 'input-optimize/empty',
    })
    await ctx.fiber.dispose()
  })

  it('writes and reads home helper mode override', async () => {
    await withTempHome(async () => {
      const ctx = new Context()
      await ctx.plugin(InputOptimizeGateway, { enabled: false })
      const gateway = ctx.get('inputOptimize') as InputOptimizeGateway
      await expect(gateway.setHelperMode('cloud')).resolves.toMatchObject({
        mode: 'cloud',
        restartRequired: true,
      })
      await expect(gateway.helperMode()).resolves.toMatchObject({
        mode: 'cloud',
        source: 'home',
        envLocked: false,
      })
      await expect(gateway.setHelperMode('nope')).rejects.toMatchObject({
        code: 'input-optimize/bad-mode',
      })
      await ctx.fiber.dispose()
    })
  })

  it('resolves helper mode from env, effective snapshot, and default', async () => {
    await withTempHome(async (home) => {
      const ctx = new Context()
      await ctx.plugin(InputOptimizeGateway, { enabled: false })
      const gateway = ctx.get('inputOptimize') as InputOptimizeGateway

      await expect(gateway.helperMode()).resolves.toMatchObject({
        mode: 'local',
        source: 'default',
        envLocked: false,
      })

      await writeFile(join(home, DESKTOP_HELPER_MODE_FILE), '{not-json', 'utf8')
      await writeFile(
        join(home, DESKTOP_HELPER_EFFECTIVE_FILE),
        `${JSON.stringify({ mode: 'off', source: 'install' })}\n`,
        'utf8',
      )
      await expect(gateway.helperMode()).resolves.toMatchObject({
        mode: 'off',
        source: 'install',
        envLocked: false,
      })

      await writeFile(
        join(home, DESKTOP_HELPER_MODE_FILE),
        `${JSON.stringify({ mode: 'nope' })}\n`,
        'utf8',
      )
      await writeFile(
        join(home, DESKTOP_HELPER_EFFECTIVE_FILE),
        `${JSON.stringify({ mode: 'also-nope' })}\n`,
        'utf8',
      )
      await expect(gateway.helperMode()).resolves.toMatchObject({
        mode: 'local',
        source: 'default',
      })

      await writeFile(
        join(home, DESKTOP_HELPER_EFFECTIVE_FILE),
        `${JSON.stringify({ mode: 'cloud', source: 'weird' })}\n`,
        'utf8',
      )
      await expect(gateway.helperMode()).resolves.toMatchObject({
        mode: 'cloud',
        source: 'install',
      })

      await writeFile(join(home, DESKTOP_HELPER_EFFECTIVE_FILE), '{broken', 'utf8')
      await expect(gateway.helperMode()).resolves.toMatchObject({
        mode: 'local',
        source: 'default',
      })

      process.env.DSH_HELPER_MODE = 'local'
      await expect(gateway.helperMode()).resolves.toMatchObject({
        mode: 'local',
        source: 'env',
        envLocked: true,
      })
      await expect(gateway.setHelperMode('cloud')).rejects.toMatchObject({
        code: 'input-optimize/unavailable',
        details: { reason: 'env locked' },
      })
      await ctx.fiber.dispose()
    })
  })

  it('transcribes audio through the local STT stub', async () => {
    await withTempHome(async (home) => {
      const stt = await writeSttStub(home)
      const ctx = new Context()
      await ctx.plugin(InputOptimizeGateway, { enabled: false, sttBin: stt })
      const gateway = ctx.get('inputOptimize') as InputOptimizeGateway
      const audio = Buffer.from('fake-audio').toString('base64')
      await expect(gateway.transcribe(audio, 'audio/webm')).resolves.toEqual({
        text: 'clean transcript',
      })
      await expect(gateway.transcribe(audio, 'audio/wav')).resolves.toEqual({
        text: 'clean transcript',
      })
      await expect(gateway.transcribe(audio, 'audio/mp4')).resolves.toEqual({
        text: 'clean transcript',
      })
      await ctx.fiber.dispose()
    })
  })

  it('rejects transcribe when STT is missing, empty, or fails', async () => {
    await withTempHome(async (home) => {
      const stt = await writeSttStub(home)
      const ctx = new Context()
      await ctx.plugin(InputOptimizeGateway, { enabled: false })
      const gateway = ctx.get('inputOptimize') as InputOptimizeGateway
      await expect(gateway.transcribe('YQ==', 'audio/webm')).rejects.toMatchObject({
        code: 'input-optimize/stt-unavailable',
      })

      process.env.DSH_LOCAL_STT_BIN = stt
      process.env.STT_MODE = 'empty'
      await expect(gateway.transcribe('YQ==', 'audio/webm')).rejects.toMatchObject({
        code: 'input-optimize/empty',
      })

      process.env.STT_MODE = 'fail'
      await expect(gateway.transcribe('YQ==', 'audio/webm')).rejects.toMatchObject({
        code: 'input-optimize/stt-unavailable',
      })

      process.env.DSH_LOCAL_STT_BIN = join(home, 'missing-stt-bin')
      await expect(gateway.transcribe('YQ==', 'audio/webm')).rejects.toMatchObject({
        code: 'input-optimize/stt-unavailable',
      })
      delete process.env.STT_MODE
      await ctx.fiber.dispose()
    })
  })

  it('aborts an in-flight STT process', async () => {
    await withTempHome(async (home) => {
      const stt = await writeSttStub(home)
      process.env.DSH_LOCAL_STT_BIN = stt
      process.env.STT_MODE = 'wait'
      const ctx = new Context()
      await ctx.plugin(InputOptimizeGateway, { enabled: false })
      const gateway = ctx.get('inputOptimize') as InputOptimizeGateway
      const ac = new AbortController()
      const pending = gateway.transcribe('YQ==', 'audio/webm', ac.signal)
      setTimeout(() => ac.abort(), 50)
      await expect(pending).rejects.toMatchObject({
        code: 'gateway/cancelled',
      })
      delete process.env.STT_MODE
      await ctx.fiber.dispose()
    })
  })
})
