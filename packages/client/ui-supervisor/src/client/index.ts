/** Browser Personal Supervisor dashboard plugin. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { SupervisorDashboard } from './SupervisorDashboard.tsx'
import { en, NS, zh } from './locales.ts'

export type { SupervisorDashboardProps } from './SupervisorDashboard.tsx'

/** Browser services used by the dashboard and footer action. */
export const inject = ['locale', 'slots', 'supervisor']

/** Register dictionaries and the one-click dashboard in the sidebar footer. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-supervisor: dictionaries')
  ctx.slots.inject(
    'sidebar.footer.action',
    () => ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'supervisor-dashboard',
      order: 10,
      locale: NS,
      inject: () => ({ supervisor: ctx.supervisor }),
    }, SupervisorDashboard),
  )
}
