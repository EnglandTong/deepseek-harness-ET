/** Browser Personal Supervisor dashboard plugin. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { SupervisorAside, SupervisorFooterAction } from './SupervisorDashboard.tsx'
import { en, NS, zh } from './locales.ts'

export type { SupervisorAsideProps, SupervisorFooterProps } from './SupervisorDashboard.tsx'

/** Browser services used by the footer toggle and the docked dashboard. */
export const inject = ['locale', 'slots', 'supervisor', 'layout']

/** Register dictionaries, the sidebar dock toggle, and the docked dashboard. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-supervisor: dictionaries')
  ctx.slots.inject(
    'sidebar.footer.action',
    () => ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'supervisor-dashboard',
      order: 10,
      locale: NS,
      inject: () => ({ supervisor: ctx.supervisor, layout: ctx.layout }),
    }, SupervisorFooterAction),
  )
  ctx.slots.inject(
    'aside',
    () => ctx.slots.register({
      name: 'aside',
      locale: NS,
      inject: () => ({ supervisor: ctx.supervisor, layout: ctx.layout }),
    }, SupervisorAside),
  )
}
