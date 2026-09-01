/** Deterministic identifier, path, and timestamp scrubbing shared by the supervisor driver and its snapshot test. */

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu
const ISO_TIME_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/giu
const EPOCH_MS_PATTERN = /\b1\d{12}\b/gu

/** Alias numbering shared by every record in one scenario run. */
export interface ScrubContext {
  readonly aliases: Map<string, string>
}

/** @returns a fresh scrub context with no alias assigned. */
export function scrubContext(): ScrubContext {
  return { aliases: new Map() }
}

/**
 * Render one value with all run-varying facts replaced.
 * @param context - alias map that keeps one numbering per scenario run.
 * @param value - record or string to render.
 * @param cwd - absolute working directory tokenized out of the record.
 * @returns a stable single-line rendering.
 */
export function scrub(context: ScrubContext, value: unknown, cwd: string): string {
  const isString = typeof value === 'string'
  // JSON escapes one path separator as a backslash pair; a raw string carries it alone.
  const text = (isString ? value : JSON.stringify(value)).replace(isString ? /\\/gu : /\\\\/gu, '/')
  const directory = cwd.replace(/\\/gu, '/')
  return text
    .split(directory).join('<cwd>')
    .replace(ISO_TIME_PATTERN, '<time>')
    .replace(EPOCH_MS_PATTERN, '0')
    .replace(UUID_PATTERN, (match: string) => {
      const existing = context.aliases.get(match)
      if (existing !== undefined) return existing
      const alias = `id${context.aliases.size + 1}`
      context.aliases.set(match, alias)
      return alias
    })
}
