/** Types for the profile plugin-import Remote surface. */

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The web surface is not booted through a dsh profile, so no profile plugin manager exists. */
    'plugin-import/unavailable': {}
  }
}

/** Launcher fact the plugin-import surface needs about the profile it manages. */
export interface ProfileContext {
  /** Diagnostic prefix (`dsh`). */
  binName: string
  /** The profile name. */
  name: string
  /** The profile directory (`$DSH_HOME/profiles/<name>`). */
  dir: string
  /** Absolute path of the dsh app's package.json (first bundle-resolution anchor). */
  installAnchor: string
}

/** Outcome of hot-applying installed bundle layers to the running tree. */
export interface ApplyInstalledBundlesResult {
  /** Whether the running tree re-applied the fresh bundle stack. */
  ok: boolean
  /** Re-apply failure reason, present only when `ok` is false. */
  error?: string
}

/** Host-provided seam: install-time profile facts plus the hot-apply trigger. */
export interface ProfilePluginManager {
  /** Immutable facts about the profile this web surface manages. */
  context: ProfileContext
  /** Re-resolve bundle layers and transactionally re-apply them to the live tree. */
  applyInstalledBundles(): Promise<ApplyInstalledBundlesResult>
}

/** One bundle named in the profile's `dsh.profile.bundles`. */
export interface BundleRow {
  /** The package name. */
  name: string
  /** Whether the package resolves to a `dsh.bundle` from an installation anchor. */
  resolvable: boolean
}

/** The profile's bundle layer list with the profile it belongs to. */
export interface BundleListSnapshot {
  /** The profile name the import surface manages. */
  profileName: string
  /** One row per `dsh.profile.bundles` entry, in layer order. */
  bundles: BundleRow[]
}

/** The import report carried back to the browser. */
export interface ImportReport {
  /** Whether pnpm exited 0 and reconciliation completed. */
  ok: boolean
  /** The pnpm exit code (127 when pnpm itself is missing). */
  exitCode: number
  /** Captured install transcript plus reconciliation warnings. */
  output: string
  /** Bundle names newly joined to the profile layer stack. */
  addedBundles: string[]
  /** Whether the running tree hot-applied the new layers. */
  applied: boolean
  /** Hot-apply failure reason, present only when `applied` is false but a bundle was added. */
  applyError?: string
}
