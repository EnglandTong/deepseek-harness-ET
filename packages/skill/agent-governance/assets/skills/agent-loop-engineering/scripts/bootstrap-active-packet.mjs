#!/usr/bin/env node

import { existsSync, statSync } from "node:fs"
import { basename, dirname, extname, isAbsolute, resolve } from "node:path"
import {
  TOOL_VERSION,
  assertInside,
  atomicWriteInside,
  computeAuthorityFingerprint,
  contentItems,
  extractMarkdownLinks,
  findDocsDirectory,
  firstMeaningfulParagraph,
  parseArgs,
  parseFrontmatter,
  projectRelative,
  readUtf8Inside,
  resolveWorkspace,
  safeJson,
  section,
  walkMetadata,
} from "./state-tools-lib.mjs"

const cli = parseArgs(process.argv.slice(2))
const language = cli.value("--language", "en")
const jsonOutput = cli.flag("--json")
const writeRequested = cli.flag("--write")
const workspaceInput = cli.value("--workspace", ".")

const CURRENT_NAME = /(?:active[_ -]?packet|current|active|target|acceptance|status|next[_ -]?actions?|work[_ -]?order|assignment|override|qa[_ -]?(?:decision|result))/i
const HISTORICAL_PATH = /(?:^|\/)(?:old|archive|archives|history|historical|completed|closed|superseded)(?:\/|$)/i
const ROUTE_ID = /\b[A-Z]{1,4}-?\d+[A-Z]?(?:[-_.][A-Z0-9]+)*\b/gi

function addUnique(list, value) {
  if (!list.includes(value)) list.push(value)
}

function idsFrom(value) {
  return [...new Set((value.match(ROUTE_ID) ?? [])
    .map((item) => item.toUpperCase())
    .filter((item) => !/\.(?:MD|PY|JS|TS|JSON|YAML|YML|CSS|HTML)$/.test(item)))]
}

function routeFamily(route) {
  return route.match(/^([A-Z]{1,4})-?\d+/)?.[1] ?? route
}

function routeBase(route) {
  const match = route.match(/^([A-Z]{1,4})-?(\d+)/)
  return match ? `${match[1]}${Number(match[2])}` : route
}

function lastRoutePerFamily(routes) {
  const selected = new Map()
  for (const route of routes) selected.set(routeFamily(route), route)
  return [...selected.values()]
}

function conflictingRouteIds(routes) {
  const groups = new Map()
  for (const route of routes) {
    const family = routeFamily(route)
    const group = groups.get(family) ?? new Map()
    const base = routeBase(route)
    const values = group.get(base) ?? []
    addUnique(values, route)
    group.set(base, values)
    groups.set(family, group)
  }
  const conflicts = []
  for (const group of groups.values()) {
    if (group.size < 2) continue
    for (const values of group.values()) for (const route of values) addUnique(conflicts, route)
  }
  return conflicts
}

