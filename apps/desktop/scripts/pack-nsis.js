// Pack NSIS Setup from an isolated staging tree so electron-builder does not
// run workspace `pnpm install --production` (strips Electron, breaks root postinstall).
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const desktopRoot = path.resolve(__dirname, '..')
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-desktop-pack-'))
const outDir = path.join(desktopRoot, 'dist')
const electronPkgDir = path.join(desktopRoot, 'node_modules', 'electron')
const electronDist = path.join(electronPkgDir, 'dist')
const electronBuilderCli = path.join(desktopRoot, 'node_modules', 'electron-builder', 'cli.js')

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    windowsHide: true,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited ${result.status}`)
  }
}

try {
  if (!fs.existsSync(electronDist)) {
    throw new Error(`Electron dist missing at ${electronDist}; run pnpm install in apps/desktop`)
  }
  if (!fs.existsSync(electronBuilderCli)) {
    throw new Error(`electron-builder missing at ${electronBuilderCli}; run pnpm install in apps/desktop`)
  }

  const srcPkg = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'))
  const electronVersion = JSON.parse(
    fs.readFileSync(path.join(electronPkgDir, 'package.json'), 'utf8'),
  ).version
  const stagePkg = {
    name: srcPkg.name,
    version: srcPkg.version,
    private: true,
    description: srcPkg.description,
    author: srcPkg.author,
    main: srcPkg.main,
    build: {
      ...srcPkg.build,
      electronDist,
      electronVersion,
      directories: {
        ...srcPkg.build.directories,
        output: outDir,
      },
      nsis: {
        ...srcPkg.build.nsis,
        include: 'installer/helper-mode.nsh',
      },
    },
  }
  fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify(stagePkg, null, 2) + '\n')
  fs.copyFileSync(path.join(desktopRoot, 'main.js'), path.join(staging, 'main.js'))
  fs.copyFileSync(path.join(desktopRoot, 'sidecar.js'), path.join(staging, 'sidecar.js'))
  fs.cpSync(path.join(desktopRoot, 'installer'), path.join(staging, 'installer'), { recursive: true })
  for (const name of ['runtime', 'tools', 'bootstrap', 'sidecar']) {
    const from = path.join(desktopRoot, 'resources', name)
    if (!fs.existsSync(from)) {
      if (name === 'sidecar') {
        fs.mkdirSync(path.join(staging, 'resources', 'sidecar'), { recursive: true })
        continue
      }
      throw new Error(`pack-nsis: missing resources/${name}; run sync-pack first`)
    }
    fs.cpSync(from, path.join(staging, 'resources', name), { recursive: true })
  }
  const notices = path.join(desktopRoot, 'resources', 'THIRD_PARTY_NOTICES.md')
  if (fs.existsSync(notices)) {
    fs.mkdirSync(path.join(staging, 'resources'), { recursive: true })
    fs.copyFileSync(notices, path.join(staging, 'resources', 'THIRD_PARTY_NOTICES.md'))
  }

  console.log(`pack-nsis: staging at ${staging}`)
  fs.mkdirSync(outDir, { recursive: true })
  run(process.execPath, [electronBuilderCli, '--win', 'nsis', '--x64', '--project', staging], desktopRoot, {
    ...process.env,
    CI: 'true',
  })
  console.log(`pack-nsis: wrote installer under ${outDir}`)
} finally {
  fs.rmSync(staging, { recursive: true, force: true })
}
