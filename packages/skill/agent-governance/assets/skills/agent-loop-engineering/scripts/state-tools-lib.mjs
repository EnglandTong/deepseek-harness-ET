import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { createHash } from "node:crypto"
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path"

export const TOOL_VERSION = "2.1.1"

export function parseArgs(argv) {
  const values = new Map()
  const flags = new Set()
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (!value.startsWith("--")) continue
    const next = argv[index + 1]
    if (next && !next.startsWith("--")) {
      values.set(value, next)
      index += 1
    } else {
      flags.add(value)
    }
  }
  return {
    has: (name) => flags.has(name) || values.has(name),
    flag: (name) => flags.has(name),
    value: (name, fallback = undefined) => values.get(name) ?? fallback,
  }
}

export function normalizeRelative(value) {
  return value.split(sep).join("/").replace(/^\.\//, "")
}

export function isInside(rootReal, targetReal) {
  const rel = relative(rootReal, targetReal)
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
}

function realOrProjected(candidate) {
  const absolute = resolve(candidate)
  if (existsSync(absolute)) return realpathSync.native(absolute)

  let cursor = absolute
  const missing = []
  while (!existsSync(cursor)) {
    const parent = dirname(cursor)
    if (parent === cursor) throw new Error(`No existing parent for path: ${absolute}`)
    missing.unshift(basename(cursor))
    cursor = parent
  }
  return resolve(realpathSync.native(cursor), ...missing)
}

export function resolveWorkspace(workspace) {
  const absolute = resolve(workspace)
  if (!existsSync(absolute)) throw new Error(`Workspace does not exist: ${absolute}`)
  const real = realpathSync.native(absolute)
  if (!statSync(real).isDirectory()) throw new Error(`Workspace is not a directory: ${real}`)
  return real
}

export function assertInside(rootReal, candidate, label = "path") {
  const targetReal = realOrProjected(candidate)
  if (!isInside(rootReal, targetReal)) {
    throw new Error(`${label} escapes workspace: ${candidate}`)
  }
  return targetReal
}

export function projectRelative(rootReal, candidate) {
  const targetReal = assertInside(rootReal, candidate)
  return normalizeRelative(relative(rootReal, targetReal)) || "."
}

export function findDocsDirectory(rootReal, { required = true } = {}) {
  const matches = []
  for (const entry of readdirSync(rootReal, { withFileTypes: true })) {
    if (entry.name.toLowerCase() !== "docs") continue
    const candidate = join(rootReal, entry.name)
    const real = assertInside(rootReal, candidate, "Docs directory")
    if (statSync(real).isDirectory()) matches.push({ name: entry.name, path: real })
  }
  if (matches.length > 1) {
    throw new Error(`Multiple case-insensitive Docs directories found: ${matches.map((item) => item.name).join(", ")}`)
  }
  if (matches.length === 0) {
    if (!required) return undefined
    throw new Error("No Docs/docs directory was found at the workspace root.")
  }
  return matches[0]
}

export function readUtf8Inside(rootReal, candidate, maxBytes = 1024 * 1024) {
  const real = assertInside(rootReal, candidate, "read path")
  const info = statSync(real)
  if (!info.isFile()) throw new Error(`Read path is not a file: ${real}`)
  if (info.size > maxBytes) throw new Error(`Selected file exceeds ${maxBytes} bytes: ${real}`)
  return readFileSync(real, "utf8")
}

export function walkMetadata(rootReal, startDirectory, { maxFiles = 100000 } = {}) {
  const startReal = assertInside(rootReal, startDirectory, "inventory root")
  const stack = [startReal]
  const visitedDirectories = new Set()
  const files = []
  const skipped = []

  while (stack.length > 0) {
    const current = stack.pop()
    const currentReal = realpathSync.native(current)
    if (!isInside(rootReal, currentReal)) {
      skipped.push({ path: current, reason: "outside_workspace" })
      continue
    }
    if (visitedDirectories.has(currentReal.toLowerCase())) continue
    visitedDirectories.add(currentReal.toLowerCase())

    for (const entry of readdirSync(currentReal, { withFileTypes: true })) {
      const candidate = join(currentReal, entry.name)
      let targetReal
      try {
        targetReal = assertInside(rootReal, candidate, "inventory path")
      } catch (error) {
        skipped.push({ path: candidate, reason: "outside_workspace" })
        continue
      }

      const linkInfo = lstatSync(candidate)
      const info = statSync(targetReal)
      if (info.isDirectory()) {
        stack.push(targetReal)
        continue
      }
      if (!info.isFile()) continue

      files.push({
        path: targetReal,
        relative: projectRelative(rootReal, targetReal),
        name: entry.name,
        extension: extname(entry.name).toLowerCase(),
        size: info.size,
        mtime_ms: info.mtimeMs,
        linked: linkInfo.isSymbolicLink(),
      })
      if (files.length >= maxFiles) {
        skipped.push({ path: startReal, reason: "inventory_limit" })
        return { files, skipped, truncated: true }
      }
    }
  }

  files.sort((left, right) => left.relative.localeCompare(right.relative, "en"))
  return { files, skipped, truncated: false }
}

export function parseScalar(raw) {
  const value = raw.trim()
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  if (value === "true") return true
  if (value === "false") return false
  if (value === "null") return null
  if (/^-?\d+$/.test(value)) return Number(value)
  return value
}

export function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) return undefined
  const data = {}
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (field) data[field[1]] = parseScalar(field[2])
  }
  return data
}