function currentWindow(text) {
  const lines = text.split(/\r?\n/).slice(0, 250)
  const historyIndex = lines.findIndex((line, index) => index > 0 && /^#{1,3}\s+.*(?:historical|history|archive|历史|归档)/i.test(line))
  return (historyIndex >= 0 ? lines.slice(0, historyIndex) : lines).join("\n")
}

function explicitRouteLines(text) {
  const lines = currentWindow(text).split(/\r?\n/)
  const candidates = []
  const push = (priority, routes) => {
    if (routes.length > 0) candidates.push({ priority, routes: lastRoutePerFamily(routes) })
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const normalized = line.replace(/[*_`]/g, "")
    if (/\b(?:current_effective_route|active_work_order(?:_override)?|active_milestone|active_program)\s*[:：]/i.test(normalized)) {
      const routes = idsFrom(normalized)
      if (routes.length > 0) {
        push(5, routes)
        continue
      }
    }
    if (/(?:current\s+(?:effective\s+)?(?:route|assignment|work\s*order|milestone|program|target)|active\s+(?:route|assignment|work\s*order|milestone|program)|当前(?:有效)?(?:路线|任务|工单|里程碑|计划)|现行(?:路线|任务|工单|里程碑|计划))(?:\s*[:：—-]|\s*\(|$)/i.test(normalized)) {
      const routes = idsFrom(normalized)
      if (routes.length > 0) {
        push(5, routes)
        continue
      }
    }
    if (/^(?:status|状态)\s*[:：].*\bactive\b/i.test(normalized) || /(?:当前阶段|当前状态)\s*[:：].*/i.test(normalized)) {
      push(4, idsFrom(normalized))
      continue
    }
    if (/(?:current\s+authoritative\s+state|current\s+effective|当前有效状态|当前权威状态)/i.test(normalized)) {
      push(4, idsFrom(normalized))
      continue
    }
    if (/^#{1,3}\s+(?:active\s+(?:owner-ordered\s+loop|milestone|program|work\s*order)|current\s+(?:route|assignment|milestone|program|work\s*order))/i.test(normalized)) {
      const block = [normalized, ...lines.slice(index + 1, index + 5)].join(" ")
      push(3, idsFrom(block))
      continue
    }
    if (/^#{1,3}\s+.*(?:current\s+(?:milestone\s+)?boundary|当前.*边界)/i.test(normalized)) {
      push(1, idsFrom(normalized))
    }
  }

  if (candidates.length === 0) return []
  const highest = Math.max(...candidates.map((item) => item.priority))
  const routes = []
  for (const candidate of candidates.filter((item) => item.priority === highest)) {
    for (const route of candidate.routes) addUnique(routes, route)
  }
  return routes
}

function prominentRoutes(file, text) {
  const explicit = explicitRouteLines(text)
  if (explicit.length > 0) return explicit
  const fromName = idsFrom(basename(file.relative))
  if (fromName.length > 0) return fromName
  const heading = currentWindow(text).split(/\r?\n/).find((line) => /^#\s+/.test(line)) ?? ""
  return lastRoutePerFamily(idsFrom(heading))
}

function findOverrides(readFiles) {
  const values = []
  for (const file of readFiles) {
    for (const line of currentWindow(file.text).split(/\r?\n/)) {
      if (!/(?:current\s+(?:route\s+)?override|current\s+effective|effective\s+current|当前(?:有效|覆盖|生效)|现行路线)/i.test(line)) continue
      for (const route of idsFrom(line)) values.push({ route, file: file.relative, line: line.trim().slice(0, 240) })
    }
  }
  return values
}

function qaDecisions(text) {
  const decisions = []
  const patterns = [
    /^(?:#{1,3}\s*)?(?:independent\s+)?qa\s+(?:decision|result)?\s*[:：-]?\s*(Accepted With Risk|Accepted|Failed|Blocked)\s*$/gim,
    /^(?:superseding\s+)?decision\s*[:：]\s*(Accepted With Risk|Accepted|Failed|Blocked)\s*$/gim,
    /^(?:最终|独立)?\s*QA\s*(?:结论|决策|结果)?\s*[:：]\s*(Accepted With Risk|Accepted|Failed|Blocked)\s*$/gim,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) decisions.push({ value: match[1], index: match.index ?? 0 })
  }
  return decisions.sort((left, right) => left.index - right.index)
}

function sectionAny(text, names) {
  for (const name of names) {
    const found = section(text, name)
    if (found) return found
  }
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^#{2,6}\s+(.+)$/)?.[1] ?? ""
    if (!heading || !names.some((name) => heading.toLowerCase().includes(name.toLowerCase()))) continue
    const values = []
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (/^#{1,3}\s+/.test(lines[cursor])) break
      values.push(lines[cursor])
    }
    const found = values.join("\n").trim()
    if (found) return found
  }
  return ""
}

function extractCriteria(text) {
  const selected = sectionAny(text, ["Acceptance Criteria", "Must Pass", "Acceptance Gates", "验收标准", "必须通过", "验收门禁"])
  if (!selected) return []
  const table = []
  const checks = []
  const bullets = []
  for (const line of selected.split(/\r?\n/)) {
    const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean)
    if (cells.length >= 2 && /^AC[-_ ]?\d+/i.test(cells[0])) {
      table.push(`${cells[0]}: ${cells[1]}`)
      continue
    }
    const check = line.match(/^\s*[-*]\s+\[[ xX]\]\s*(.+)$/)
    if (check) {
      checks.push(check[1].trim())
      continue
    }
    const item = line.match(/^\s*[-*]\s+(.+)$/)
    if (item) bullets.push(item[1].trim())
  }
  return (table.length ? table : checks.length ? checks : bullets).filter((item) => !/^[-:| ]+$/.test(item)).slice(0, 5)
}

function extractItems(text, names) {
  const selected = sectionAny(text, names)
  if (!selected) return []
  const bullets = []
  const table = []
  for (const line of selected.split(/\r?\n/)) {
    const item = line.match(/^\s*[-*]\s+(?:\[[ xX]\]\s*)?(.+)$/)
    if (item) {
      bullets.push(item[1].trim())
      continue
    }
    const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean)
    if (cells.length >= 2 && !cells.every((cell) => /^[-: ]+$/.test(cell))) {
      if (/^(?:id|item|non-goal|scope|非目标|范围|项目)$/i.test(cells[0])) continue
      table.push(`${cells[0]}: ${cells[1]}`)
    }
  }
  return (bullets.length ? bullets : table).slice(0, 5)
}

function oneLine(value, fallback) {
  const item = contentItems(value)[0] ?? firstMeaningfulParagraph(value)
  return (item || fallback).replace(/\s+/g, " ").slice(0, 300)
}

function yamlString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

function bullet(value) {
  return value.replace(/^[-*]\s+/, "").replace(/\r?\n/g, " ").trim()
}

function chooseDeliveryClass(readFiles, primaryText = "") {
  const combined = readFiles.map((file) => file.text).join("\n")
  const match = `${primaryText}\n${combined}`.match(/delivery[_ ]class\s*[:：]\s*["']?(Runtime|Contract|Governance|Artifact|Mixed)/i)
  if (match) return match[1][0].toUpperCase() + match[1].slice(1).toLowerCase()
  if (/(?:before implementation|no product behavior changes|define\b.{0,80}\bcontract|interface-only|schema-only|仅定义|不修改产品行为|实现前.*契约)/i.test(primaryText)) return "Contract"
  const contract = /(?:interface|schema|contract|type\s+definition|接口|契约|类型定义)/i.test(primaryText)
  const governance = /(?:governance|policy|authority|workflow|治理|规则|权限|流程)/i.test(primaryText)
  const runtime = /(?:implement|runtime|user\s+flow|browser|service\s+integration|execute|实现|运行时|用户流程|浏览器|服务集成|执行)/i.test(primaryText)
  const artifact = /(?:report|document|package|evidence\s+pack|报告|文档|安装包|证据包)/i.test(primaryText)
  const classes = [contract && "Contract", governance && "Governance", runtime && "Runtime", artifact && "Artifact"].filter(Boolean)
  if (classes.length > 1 && runtime) return "Mixed"
  if (classes.length > 0) return classes[0]
  if (/(?:interface|schema|contract|type\s+definition|接口|契约|类型定义)/i.test(combined) && !/(?:user\s+flow|runtime|browser|用户流程|实际运行)/i.test(combined)) return "Contract"
  if (/(?:governance|policy|workflow|治理|规则|流程)/i.test(combined) && !/(?:source\s+code|runtime|用户流程|实际运行)/i.test(combined)) return "Governance"
  return "Runtime"
}

function currentCandidateScore(file) {
  const name = basename(file.relative).toLowerCase()
  if (name === "active_packet.md") return 1000
  if (/^target(?:_current)?\.md$/.test(name)) return 950
  if (/^acceptance(?:_current)?\.md$/.test(name)) return 940
  if (/^work[_ -]?order[_ -]?(?:active|current)\.md$/.test(name)) return 935
  if (/^current[_ -]?role[_ -]?instructions\.md$/.test(name)) return 925
  if (/(?:current|effective).*(?:override|route)|(?:override).*(?:current|effective)/.test(name)) return 930
  if (/(?:current|active).*(?:assignment|work[_ -]?order)/.test(name)) return 920
  if (/^(?:status|current_status|loop_state|next_actions?)\.md$/.test(name)) return 900
  if (/qa.*(?:decision|result)/.test(name)) return 500
  if (/work[_ -]?order/.test(name)) return 300
  return 0
}

function linkedPath(root, sourceFile, link, pathErrors) {
  const candidates = []
  if (isAbsolute(link)) candidates.push(link)
  else {
    candidates.push(resolve(dirname(sourceFile.path), link))
    candidates.push(resolve(root, link))
  }
  for (const candidate of candidates) {
    try {
      const safe = assertInside(root, candidate, "linked authority")
      if (existsSync(safe) && statSync(safe).isFile() && extname(safe).toLowerCase() === ".md") return safe
    } catch (error) {
      pathErrors.push({ source: sourceFile.relative, link, message: error.message })
    }
  }
  return undefined
}

function renderPacket({
  languageCode,
  packetId,
  desiredOutcome,
  stageOutcome,
  scopeItems,
  nonGoalItems,
  criteria,
  allowedItems,
  protectedItems,
  nextAction,
  deliveryClass,
  size,
  governance,
  stageMinutes,
  fingerprint,
  sources,
}) {
  const zh = languageCode.toLowerCase().startsWith("zh")
  const heading = (english, chinese) => `## ${english}${zh ? ` / ${chinese}` : ""}`
  const title = zh ? "# Active Packet / 当前执行包" : "# Active Packet"
  const checkedCriteria = criteria.slice(0, 5).map((item, index) => {
    const clean = bullet(item).replace(/^AC-\d+\s*[:：-]?\s*/i, "")
    const label = /^\[(?:Runtime|Contract|Governance|Artifact)\]/i.test(clean) ? "" : `[${deliveryClass === "Mixed" ? "Runtime" : deliveryClass}] `
    return `- [ ] AC-${String(index + 1).padStart(2, "0")} ${label}${clean}`
  })
  const scope = scopeItems.slice(0, 5).map((item) => `- ${bullet(item)}`)
  const nonGoals = nonGoalItems.slice(0, 5).map((item) => `- ${bullet(item)}`)
  const allowed = allowedItems.slice(0, 5).map((item) => `- ${bullet(item)}`)
  const protectedBoundaries = protectedItems.slice(0, 5).map((item) => `- ${bullet(item)}`)
  const authority = sources.map((source) => `- \`${source}\``)
  const now = new Date().toISOString()

  return [
    "---",
    'contract_version: "2.0"',
    `packet_id: ${yamlString(packetId)}`,
    'goal_readiness: "Ready for Execution"',
    'project_state: "Active"',
    'execution_state: "Ready"',
    'alignment_state: "Aligned"',
    'stage_review: "Not Reviewed"',
    "qa_required: true",
    'qa_decision: "Not Reviewed"',
    `size: ${yamlString(size)}`,
    `governance: ${yamlString(governance)}`,
    "stage: 1",
    "max_stages: 10",
    `stage_minutes: ${stageMinutes}`,
    'autonomy_mode: "Bounded"',
    'acceptance_mode: "Layered"',
    `delivery_class: ${yamlString(deliveryClass)}`,
    'context_profile: "Compact"',
    'write_scope: "."',
    'outside_write_policy: "Deny"',
    `authority_fingerprint: ${yamlString(fingerprint)}`,
    'agent_strategy: "Isolated"',
    "max_parallel_agents: 3",
    'context_return_policy: "SummaryAndEvidence"',
    'shared_authority_mode: "FingerprintAndExcerpt"',
    "single_writer: true",
    `updated_at: ${yamlString(now)}`,
    "---",
    "",
    title,
    "",
    heading("Desired Outcome", "期望结果"),
    "",
    desiredOutcome,
    "",
    heading("User And Situation", "用户与场景"),
    "",
    zh ? "- 待在首阶段确认主要用户与使用场景。" : "- Confirm the primary user and operating situation in stage 1.",
    "",
    heading("Current Stage Outcome", "当前阶段结果"),
    "",
    stageOutcome,
    "",
    heading("Scope", "范围"),
    "",
    ...(scope.length ? scope : [zh ? "- 交付当前权威文件定义的最小可用范围。" : "- Deliver the minimum useful scope defined by current authority."]),
    "",
    heading("Non-Goals", "非目标"),
    "",
    ...(nonGoals.length ? nonGoals : [zh ? "- 不扩展到未授权功能、生产或项目外修改。" : "- No unapproved features, production changes, or writes outside this project."]),
    "",
    heading("Acceptance Criteria", "验收标准"),
    "",
    ...(checkedCriteria.length ? checkedCriteria : [`- [ ] AC-01 [${deliveryClass === "Mixed" ? "Runtime" : deliveryClass}] ${zh ? "以当前验收文件规定的证据证明期望结果。" : "Prove the desired outcome with the evidence defined by current acceptance authority."}`]),
    "",
    heading("Allowed Changes", "允许修改"),
    "",
    ...(allowed.length ? allowed : [zh ? "- 当前项目根目录内、与本 Packet 直接相关的文件。" : "- Files inside this project root that directly serve this Packet."]),
    "",
    heading("Protected Boundaries", "受保护边界"),
    "",
    ...(protectedBoundaries.length ? protectedBoundaries : [zh ? "- 目录外写入、生产、凭证、破坏性操作及未经授权的目标/架构/数据变化。" : "- Outside writes, production, credentials, destructive actions, and unauthorized target/architecture/data changes."]),
    "",
    heading("Evidence Required", "所需证据"),
    "",
    zh ? "- Automatic / 自动：先运行聚焦检查，再运行受影响回归。" : "- Automatic: focused checks first, then affected regression.",
    zh ? "- Functional / 功能：对 Runtime 声明执行真实用户或操作流程。" : "- Functional: exercise the real user or operator flow for Runtime claims.",
    zh ? "- Independent / 独立：Standard/Full 在最终验收前由另一任务复核。" : "- Independent: another task reviews Standard/Full work before final acceptance.",
    "",
    heading("Stop Conditions", "停止条件"),
    "",
    zh ? "- 权限冲突、项目外写入、核心目标漂移，或同一失败签名两次无新证据。" : "- Authority conflict, outside write, core-goal drift, or the same failure signature twice without new evidence.",
    "",
    heading("Authority Sources", "权威来源"),
    "",
    ...authority,
    "",
    heading("Assumptions And Decisions", "假设与决策"),
    "",
    zh ? "- 本 Packet 是旧记录的当前投影；旧文件保留为历史，不批量改写。" : "- This Packet is the current projection of legacy records; history remains unchanged.",
    "",
    heading("Current Evidence", "当前证据"),
    "",
    zh ? "- Bootstrap 只读索引与权威冲突检查已通过。" : "- Read-only bootstrap inventory and authority conflict checks passed.",
    "",
    heading("One Next Action", "唯一下一步"),
    "",
    `- ${nextAction}`,
    "",
  ].join("\n")
}

function humanReport(result) {
  console.log(`Legacy Bootstrap v${TOOL_VERSION}`)
  console.log(`Workspace: ${result.workspace}`)
  console.log(`Docs: ${result.docs_directory ?? "not found"}`)
  console.log(`Inventory: ${result.inventory.markdown_files} Markdown / ${result.inventory.total_files} total file(s)`)
  console.log(`Files read: ${result.files_read.length}`)
  if (result.conflicts.length > 0) {
    console.log("CONFLICT: no file was written.")
    for (const conflict of result.conflicts) console.log(`- [${conflict.code}] ${conflict.message}`)
    console.log(`Owner decision: ${result.owner_decision_request.summary}`)
  } else if (result.existing_packet) {
    console.log("ACTIVE_PACKET.md already exists; validate it instead of overwriting it.")
  } else {
    console.log(`READY: draft has ${result.packet.line_count} lines and ${result.packet.next_action_count} next action.`)
    console.log(result.written ? `Written: ${result.output_path}` : "Read-only preview; add --write to create the packet.")
  }
}

async function main() {
  const root = resolveWorkspace(workspaceInput)
  const docs = findDocsDirectory(root)
  const inventory = walkMetadata(root, docs.path)
  const markdown = inventory.files.filter((file) => file.extension === ".md")
  const totalBytes = inventory.files.reduce((sum, file) => sum + file.size, 0)

  const ranked = markdown
    .map((file) => ({ file, score: currentCandidateScore(file) }))
    .filter((item) => item.score > 0 && !HISTORICAL_PATH.test(item.file.relative.replace(/\\/g, "/")))
    .sort((left, right) => right.score - left.score || right.file.mtime_ms - left.file.mtime_ms)

  const selected = []
  const selectedPaths = new Set()
  const addFile = (file) => {
    const key = file.path.toLowerCase()
    if (selectedPaths.has(key) || selected.length >= 30) return
    selectedPaths.add(key)
    selected.push(file)
  }

  for (const item of ranked) {
    if (item.score >= 900) addFile(item.file)
  }
  if (!ranked.some((item) => item.score >= 900 && /work[_ -]?order/i.test(item.file.name))) {
    const latestWorkOrder = ranked.find((item) => item.score === 300)
    if (latestWorkOrder) addFile(latestWorkOrder.file)
  }
  for (const item of ranked.filter((candidate) => candidate.score === 500).slice(0, 2)) addFile(item.file)

  const readFiles = []
  const linkedPathErrors = []
  const readSelected = (file) => {
    try {
      const text = readUtf8Inside(root, file.path, 512 * 1024)
      readFiles.push({ ...file, text })
      return text
    } catch (error) {
      return ""
    }
  }
  for (const file of selected) readSelected(file)

  for (let index = 0; index < readFiles.length && readFiles.length < 30; index += 1) {
    const source = readFiles[index]
    for (const link of extractMarkdownLinks(source.text)) {
      const target = linkedPath(root, source, link, linkedPathErrors)
      if (!target || selectedPaths.has(target.toLowerCase())) continue
      const metadata = markdown.find((file) => file.path.toLowerCase() === target.toLowerCase())
      if (!metadata) continue
      addFile(metadata)
      readSelected(metadata)
      if (readFiles.length >= 30) break
    }
  }

  const conflicts = []
  const warnings = []
  const conflict = (code, message, files = []) => conflicts.push({ code, message, files: [...new Set(files)] })
  const warning = (code, message, files = []) => warnings.push({ code, message, files: [...new Set(files)] })

  for (const item of linkedPathErrors) {
    conflict("authority_path_escape", `Linked authority path escapes the workspace: ${item.link}.`, [item.source])
  }

  for (const item of inventory.skipped) {
    if (item.reason === "outside_workspace") conflict("path_escape", "A Docs inventory path resolves outside the workspace.", [String(item.path)])
    else warning("inventory_truncated", "The metadata inventory reached its safety limit.")
  }

  const existingPacket = readFiles.find((file) => basename(file.relative).toLowerCase() === "active_packet.md")
  if (existingPacket) warning("active_packet_exists", "ACTIVE_PACKET.md already exists and will not be overwritten.", [existingPacket.relative])

  const overrides = findOverrides(readFiles)
  const overrideRoutes = [...new Set(overrides.map((item) => item.route))]
  const conflictingOverrides = conflictingRouteIds(overrideRoutes)
  if (conflictingOverrides.length > 0) {
    conflict("multiple_current_overrides", `Multiple current overrides disagree at the same route level: ${conflictingOverrides.join(", ")}.`, overrides.map((item) => item.file))
  }

  const assignmentClaims = []
  const routeClaims = []
  for (const file of readFiles) {
    const name = basename(file.relative)
    const routes = prominentRoutes(file, file.text)
    const isAssignmentAuthority = /(?:current|active).*(?:assignment|work[_ -]?order)|(?:assignment|work[_ -]?order).*(?:current|active)|^(?:status|current_status|next_actions?|current_role_instructions)\.md$/i.test(name)
    const explicitAssignments = currentWindow(file.text)
      .split(/\r?\n/)
      .filter((line) => /(?:current\s+(?:active\s+)?assignment|当前(?:有效)?(?:任务|工单|指派))/i.test(line))
      .flatMap((line) => idsFrom(line))
    if (isAssignmentAuthority && (/(?:current|active).*(?:assignment)|(?:assignment).*(?:current|active)/i.test(name) || explicitAssignments.length > 0)) {
      for (const route of [...new Set([...routes, ...explicitAssignments])]) assignmentClaims.push({ route, file: file.relative })
    }
    if (/^(?:target|acceptance|status|current_status|loop_state)/i.test(name) || /(?:current|active).*(?:work[_ -]?order|assignment)/i.test(name)) {
      for (const route of routes) routeClaims.push({ route, file: file.relative })
    }
  }

  const assignmentRoutes = [...new Set(assignmentClaims.map((item) => item.route))]
  const conflictingAssignments = conflictingRouteIds(assignmentRoutes)
  if (overrideRoutes.length === 0 && conflictingAssignments.length > 0) {
    conflict("multiple_current_assignments", `Multiple current assignments conflict at the same route level: ${conflictingAssignments.join(", ")}.`, assignmentClaims.map((item) => item.file))
  }

  const claimedRoutes = [...new Set(routeClaims.map((item) => item.route))]
  const conflictingClaims = conflictingRouteIds(claimedRoutes)
  if (conflictingOverrides.length === 0 && overrideRoutes.length === 0 && conflictingClaims.length > 0) {
    conflict("active_route_conflict", `Current authority files identify different same-level routes: ${conflictingClaims.join(", ")}.`, routeClaims.filter((item) => conflictingClaims.includes(item.route)).map((item) => item.file))
  } else if (conflictingOverrides.length === 0 && overrideRoutes.length > 0) {
    const overrideBases = new Set(overrideRoutes.map(routeBase))
    const superseded = routeClaims.filter((item) => !overrideBases.has(routeBase(item.route)))
    if (superseded.length > 0) warning("older_routes_superseded", `Explicit current override supersedes older route records.`, superseded.map((item) => item.file))
  }

  for (const file of readFiles.filter((item) => /qa|acceptance/i.test(item.name))) {
    const decisions = qaDecisions(file.text)
    if (decisions.length < 2) continue
    const first = decisions[0].value
    const last = decisions.at(-1).value
    if (["Accepted", "Accepted With Risk"].includes(first) && ["Failed", "Blocked"].includes(last)) {
      conflict("qa_decision_conflict", `${file.relative} starts with ${first} but contains a later ${last} decision.`, [file.relative])
    }
  }

  const targetFile = readFiles.find((file) => /^target(?:_current)?\.md$/i.test(file.name))
  const acceptanceFile = readFiles.find((file) => /^acceptance(?:_current)?\.md$/i.test(file.name))
  const explicitCurrentWork = readFiles.find((file) => /(?:current|active).*(?:work[_ -]?order|assignment)|(?:work[_ -]?order|assignment).*(?:current|active)/i.test(file.name))
  const claimedBases = new Set(routeClaims.map((item) => routeBase(item.route)))
  const matchedWork = readFiles.find((file) => /work[_ -]?order/i.test(file.name) && idsFrom(file.name).some((route) => claimedBases.has(routeBase(route))))
  const currentWork = explicitCurrentWork ?? matchedWork ?? readFiles.find((file) => /work[_ -]?order/i.test(file.name))
  let effectiveWork = currentWork
  if (explicitCurrentWork) {
    for (const link of extractMarkdownLinks(explicitCurrentWork.text)) {
      const linkedName = basename(link).toLowerCase()
      if (!/work[_ -]?order/.test(linkedName)) continue
      const linked = readFiles.find((file) => file.name.toLowerCase() === linkedName)
      if (linked) {
        effectiveWork = linked
        break
      }
    }
  }
  const statusFile = readFiles.find((file) => /^status\.md$/i.test(file.name))
    ?? readFiles.find((file) => /^current_status\.md$/i.test(file.name))
    ?? readFiles.find((file) => /^loop_state\.md$/i.test(file.name))
    ?? readFiles.find((file) => /^next_actions?\.md$/i.test(file.name))
  const overrideFile = overrides.length ? readFiles.find((file) => file.relative === overrides[0].file) : undefined

  if (!targetFile) conflict("missing_target_authority", "No canonical current TARGET.md was found.")
  if (!acceptanceFile) conflict("missing_acceptance_authority", "No canonical current ACCEPTANCE.md was found.")
  const authorizationText = [currentWork?.text, statusFile?.text, overrideFile?.text]
    .filter(Boolean)
    .map((text) => currentWindow(text))
    .join("\n")
  const hasActiveAuthorization = Boolean(explicitCurrentWork) || /(?:active_work_order|current\s+assignment|active\s+(?:developer\s+)?work\s*order|controller\s+dispatch|developer\s+(?:partial|in progress)|\bdispatched\b|remains\s+dispatched|当前(?:任务|工单)|已派发|开发中)/i.test(authorizationText)
  if (!hasActiveAuthorization) conflict("missing_active_authorization", "No current Work Order, assignment, or active dispatch authorizes execution.", [statusFile?.relative].filter(Boolean))

  const combined = readFiles.map((file) => file.text).join("\n")
  const contractDeclared = /delivery[_ ]class\s*[:：]\s*["']?Contract|\[Contract\]/i.test(combined)
  const runtimeClaim = /(?:runtime|feature|functionality|功能|运行时).{0,60}(?:accepted|complete|working|usable|通过|完成|可用)/i.test(combined)
  const functionalEvidence = /(?:functional evidence|user flow|browser evidence|runtime evidence|功能证据|用户流程|运行证据).{0,120}(?:pass|passed|通过|证据路径|evidence)/i.test(combined)
  if (contractDeclared && runtimeClaim && !functionalEvidence) {
    conflict("claim_class_mismatch", "Contract evidence is being used to claim Runtime completion without functional evidence.", readFiles.filter((file) => /Contract|runtime|功能|运行时/i.test(file.text)).map((file) => file.relative))
  }

  const authorityFiles = [targetFile, acceptanceFile, overrideFile, explicitCurrentWork, effectiveWork, statusFile].filter(Boolean)
  const authorityPaths = [...new Set(authorityFiles.map((file) => file.relative))]
  let fingerprint
  if (authorityPaths.length > 0) {
    try {
      fingerprint = computeAuthorityFingerprint(root, authorityPaths).fingerprint
    } catch (error) {
      conflict("authority_path_invalid", error.message, authorityPaths)
    }
  }

  let packetText
  let packetSummary
  let outputPath
  let written = false
  if (conflicts.length === 0 && !existingPacket) {
    const targetText = targetFile?.text ?? ""
    const acceptanceText = acceptanceFile?.text ?? ""
    const workText = effectiveWork?.text ?? currentWork?.text ?? statusFile?.text ?? ""
    const desiredOutcome = oneLine(
      sectionAny(targetText, ["Desired Outcome", "Core Target", "User Goal", "Product Goal", "System Goal", "Mission", "期望结果", "核心目标", "用户目标", "产品目标", "项目目标"]),
      firstMeaningfulParagraph(targetText) || (language.startsWith("zh") ? "交付当前权威目标定义的可用结果。" : "Deliver the usable result defined by current target authority."),
    )
    let scopeItems = extractItems(workText, ["Scope", "Must Finish", "范围", "必须完成"])
    if (scopeItems.length === 0) scopeItems = extractItems(targetText, ["Scope", "Must Finish", "范围", "必须完成"])
    const nonGoalItems = extractItems(targetText, ["Non-Goals", "Non Goals", "非目标"])
    let criteria = extractCriteria(workText)
    if (criteria.length === 0) criteria = extractCriteria(acceptanceText)
    const allowedItems = extractItems(workText, ["Allowed Changes", "Allowed Files", "允许修改", "允许文件"])
    const protectedItems = extractItems(workText, ["Protected Boundaries", "Not Allowed Files", "Forbidden", "受保护边界", "禁止文件"])
    const stageOutcome = oneLine(
      sectionAny(workText, ["Current Stage Outcome", "Stage Outcome", "Task", "Purpose", "当前阶段结果", "阶段结果", "任务", "目的"]),
      language.startsWith("zh") ? "建立当前目标的可复现基线，并完成第一个可验证切片。" : "Establish a reproducible baseline and complete the first verifiable slice.",
    )
    const indexedNextAction = oneLine(
      sectionAny(currentWork?.text ?? "", ["One Next Action", "Next Action", "Next Step", "下一步", "唯一下一步"])
        || sectionAny(workText || statusFile?.text || "", ["One Next Action", "Next Action", "Next Step", "下一步", "唯一下一步"]),
      language.startsWith("zh") ? "以 Developer 身份执行第一阶段的最小垂直切片并运行聚焦验证。" : "Execute the first-stage vertical slice as Developer and run focused verification.",
    )
    const effectiveWorkId = effectiveWork && effectiveWork !== currentWork ? idsFrom(effectiveWork.name).at(-1) : undefined
    const nextAction = effectiveWorkId
      ? (language.startsWith("zh") ? `执行 ${effectiveWorkId} 并产出该工单的聚焦证据。` : `Execute ${effectiveWorkId} and produce its focused Work Order evidence.`)
      : indexedNextAction
    const deliveryClass = chooseDeliveryClass(readFiles, workText)
    const metadata = parseFrontmatter(workText) ?? parseFrontmatter(targetText) ?? {}
    const complexity = workText.match(/^(?:Size|Complexity|规模|复杂度)\s*[:：]\s*(Small|Medium|Large|Lite|Standard|Full)\b/im)?.[1]
    const inferredSize = { Lite: "Small", Standard: "Medium", Full: "Large" }[complexity] ?? complexity
    const size = ["Small", "Medium", "Large"].includes(metadata.size) ? metadata.size : (["Small", "Medium", "Large"].includes(inferredSize) ? inferredSize : "Medium")
    const governance = ["Lite", "Standard", "Full"].includes(metadata.governance)
      ? metadata.governance
      : size === "Small" ? "Lite" : size === "Large" ? "Full" : "Standard"
    const stageMinutes = { Small: 30, Medium: 60, Large: 120 }[size]
    const activeRoute = overrideRoutes.at(-1) ?? assignmentRoutes.at(-1) ?? claimedRoutes.at(-1) ?? "LEGACY"
    const packetId = `${activeRoute}-BOOTSTRAP`.replace(/[^A-Za-z0-9_.-]/g, "-")

    packetText = renderPacket({
      languageCode: language,
      packetId,
      desiredOutcome,
      stageOutcome,
      scopeItems,
      nonGoalItems,
      criteria,
      allowedItems,
      protectedItems,
      nextAction,
      deliveryClass,
      size,
      governance,
      stageMinutes,
      fingerprint,
      sources: authorityPaths,
    })
    const lines = packetText.trimEnd().split(/\r?\n/)
    const nextActionSection = section(packetText, "One Next Action")
    const nextActionCount = contentItems(nextActionSection).length
    if (lines.length > 120) conflict("packet_too_large", `Generated packet has ${lines.length} lines; limit is approximately 120.`)
    if (nextActionCount !== 1) conflict("next_action_count", `Generated packet has ${nextActionCount} next actions; exactly one is required.`)
    packetSummary = {
      line_count: lines.length,
      next_action_count: nextActionCount,
      authority_fingerprint: fingerprint,
      agent_strategy: "Isolated",
      max_parallel_agents: 3,
      context_return_policy: "SummaryAndEvidence",
      shared_authority_mode: "FingerprintAndExcerpt",
      single_writer: true,
      delivery_class: deliveryClass,
      preview: packetText,
    }

    if (writeRequested && conflicts.length === 0) {
      const destination = assertInside(root, resolve(docs.path, "ACTIVE_PACKET.md"), "Active Packet output")
      outputPath = projectRelative(root, atomicWriteInside(root, destination, packetText))
      written = true
    } else {
      outputPath = projectRelative(root, resolve(docs.path, "ACTIVE_PACKET.md"))
    }
  }

  const ownerDecision = conflicts.length > 0 ? {
    summary: language.startsWith("zh")
      ? "请 Owner 一次确认唯一当前路线、最终有效 QA 状态及可作为当前授权的 TARGET/ACCEPTANCE；确认前保持零写入。"
      : "Owner must confirm one current route, the effective QA state, and the TARGET/ACCEPTANCE that authorize current work; no file will be written before that decision.",
    conflicts: conflicts.map((item) => ({ code: item.code, message: item.message, files: item.files })),
    recommended_default: overrideRoutes.length === 1
      ? `${overrideRoutes[0]} is the only explicit current override; confirm it and archive competing routes as history.`
      : "Choose the route tied to the current user-visible outcome and reproducible acceptance evidence; do not choose by timestamp alone.",
  } : null

  const result = {
    tool: "bootstrap-active-packet",
    version: TOOL_VERSION,
    workspace: root,
    docs_directory: projectRelative(root, docs.path),
    mode: writeRequested ? "write-if-coherent" : "read-only",
    inventory: {
      total_files: inventory.files.length,
      markdown_files: markdown.length,
      total_bytes: totalBytes,
      truncated: inventory.truncated,
    },
    files_read: readFiles.map((file) => file.relative),
    existing_packet: Boolean(existingPacket),
    conflicts,
    warnings,
    route_analysis: {
      overrides,
      assignments: assignmentClaims,
      authority_claims: routeClaims,
    },
    owner_decision_request: ownerDecision,
    packet: packetSummary ?? null,
    output_path: outputPath ?? null,
    written,
  }

  if (jsonOutput) console.log(safeJson(result))
  else humanReport(result)
  process.exitCode = conflicts.length > 0 ? 2 : 0
}

main().catch((error) => {
  const result = {
    tool: "bootstrap-active-packet",
    version: TOOL_VERSION,
    workspace: resolve(workspaceInput),
    written: false,
    error: error.message,
  }
  if (jsonOutput) console.log(safeJson(result))
  else console.error(`Bootstrap error: ${error.message}`)
  process.exitCode = 1
})
