import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  SUPERVISOR_EVENT_VERSION,
  SupervisorProjectId,
  SupervisorService,
} from '@deepseek-ai/dsh-supervisor'
import {
  ProjectPathUnavailableError,
  SupervisorProjectRegistry,
} from '../src/index.ts'

async function directory(name: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), `dsh-supervisor-${name}-`))
}

describe('SupervisorProjectRegistry', () => {
  it('discovers only immediate children and does not enroll them', async () => {
    const root = await directory('discover')
    const project = join(root, 'project-a')
    const nested = join(project, 'nested')
    await mkdir(nested, { recursive: true })
    await writeFile(join(nested, 'ignored.txt'), 'content')
    const registry = new SupervisorProjectRegistry(new Context())

    const candidates = await registry.suggestProjects({ roots: [root] })

    expect(candidates.map(candidate => candidate.displayName)).toEqual(['project-a'])
    expect(candidates[0]?.kind).toBe('directory')
    expect(registry.list()).toEqual([])
  })

  it('canonicalizes aliases and returns one registration', async () => {
    const root = await directory('alias')
    const alias = join(root, 'alias')
    const target = join(root, 'target')
    await mkdir(target)
    await symlink(target, alias, 'junction')
    const registry = new SupervisorProjectRegistry(new Context())

    const first = await registry.registerProject(target, 'Target')
    const second = await registry.registerProject(alias, 'Alias must not rename')

    expect(second.id).toBe(first.id)
    expect(second.realPath).toBe(first.realPath)
    expect(second.displayName).toBe('Target')
    const candidate = (await registry.suggestProjects({ roots: [root] })).find(item => item.displayName === 'alias')
    expect(candidate?.registeredProjectId).toBe(first.id)
  })

  it('dedupes a real path that the central ledger restored after construction', async () => {
    const project = await directory('restored')
    const ctx = new Context()
    new SupervisorService(ctx)
    const registry = new SupervisorProjectRegistry(ctx)
    // The controller ledger replay lands after registry construction, so the
    // restored registration must still own its real path.
    ctx.emit('supervisor/project', { type: 'supervisor/project' as const, version: SUPERVISOR_EVENT_VERSION, snapshot: {
      id: SupervisorProjectId('project-restored'), revision: 1, displayName: 'Restored', realPath: project, status: 'registered' as const, registeredAt: '2026-01-01T00:00:00Z',
    } })

    const again = await registry.registerProject(project, 'Again')

    expect(again.id).toBe('project-restored')
    expect(again.displayName).toBe('Restored')
    expect(registry.list()).toHaveLength(1)
  })

  it('serializes canonicalization and registration so one realpath has one owner', async () => {
    const project = await directory('concurrent')
    const registry = new SupervisorProjectRegistry(new Context())

    const registrations = await Promise.all([
      registry.registerProject(project, 'first'),
      registry.registerProject(project, 'second'),
    ])

    expect(registrations[0]?.id).toBe(registrations[1]?.id)
    expect(registry.list()).toHaveLength(1)
  })

  it('reports links and linked worktrees using metadata only', async () => {
    const root = await directory('metadata')
    const worktree = join(root, 'worktree')
    const link = join(root, 'link')
    await mkdir(worktree)
    await writeFile(join(worktree, '.git'), 'gitdir: ../main/.git/worktrees/worktree\n')
    await symlink(worktree, link, 'junction')
    const registry = new SupervisorProjectRegistry(new Context())

    const candidates = await registry.suggestProjects({ roots: [root] })
    const worktreeCandidate = candidates.find(item => item.displayName === 'worktree')
    const linkCandidate = candidates.find(item => item.displayName === 'link')
    expect(worktreeCandidate?.isWorktree).toBe(true)
    expect(linkCandidate?.kind).toMatch(/symlink|junction/)
    expect(linkCandidate?.isWorktree).toBe(true)
  })

  it('returns missing candidates and refuses to register them', async () => {
    const root = await directory('missing')
    const missing = join(root, 'gone')
    const registry = new SupervisorProjectRegistry(new Context())

    const candidates = await registry.suggestProjects({ roots: [missing] })

    expect(candidates[0]).toMatchObject({ kind: 'missing', path: missing })
    await expect(registry.registerProject(missing)).rejects.toBeInstanceOf(ProjectPathUnavailableError)
  })

  it('removes only the central enrollment and is idempotent', async () => {
    const project = await directory('remove')
    const registry = new SupervisorProjectRegistry(new Context())
    const registered = await registry.registerProject(project)

    await expect(registry.removeProject(registered.id)).resolves.toBe(true)
    expect(registry.list()).toEqual([])
    await expect(registry.removeProject(registered.id)).resolves.toBe(false)
    await expect(import('node:fs/promises').then(fs => fs.stat(project))).resolves.toBeDefined()
  })

  it('serializes removal after refresh so stale status cannot republish a removed project', async () => {
    const project = await directory('remove-refresh')
    const registry = new SupervisorProjectRegistry(new Context())
    const registered = await registry.registerProject(project)

    const refreshing = registry.refreshStatuses()
    const removing = registry.removeProject(registered.id)
    await refreshing
    await expect(removing).resolves.toBe(true)

    expect(registry.list()).toEqual([])
  })

  it('marks missing and non-directory registrations unavailable without redirecting', async () => {
    const missing = await directory('missing-status')
    const registry = new SupervisorProjectRegistry(new Context())
    const registered = await registry.registerProject(missing)
    await rm(missing, { recursive: true, force: true })

    await expect(registry.refreshStatuses()).resolves.toEqual([
      expect.objectContaining({ id: registered.id, status: 'unavailable', revision: 2 }),
    ])

    const replacement = await directory('replacement')
    const file = join(replacement, 'file')
    await writeFile(file, 'not a directory')
    const second = await registry.registerProject(replacement)
    await rm(replacement, { recursive: true, force: true })
    await writeFile(replacement, 'replacement file')

    await expect(registry.refreshStatuses()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: second.id, status: 'unavailable', revision: 2 }),
    ]))
  })

  it('does not follow a changed symlink target during status refresh', async () => {
    const root = await directory('drift')
    const first = join(root, 'first')
    const second = join(root, 'second')
    const alias = join(root, 'alias')
    await mkdir(first)
    await mkdir(second)
    await symlink(first, alias, 'junction')
    const registry = new SupervisorProjectRegistry(new Context())
    const registered = await registry.registerProject(alias)
    await rm(alias, { force: true })
    await symlink(second, alias, 'junction')

    const refreshed = await registry.refreshStatuses()

    expect(refreshed).toEqual([
      expect.objectContaining({ id: registered.id, status: 'unavailable', revision: 2, realPath: registered.realPath }),
    ])
  })
})
