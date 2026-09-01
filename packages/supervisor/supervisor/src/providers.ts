/** Internal type-only provider aliases kept separate to avoid circular imports. */
/** Provider that discovers or registers project roots. */
export interface SupervisorProjectProvider { readonly name: string }
/** Provider that resolves a routing policy. */
export interface SupervisorRouter { readonly name: string }
/** Provider that executes a routed task. */
export interface SupervisorExecutor { readonly name: string }
/** Provider that reports progress or critical events. */
export interface SupervisorReporter { readonly name: string }
