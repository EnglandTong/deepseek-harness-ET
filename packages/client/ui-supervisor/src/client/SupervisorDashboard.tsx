import { useEffect, useState, useSyncExternalStore } from 'react'
import type {
  SupervisorActionKind,
  SupervisorChildSessionView,
  SupervisorProjectView,
  SupervisorRunView,
  SupervisorTaskView,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import type { SupervisorClient, SupervisorClientState } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconCordisPluginOutline14, IconRefreshOutline16, Modal, StateDot, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { NS, type SupervisorKey } from './locales.ts'
import css from './SupervisorDashboard.module.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Personal Supervisor dashboard copy. */
    supervisor: SupervisorKey
  }
}

/** Full props for the sidebar footer dashboard entry. */
export type SupervisorDashboardProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<typeof NS>
  & { supervisor: SupervisorClient }

/** A task status category used only to choose a visual treatment. */
type TaskTone = 'active' | 'blocked' | 'review' | 'completed' | 'other'

/** Read one immutable Host snapshot through React's external-store contract. */
function useSupervisorState(client: SupervisorClient): SupervisorClientState {
  return useSyncExternalStore(
    onStoreChange => client.state.subscribe(onStoreChange),
    () => client.state.getSnapshot(),
    () => client.state.getSnapshot(),
  )
}

/** Normalize the extensible Host status vocabulary for visual grouping. */
function taskTone(status: string): TaskTone {
  const normalized = status.toLowerCase().replaceAll('_', '').replaceAll('-', '')
  if (normalized === 'blocked' || normalized === 'needsownerdecision' || normalized === 'needsfix') return 'blocked'
  if (normalized === 'readyforreview') return 'review'
  if (normalized === 'accepted' || normalized === 'completed') return 'completed'
  if (normalized === 'running' || normalized === 'dispatched' || normalized === 'ready' || normalized === 'classified') return 'active'
  return 'other'
}

/** State-dot color for a task card. */
function dotState(tone: TaskTone): 'done' | 'warning' | 'ongoing' | 'error' {
  if (tone === 'completed') return 'done'
  if (tone === 'blocked' || tone === 'review') return 'warning'
  if (tone === 'active') return 'ongoing'
  return 'error'
}

/** Localized status label for an extensible task status. */
function statusLabel(status: string, t: TranslateNS<typeof NS>): string {
  const tone = taskTone(status)
  return t(`status.${tone}`)
}
/** Actions made available by the Host state machine for a task. */
function actionsFor(task: SupervisorTaskView): readonly SupervisorActionKind[] {
  const normalized = task.status.toLowerCase().replaceAll('_', '').replaceAll('-', '')
  if (normalized === 'needsownerdecision') return ['approve', 'reject']
  if (normalized === 'readyforreview' || normalized === 'needsfix') return ['rework']
  if (normalized === 'running' || normalized === 'dispatched') return ['pause']
  if (normalized === 'paused') return ['continue']
  return []
}

/** Child reference shown after the user expands a task's run details. */
function ChildSession({
  task,
  run,
  supervisor,
  t,
}: {
  task: SupervisorTaskView
  run: SupervisorRunView | undefined
  supervisor: SupervisorClient
  t: TranslateNS<typeof NS>
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [child, setChild] = useState<SupervisorChildSessionView | undefined>()

  const reveal = (): void => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    if (child !== undefined || run === undefined) return
    setLoading(true)
    void supervisor.childSession(task.id, run.runId).then((value) => {
      setChild(value)
      setLoading(false)
    })
  }

  if (run === undefined) return <span className={css.noRun}>{t('task.child.none')}</span>
  return (
    <div className={css.childBlock}>
      <button type="button" className={css.childToggle} onClick={reveal} aria-expanded={open}>
        {t('task.child')}
      </button>
      {open && (
        <div className={css.childRef} role="status">
          {loading && t('task.child.loading')}
          {!loading && child !== undefined && (
            <>
              <span>{t('task.child.ref', { session: child.sessionId })}</span>
              <span className={css.readonly}>{t('task.child.readonly')}</span>
            </>
          )}
          {!loading && child === undefined && t('task.child.none')}
        </div>
      )}
    </div>
  )
}

/** A single task card. All mutation callbacks go through Host CAS actions. */
function TaskCard({
  task,
  project,
  run,
  supervisor,
  busy,
  setBusy,
  t,
}: {
  task: SupervisorTaskView
  project: SupervisorProjectView | undefined
  run: SupervisorRunView | undefined
  supervisor: SupervisorClient
  busy: boolean
  setBusy: (value: boolean) => void
  t: TranslateNS<typeof NS>
}) {
  const tone = taskTone(task.status)
  const actions = actionsFor(task)
  const execute = (action: SupervisorActionKind): void => {
    setBusy(true)
    void supervisor.action({ taskId: task.id, action, expectedRevision: task.revision }).finally(() => { setBusy(false) })
  }
  const model = run?.model === undefined ? '' : ` · ${run.model}`
  return (
    <article className={css.task} data-tone={tone}>
      <div className={css.taskHeading}>
        <StateDot state={dotState(tone)} />
        <div className={css.taskTitle}>
          <strong>{task.title}</strong>
          <span className={css.status}>{statusLabel(task.status, t)}</span>
        </div>
      </div>
      <p className={css.description}>{task.description}</p>
      <p className={css.meta}>{t('task.project', { project: project?.displayName ?? task.projectId })}</p>
      <p className={css.next}>{t('task.next', { next: task.nextAction })}</p>
      {task.blocker !== undefined && task.blocker !== '' && <p className={css.blocker}>{t('task.blocker', { blocker: task.blocker })}</p>}
      {run !== undefined && <p className={css.run}>{t('task.run', { executor: run.executor, model })}</p>}
      <div className={css.taskFooter}>
        <ChildSession task={task} run={run} supervisor={supervisor} t={t} />
        {actions.length > 0 && (
          <div className={css.actions}>
            {actions.map(action => (
              <Button
                key={action}
                size="sm"
                variant={action === 'approve' || action === 'continue' ? 'primary' : 'outline'}
                disabled={busy}
                onClick={() => { execute(action) }}
              >
                {busy ? t('task.actionBusy') : t(`task.${action}`)}
              </Button>
            ))}
          </div>
        )}
      </div>
    </article>
  )
}