export function isHeading(line, heading) {
  const value = line.trim()
  const prefix = `## ${heading}`
  return value === prefix || value.startsWith(`${prefix} /`)
}

export function section(text, heading) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => isHeading(line, heading))
  if (start < 0) return ""
  const content = []
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) break
    content.push(lines[index])
  }
  return content.join("\n").trim()
}

export function meaningful(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line && !["-", "- [ ]", "- [x]"].includes(line.toLowerCase()) && !line.startsWith("<!--"))
}

export function contentItems(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("<!--"))
    .map((line) => line.replace(/^[-*]\s+(?:\[[ xX]\]\s*)?/, "").trim())
    .filter((line) => line && line !== "-")
}

export function extractMarkdownLinks(text) {
  const links = []
  const patterns = [
    /\[[^\]]*\]\(([^)]+\.md(?:#[^)]+)?)\)/gi,
    /`([^`\r\n]+\.md(?:#[^`]*)?)`/gi,
    /\b((?:Docs|docs)[\\/][A-Za-z0-9_.() \\/-]+?\.md)\b/g,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      let value = match[1].trim().replace(/^<|>$/g, "").split("#")[0]
      if (/^[a-z]+:\/\//i.test(value)) continue
      try {
        value = decodeURIComponent(value)
      } catch {}
      links.push(value)
    }
  }
  return [...new Set(links)]
}

export function authoritySources(text) {
  const sourceSection = section(text, "Authority Sources")
  if (!sourceSection) return []
  const values = []
  for (const line of sourceSection.split(/\r?\n/)) {
    const backtick = line.match(/`([^`]+)`/)
    const markdown = line.match(/\[[^\]]*\]\(([^)]+)\)/)
    const plain = line.match(/^[-*]\s+([^#]+)$/)
    const value = backtick?.[1] ?? markdown?.[1] ?? plain?.[1]
    if (value) values.push(value.trim().split("#")[0])
  }
  return [...new Set(values)]
}

export function computeAuthorityFingerprint(rootReal, sources) {
  const hash = createHash("sha256")
  const normalized = []
  for (const source of sources) {
    const candidate = isAbsolute(source) ? source : resolve(rootReal, source)
    const real = assertInside(rootReal, candidate, "authority source")
    if (!existsSync(real) || !statSync(real).isFile()) {
      throw new Error(`Authority source does not exist: ${source}`)
    }
    const rel = projectRelative(rootReal, real)
    normalized.push(rel)
  }
  normalized.sort((left, right) => left.localeCompare(right, "en"))
  for (const rel of normalized) {
    const real = assertInside(rootReal, resolve(rootReal, rel), "authority source")
    hash.update(rel, "utf8")
    hash.update("\0")
    hash.update(readFileSync(real))
    hash.update("\0")
  }
  return { fingerprint: `sha256:${hash.digest("hex")}`, sources: normalized }
}

export function atomicWriteInside(rootReal, destination, content) {
  const target = assertInside(rootReal, destination, "write path")
  if (existsSync(target)) throw new Error(`Refusing to overwrite existing file: ${target}`)
  const parent = assertInside(rootReal, dirname(target), "write parent")
  if (!statSync(parent).isDirectory()) throw new Error(`Write parent is not a directory: ${parent}`)
  const temporary = assertInside(rootReal, join(parent, `.${basename(target)}.${process.pid}.${Date.now()}.tmp`), "temporary path")
  try {
    writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" })
    renameSync(temporary, target)
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary)
    throw error
  }
  return target
}

export function firstMeaningfulParagraph(text) {
  const withoutFrontmatter = text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
  for (const line of withoutFrontmatter.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || /^#{1,6}\s+/.test(trimmed) || /^[-:| ]+$/.test(trimmed) || /^\|/.test(trimmed)) continue
    const value = trimmed.replace(/^[-*]>?\s+/, "").replace(/^>\s*/, "")
    if (!value || /^(?:version|date|owner|reviewer|last updated|status|版本|日期|维护者|最后更新)\s*[:：]/i.test(value.replace(/[*_]/g, ""))) continue
    return value.slice(0, 300)
  }
  return ""
}

export function safeJson(value) {
  return JSON.stringify(value, null, 2)
}