/** Dashboard modal body with project summary, tasks, notifications, and CAS actions. */
function DashboardPanel({
  state,
  supervisor,
  t,
}: {
  state: SupervisorClientState
  supervisor: SupervisorClient
  t: TranslateNS<typeof NS>
}) {
  const [busyTasks, setBusyTasks] = useState<ReadonlySet<string>>(() => new Set())
  const active = state.tasks.filter(task => taskTone(task.status) === 'active').length
  const blocked = state.tasks.filter(task => taskTone(task.status) === 'blocked').length
  const review = state.tasks.filter(task => taskTone(task.status) === 'review').length
  const setTaskBusy = (taskId: string, value: boolean): void => {
    setBusyTasks((current) => {
      const next = new Set(current)
      if (value) next.add(taskId)
      else next.delete(taskId)
      return next
    })
  }
  const runFor = (taskId: string): SupervisorRunView | undefined => state.runs.find(run => run.taskId === taskId)
  return (
    <div className={css.panel}>
      <section aria-labelledby="supervisor-projects-title">
        <div className={css.sectionHeading}>
          <h3 id="supervisor-projects-title">{t('projects.title')}</h3>
          <span className={css.summary}>{t('projects.summary', { active, blocked, review })}</span>
        </div>
        {state.projects.length === 0 && <p className={css.empty}>{t('empty.projects')}</p>}
        {state.projects.length > 0 && (
          <ul className={css.projects}>
            {state.projects.map(project => (
              <li key={project.id} className={css.project}>
                <StateDot state={project.status === 'registered' ? 'done' : 'warning'} />
                <span className={css.projectName}>{project.displayName}</span>
                {project.status !== 'registered' && <span className={css.status}>{t('project.unavailable')}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="supervisor-tasks-title">
        <h3 id="supervisor-tasks-title">{t('tasks.title')}</h3>
        {state.tasks.length === 0 && <p className={css.empty}>{t('tasks.empty')}</p>}
        <div className={css.tasks}>
          {state.tasks.map(task => (
            <TaskCard
              key={`${task.id}:${task.revision}`}
              task={task}
              project={state.projects.find(project => project.id === task.projectId)}
              run={runFor(task.id)}
              supervisor={supervisor}
              busy={busyTasks.has(task.id)}
              setBusy={(value) => { setTaskBusy(task.id, value) }}
              t={t}
            />
          ))}
        </div>
      </section>
      <section aria-labelledby="supervisor-notifications-title">
        <h3 id="supervisor-notifications-title">{t('notifications.title')}</h3>
        {state.notifications.length === 0 && <p className={css.empty}>{t('notifications.empty')}</p>}
        <ul className={css.notifications}>
          {state.notifications.map(notification => (
            <li key={`${notification.id}:${notification.revision}`} className={css.notification}>
              <StateDot state={notification.kind === 'failed' || notification.kind === 'review-failed' ? 'error' : 'warning'} />
              <span>{notification.message}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/**
 * Sidebar footer action and modal dashboard. It stays a read-only projection
 * until a user clicks an explicit Host action; child sessions expose only
 * references and never mount a composer.
 * @param props - sidebar state, translator, and Host-backed Supervisor client.
 * @returns the footer action and optional dashboard modal.
 */
export function SupervisorDashboard({ wide, supervisor, t }: SupervisorDashboardProps) {
  const state = useSupervisorState(supervisor)
  const [open, setOpen] = useState(false)
  const unread = state.notifications.filter(notification => notification.unread).length
  useEffect(() => {
    if (open) void supervisor.refresh()
  }, [open, supervisor])
  return (
    <>
      <Tooltip label={t('button.open.label')} delayMs={500} disabled={wide}>
        <button
          type="button"
          className={`${css.trigger} ${wide ? css.triggerWide : ''}`}
          aria-label={t('button.open.label')}
          onClick={() => { setOpen(true) }}
        >
          <IconCordisPluginOutline14 size={wide ? 14 : 18} />
          {wide && <span>{t('button.open')}</span>}
          {unread > 0 && <span className={css.badge} aria-label={`${unread}`}>{unread}</span>}
        </button>
      </Tooltip>
      <Modal
        open={open}
        onClose={() => { setOpen(false) }}
        title={t('dialog.title')}
        closeLabel={t('close')}
        description={t('dialog.description')}
        className={css.dialog ?? ''}
        contentClassName={css.dialogContent ?? ''}
        footer={(
          <Button
            variant="ghost"
            size="sm"
            icon={<IconRefreshOutline16 size={14} />}
            disabled={state.loading}
            onClick={() => { void supervisor.refresh() }}
          >
            {state.loading ? t('refreshing') : t('refresh')}
          </Button>
        )}
      >
        {state.loading && state.identity === undefined && <p className={css.loading}>{t('loading')}</p>}
        {state.error !== undefined && <p className={css.error} role="alert">{t('unavailable', { message: state.error })}</p>}
        {state.identity !== undefined && <DashboardPanel state={state} supervisor={supervisor} t={t} />}
      </Modal>
    </>
  )
}
