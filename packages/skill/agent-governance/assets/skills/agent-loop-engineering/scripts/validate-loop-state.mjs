#!/usr/bin/env node

import { existsSync, statSync } from "node:fs"
import { basename, resolve } from "node:path"
import {
  TOOL_VERSION,
  assertInside,
  authoritySources,
  computeAuthorityFingerprint,
  contentItems,
  findDocsDirectory,
  isHeading,
  meaningful,
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
const workspaceInput = cli.value("--workspace", ".")
const jsonOutput = cli.flag("--json")
const strictHistory = cli.flag("--strict-history")
const summaryOnly = cli.flag("--summary")
const maxProvided = cli.has("--max-findings")
const parsedMax = Number(cli.value("--max-findings", strictHistory ? Number.MAX_SAFE_INTEGER : 20))
const maxFindings = Number.isInteger(parsedMax) && parsedMax >= 0 ? parsedMax : 20

class FindingStore {
  constructor() {
    this.groups = new Map()
  }

  add(level, code, message, file = "", { count = 1, samples = [] } = {}) {
    const key = `${level}\0${code}\0${file}\0${message}`
    const current = this.groups.get(key) ?? { level, code, message, file, count: 0, samples: [] }
    current.count += count
    for (const sample of samples) {
      if (!current.samples.includes(sample) && current.samples.length < 5) current.samples.push(sample)
    }
    this.groups.set(key, current)
  }

  result(limit) {
    const rank = { error: 0, warning: 1, info: 2 }
    const groups = [...this.groups.values()].sort((left, right) => {
      return (rank[left.level] ?? 9) - (rank[right.level] ?? 9) || right.count - left.count || left.code.localeCompare(right.code)
    })
    const details = groups.slice(0, limit)
    const errors = groups.filter((item) => item.level === "error").reduce((sum, item) => sum + item.count, 0)
    const warnings = groups.filter((item) => item.level === "warning").reduce((sum, item) => sum + item.count, 0)
    const categoryCounts = {}
    for (const item of groups) categoryCounts[item.code] = (categoryCounts[item.code] ?? 0) + item.count
    return {
      groups,
      findings: details,
      summary: {
        errors,
        warnings,
        finding_groups: groups.length,
        detailed_findings_returned: details.length,
        findings_truncated: details.length < groups.length,
        max_findings: limit === Number.MAX_SAFE_INTEGER ? null : limit,
        category_counts: categoryCounts,
      },
    }
  }
}

const findings = new FindingStore()
const historyDetails = []

function recordHistoryDetail(detail) {
  if (strictHistory) historyDetails.push(detail)
}

function validateEnum(metadata, field, values, file) {
  if (metadata[field] !== undefined && !values.includes(metadata[field])) {
    findings.add("error", "invalid_value", `${field} must be one of: ${values.join(", ")}.`, file)
  }
}

function functionalEvidencePresent(text) {
  const evidence = `${section(text, "Evidence Required")}\n${section(text, "Current Evidence")}`
  return /(?:functional|user[- ]?flow|runtime|browser|end[- ]?to[- ]?end|manual|功能|用户流程|实际运行|浏览器).{0,160}(?:pass|passed|verified|evidence|log|screenshot|通过|已验证|证据|日志|截图)/is.test(evidence)
}

function runtimeOverclaim(text) {
  const selected = `${section(text, "Acceptance Criteria")}\n${section(text, "Current Evidence")}`
  return /(?:runtime|feature|functionality|user[- ]?flow|功能|运行时|用户流程).{0,80}(?:accepted|complete|working|usable|done|通过|完成|可用)/i.test(selected)
}

function validatePacket(root, docs, inventory) {
  const packet = inventory.files.find((file) => file.relative.toLowerCase() === `${projectRelative(root, docs.path).toLowerCase()}/active_packet.md`)
    ?? inventory.files.find((file) => basename(file.relative).toLowerCase() === "active_packet.md" && resolve(file.path).toLowerCase().startsWith(resolve(docs.path).toLowerCase()))

  if (!packet) {
    const names = new Set(inventory.files.map((file) => basename(file.relative).toLowerCase()))
    const hasTarget = names.has("target.md")
    const hasAcceptance = names.has("acceptance.md")
    const hasExecution = names.has("loop_state.md") || [...names].some((name) => /work[_ -]?order.*\.md/.test(name))
    if (hasTarget && hasAcceptance && hasExecution) {
      findings.add("warning", "legacy_state", "No ACTIVE_PACKET.md found. Run the read-only Legacy Bootstrap before execution.")
    } else {
      findings.add("error", "missing_state", "Missing ACTIVE_PACKET.md and no complete supported legacy authority set was found.")
    }
    return { metadata: undefined, text: "", file: undefined }
  }

  const file = packet.relative
  let text
  try {
    text = readUtf8Inside(root, packet.path)
  } catch (error) {
    findings.add("error", "packet_read_error", error.message, file)
    return { metadata: undefined, text: "", file }
  }

  const raw = parseFrontmatter(text)
  if (!raw) {
    findings.add("error", "missing_frontmatter", "Active Packet must start with YAML frontmatter.", file)
    return { metadata: undefined, text, file }
  }

  const legacyRequired = [
    "contract_version",
    "packet_id",
    "goal_readiness",
    "project_state",
    "execution_state",
    "alignment_state",
    "qa_required",
    "qa_decision",
    "size",
    "governance",
    "stage",
    "max_stages",
    "stage_minutes",
    "updated_at",
  ]
  for (const field of legacyRequired) {
    if (raw[field] === undefined || raw[field] === "") findings.add("error", "missing_field", `Active Packet is missing required field: ${field}.`, file)
  }

  const policyDefaults = {
    stage_review: "Not Reviewed",
    autonomy_mode: "Bounded",
    acceptance_mode: "Layered",
    delivery_class: "Mixed",
    context_profile: "Compact",
    write_scope: ".",
    outside_write_policy: "Deny",
    authority_fingerprint: null,
    agent_strategy: "Isolated",
    max_parallel_agents: 3,
    context_return_policy: "SummaryAndEvidence",
    shared_authority_mode: "FingerprintAndExcerpt",
    single_writer: true,
  }
  const missingPolicies = Object.keys(policyDefaults).filter((field) => raw[field] === undefined || raw[field] === "")
  if (missingPolicies.length > 0) {
    findings.add(
      "warning",
      "policy_defaults_applied",
      `Conservative 2.1 defaults apply; missing policy fields: ${missingPolicies.join(", ")}.`,
      file,
      { count: missingPolicies.length },
    )
  }
  const metadata = { ...policyDefaults, ...raw }

  if (metadata.contract_version !== "2.0") findings.add("error", "unsupported_contract", 'contract_version must remain "2.0".', file)
  if (typeof metadata.qa_required !== "boolean") findings.add("error", "invalid_type", "qa_required must be true or false.", file)

  validateEnum(metadata, "goal_readiness", ["Concept", "Direction", "Ready for Planning", "Ready for Execution", "Owner Decision Required"], file)
  validateEnum(metadata, "project_state", ["Active", "Needs Fix", "Blocked", "Accepted", "Accepted With Risk", "Invalid State"], file)
  validateEnum(metadata, "execution_state", ["Ready", "In Progress", "Ready for Review", "Ready for Independent Acceptance", "Needs Fix", "Blocked", "Invalid State"], file)
  validateEnum(metadata, "alignment_state", ["Aligned", "At Risk", "Locally Compliant, Globally Misaligned", "Owner Review Required"], file)
  validateEnum(metadata, "stage_review", ["Not Reviewed", "Passed", "Needs Fix", "Blocked"], file)
  validateEnum(metadata, "qa_decision", ["Not Reviewed", "Accepted", "Accepted With Risk", "Failed", "Blocked", "Not Required"], file)
  validateEnum(metadata, "size", ["Small", "Medium", "Large"], file)
  validateEnum(metadata, "governance", ["Lite", "Standard", "Full"], file)
  validateEnum(metadata, "autonomy_mode", ["Bounded"], file)
  validateEnum(metadata, "acceptance_mode", ["Layered"], file)
  validateEnum(metadata, "delivery_class", ["Runtime", "Contract", "Governance", "Artifact", "Mixed"], file)
  validateEnum(metadata, "context_profile", ["Compact"], file)
  validateEnum(metadata, "outside_write_policy", ["Deny"], file)
  validateEnum(metadata, "agent_strategy", ["Isolated", "SingleAgent"], file)
  validateEnum(metadata, "context_return_policy", ["SummaryAndEvidence"], file)
  validateEnum(metadata, "shared_authority_mode", ["FingerprintAndExcerpt"], file)

  if (!Number.isInteger(metadata.max_parallel_agents) || metadata.max_parallel_agents < 1 || metadata.max_parallel_agents > 3) {
    findings.add("error", "invalid_parallel_agent_limit", "max_parallel_agents must be an integer from 1 to 3.", file)
  }
  if (typeof metadata.single_writer !== "boolean" || metadata.single_writer !== true) {
    findings.add("error", "invalid_single_writer", "single_writer must be true.", file)
  }

  if (metadata.write_scope !== ".") findings.add("error", "unsafe_write_scope", 'write_scope must be "." for the portable 2.1 contract.', file)
  if (!Number.isInteger(metadata.stage) || metadata.stage < 1 || metadata.stage > 10) findings.add("error", "invalid_stage", "stage must be an integer from 1 to 10.", file)
  if (!Number.isInteger(metadata.max_stages) || metadata.max_stages < 1 || metadata.max_stages > 10 || metadata.stage > metadata.max_stages) {
    findings.add("error", "invalid_stage_budget", "max_stages must be 1-10 and not below stage.", file)
  }

  const expectedMinutes = { Small: 30, Medium: 60, Large: 120 }
  if (expectedMinutes[metadata.size] && metadata.stage_minutes !== expectedMinutes[metadata.size]) {
    findings.add("warning", "nonstandard_stage_minutes", `${metadata.size} normally uses ${expectedMinutes[metadata.size]} stage minutes.`, file)
  }
  const governanceRank = { Lite: 1, Standard: 2, Full: 3 }
  const sizeRank = { Small: 1, Medium: 2, Large: 3 }
  if (governanceRank[metadata.governance] < sizeRank[metadata.size]) {
    findings.add("error", "governance_too_light", `${metadata.size} work cannot use ${metadata.governance} governance without re-sizing.`, file)
  }

  const oldSections = [
    "Desired Outcome",
    "User And Situation",
    "Current Stage Outcome",
    "Scope",
    "Non-Goals",
    "Acceptance Criteria",
    "Allowed Changes",
    "Protected Boundaries",
    "Evidence Required",
    "Stop Conditions",
    "Assumptions And Decisions",
    "Current Evidence",
    "One Next Action",
  ]
  for (const heading of oldSections) {
    if (!text.split(/\r?\n/).some((line) => isHeading(line, heading))) findings.add("error", "missing_section", `Active Packet is missing section: ${heading}.`, file)
  }
  const isNewPacket = missingPolicies.length === 0
  if (isNewPacket && !text.split(/\r?\n/).some((line) => isHeading(line, "Authority Sources"))) {
    findings.add("error", "missing_section", "New 2.1 Packet is missing section: Authority Sources.", file)
  }
  for (const heading of ["Desired Outcome", "Current Stage Outcome", "Scope", "Non-Goals", "Acceptance Criteria"]) {
    if (!meaningful(section(text, heading))) findings.add("error", "empty_section", `${heading} must contain meaningful content.`, file)
  }

  const nextActions = contentItems(section(text, "One Next Action"))
  if (nextActions.length !== 1) findings.add("error", "next_action_count", `Active Packet must contain exactly one next action; found ${nextActions.length}.`, file)

  if (metadata.context_profile === "Compact" && text.split(/\r?\n/).length > 120) {
    findings.add("warning", "packet_too_large", `Compact Active Packet has ${text.split(/\r?\n/).length} lines; keep it near 120 or fewer.`, file)
  }

  if (["Ready for Review", "Ready for Independent Acceptance"].includes(metadata.execution_state)) {
    if (!meaningful(section(text, "Current Evidence"))) findings.add("error", "missing_evidence", `${metadata.execution_state} requires current evidence.`, file)
    if (/^- \[ \]/m.test(section(text, "Acceptance Criteria"))) findings.add("error", "unchecked_acceptance", `${metadata.execution_state} cannot contain unchecked acceptance criteria.`, file)
  }

  if (metadata.qa_decision === "Failed" && (metadata.execution_state !== "Needs Fix" || metadata.project_state !== "Needs Fix")) {
    findings.add("error", "failed_state_mismatch", "Independent QA Failed requires execution_state and project_state to be Needs Fix.", file)
  }
  if (["Accepted", "Accepted With Risk"].includes(metadata.project_state) && !["Accepted", "Accepted With Risk", "Not Required"].includes(metadata.qa_decision)) {
    findings.add("error", "acceptance_state_mismatch", "Accepted project state requires a compatible final QA decision.", file)
  }
  if (metadata.qa_required === true && metadata.qa_decision === "Not Required") findings.add("error", "qa_requirement_mismatch", "qa_required true conflicts with Not Required.", file)
  if (metadata.alignment_state === "Locally Compliant, Globally Misaligned" && ["Ready", "In Progress", "Ready for Review", "Ready for Independent Acceptance"].includes(metadata.execution_state)) {
    findings.add("error", "misalignment_not_stopped", "Globally misaligned work must stop active execution.", file)
  }

  if (["Standard", "Full"].includes(metadata.governance) && metadata.acceptance_mode === "Layered") {
    if (metadata.execution_state === "Ready for Review" && metadata.stage_review === "Passed") {
      findings.add("error", "legacy_terminal_state", "New Standard/Full terminal work must use Ready for Independent Acceptance.", file)
    }
    if (metadata.execution_state === "Ready for Independent Acceptance") {
      if (metadata.stage_review !== "Passed") findings.add("error", "stage_review_required", "Ready for Independent Acceptance requires stage_review: Passed.", file)
      if (metadata.qa_decision !== "Not Reviewed" || metadata.project_state !== "Active") {
        findings.add("error", "premature_acceptance", "Ready for Independent Acceptance must remain Active with qa_decision: Not Reviewed.", file)
      }
    }
  }

  const criteriaLines = section(text, "Acceptance Criteria").split(/\r?\n/).filter((line) => /^\s*[-*]/.test(line))
  if (metadata.delivery_class === "Mixed") {
    const unlabeled = criteriaLines.filter((line) => !/\[(?:Runtime|Contract|Governance|Artifact)\]/i.test(line))
    if (unlabeled.length > 0) findings.add("error", "mixed_criteria_unlabeled", `Mixed delivery has ${unlabeled.length} unlabeled acceptance criterion line(s).`, file, { count: unlabeled.length })
  }
  if (["Contract", "Governance", "Artifact"].includes(metadata.delivery_class) && runtimeOverclaim(text)) {
    findings.add("error", "claim_class_mismatch", `${metadata.delivery_class} evidence cannot be reported as Runtime completion.`, file)
  }
  if (metadata.delivery_class === "Runtime" && ["Ready for Independent Acceptance", "Accepted", "Accepted With Risk"].includes(metadata.execution_state) && !functionalEvidencePresent(text)) {
    findings.add("error", "missing_functional_evidence", "A terminal Runtime claim requires functional or user-flow evidence.", file)
  }

  const sources = authoritySources(text)
  if (isNewPacket && sources.length === 0) findings.add("error", "missing_authority_sources", "New 2.1 Packet requires at least one authority source.", file)
  const validSources = []
  for (const source of sources) {
    try {
      const target = assertInside(root, resolve(root, source), "authority source")
      if (!existsSync(target) || !statSync(target).isFile()) {
        findings.add("warning", "missing_authority_source", `Authority source does not exist: ${source}.`, file)
      } else validSources.push(source)
    } catch (error) {
      findings.add("error", "authority_path_escape", error.message, file)
    }
  }
  if (metadata.authority_fingerprint && !/^sha256:[a-f0-9]{64}$/i.test(metadata.authority_fingerprint)) {
    findings.add("error", "invalid_authority_fingerprint", "authority_fingerprint must be sha256 followed by 64 hexadecimal characters.", file)
  } else if (metadata.authority_fingerprint && validSources.length === sources.length && sources.length > 0) {
    try {
      const computed = computeAuthorityFingerprint(root, validSources).fingerprint
      if (computed.toLowerCase() !== String(metadata.authority_fingerprint).toLowerCase()) {
        findings.add("error", "authority_fingerprint_changed", "Authority files changed after the Packet fingerprint was recorded; run formal alignment.", file)
      }
    } catch (error) {
      findings.add("error", "authority_fingerprint_error", error.message, file)
    }
  }

  return { metadata, text, file }
}

function validateLoopRuns(root, docs, inventory) {
  const loopFile = inventory.files.find((file) => basename(file.relative).toLowerCase() === "loop_runs.jsonl" && resolve(file.path).toLowerCase().startsWith(resolve(docs.path).toLowerCase()))
  if (!loopFile) {
    findings.add("warning", "missing_loop_runs", "No loop-run evidence was found.", `${projectRelative(root, docs.path)}/LOOP_RUNS.jsonl`)
    return { records: [], statistics: { total_records: 0, legacy_records: 0, invalid_records: 0, full_regression_runs: 0 } }
  }

  const file = loopFile.relative
  let text
  try {
    text = readUtf8Inside(root, loopFile.path, 16 * 1024 * 1024)
  } catch (error) {
    findings.add("error", "loop_runs_read_error", error.message, file)
    return { records: [], statistics: { total_records: 0, legacy_records: 0, invalid_records: 0, full_regression_runs: 0 } }
  }

  const records = []
  let totalRecords = 0
  let legacyRecords = 0
  let invalidRecords = 0
  let legacyMissingFields = 0
  let newMissingFields = 0
  let fullRegressionRuns = 0
  const legacySamples = []
  const invalidSamples = []
  const newMissingSamples = []
  const oldRequired = ["contract_version", "timestamp", "packet_id", "stage", "loop", "result", "summary", "evidence", "next_action"]
  const required21 = ["record_version", "contract_version", "timestamp", "packet_id", "stage", "loop", "role", "result", "progress_delta", "evidence", "failure_signature", "stage_review", "context_stats", "next_action"]

  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return
    const lineNumber = index + 1
    totalRecords += 1
    let record
    try {
      record = JSON.parse(line)
    } catch {
      invalidRecords += 1
      if (invalidSamples.length < 5) invalidSamples.push(`line ${lineNumber}`)
      recordHistoryDetail({ line: lineNumber, code: "invalid_jsonl" })
      return
    }
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      invalidRecords += 1
      if (invalidSamples.length < 5) invalidSamples.push(`line ${lineNumber}`)
      recordHistoryDetail({ line: lineNumber, code: "invalid_record" })
      return
    }

    const enriched = { ...record, __line: lineNumber }
    records.push(enriched)
    if (record.record_version !== "2.1") {
      legacyRecords += 1
      const missing = oldRequired.filter((field) => record[field] === undefined)
      legacyMissingFields += missing.length
      if (legacySamples.length < 5) legacySamples.push(`line ${lineNumber}`)
      if (missing.length > 0) recordHistoryDetail({ line: lineNumber, code: "legacy_missing_fields", fields: missing })
    } else {
      const missing = required21.filter((field) => record[field] === undefined)
      newMissingFields += missing.length
      if (missing.length > 0) {
        if (newMissingSamples.length < 5) newMissingSamples.push(`line ${lineNumber}: ${missing.join(", ")}`)
        recordHistoryDetail({ line: lineNumber, code: "missing_2_1_log_fields", fields: missing })
      }
    }

    if (record.contract_version && record.contract_version !== "2.0") findings.add("warning", "old_log_contract", `Loop record line ${lineNumber} uses contract version ${record.contract_version}.`, file)
    if (record.record_version === "2.1" && !["Controller", "Developer", "Stage Reviewer", "Independent QA", "Alignment Reviewer"].includes(record.role)) {
      findings.add("error", "invalid_log_role", `Loop record line ${lineNumber} has invalid role: ${record.role}.`, file)
    }
    if (record.role === "Stage Reviewer" && /^(?:Accepted|Accepted With Risk)$/i.test(String(record.result ?? record.qa_decision ?? ""))) {
      findings.add("error", "stage_reviewer_final_acceptance", `Stage Reviewer on line ${lineNumber} attempted final acceptance.`, file)
    }
    if (record.context_stats && typeof record.context_stats === "object") {
      const numericFields = ["context_files", "context_chars", "tool_output_chars", "full_regression_runs"]
      for (const field of numericFields) {
        if (record.context_stats[field] !== undefined && (!Number.isFinite(record.context_stats[field]) || record.context_stats[field] < 0)) {
          findings.add("warning", "invalid_context_stat", `Loop record line ${lineNumber} has invalid ${field}.`, file)
        }
      }
      if (Number.isFinite(record.context_stats.full_regression_runs)) fullRegressionRuns += record.context_stats.full_regression_runs
    }
  })

  if (invalidRecords > 0) findings.add("error", "invalid_jsonl", `${invalidRecords} loop record(s) are invalid JSON or non-object values.`, file, { count: invalidRecords, samples: invalidSamples })
  if (legacyRecords > 0) findings.add("warning", "legacy_history_records", `${legacyRecords} legacy loop record(s) are retained for aggregate reporting.`, file, { count: legacyRecords, samples: legacySamples })
  if (legacyMissingFields > 0) findings.add("warning", "legacy_history_missing_fields", `${legacyMissingFields} legacy field gaps were aggregated; use --strict-history for line-level detail.`, file, { count: legacyMissingFields, samples: legacySamples })
  if (newMissingFields > 0) findings.add("warning", "missing_2_1_log_fields", `${newMissingFields} required 2.1 field gaps were found.`, file, { count: newMissingFields, samples: newMissingSamples })

  for (let index = 1; index < records.length; index += 1) {
    const previous = records[index - 1]
    const current = records[index]
    if (!current.failure_signature || current.failure_signature !== previous.failure_signature) continue
    const noProgress = [previous.progress_delta, current.progress_delta].every((value) => !value || /^(?:none|no progress|unchanged|无|没有进展)$/i.test(String(value).trim()))
    if (noProgress && !["Needs Fix", "Blocked"].includes(current.result)) {
      findings.add("error", "failure_budget_exhausted", `Failure signature ${current.failure_signature} repeated without new evidence on lines ${previous.__line} and ${current.__line}.`, file)
    }
  }

  return {
    records,
    statistics: {
      total_records: totalRecords,
      legacy_records: legacyRecords,
      invalid_records: invalidRecords,
      legacy_missing_fields: legacyMissingFields,
      new_missing_fields: newMissingFields,
      full_regression_runs: fullRegressionRuns,
    },
  }
}

function crossValidate(packet, loop) {
  const metadata = packet.metadata
  if (!metadata) return
  if (["Standard", "Full"].includes(metadata.governance) && metadata.acceptance_mode === "Layered" && ["Accepted", "Accepted With Risk"].includes(metadata.project_state)) {
    const independent = loop.records.some((record) => record.role === "Independent QA" && ["Accepted", "Accepted With Risk"].includes(record.result ?? record.qa_decision))
    if (!independent) findings.add("error", "missing_independent_acceptance_evidence", "Accepted Standard/Full work has no Independent QA loop evidence.", packet.file)
  }
}

function printHuman(result) {
  console.log(`Agent Loop State Validator v${TOOL_VERSION}`)
  console.log(`Workspace: ${result.workspace}`)
  console.log(`Docs: ${result.docs_directory ?? "not found"}`)
  for (const finding of result.findings) {
    const location = finding.file ? ` ${finding.file}` : ""
    const count = finding.count > 1 ? ` x${finding.count}` : ""
    console.log(`- ${finding.level.toUpperCase()} [${finding.code}]${count}${location}: ${finding.message}`)
    if (!summaryOnly && finding.samples.length > 0) console.log(`  Samples: ${finding.samples.join(", ")}`)
  }
  if (result.summary.finding_groups === 0) console.log("PASS: state contract is consistent.")
  if (result.summary.findings_truncated) console.log(`Details capped at ${result.summary.detailed_findings_returned}; use --max-findings or --strict-history to expand.`)
  console.log(`Summary: ${result.summary.errors} error occurrence(s), ${result.summary.warnings} warning occurrence(s), ${result.summary.finding_groups} category group(s).`)
  if (strictHistory && historyDetails.length > 0) {
    console.log("Strict history detail:")
    for (const detail of historyDetails) console.log(`- line ${detail.line}: ${detail.code}${detail.fields ? ` (${detail.fields.join(", ")})` : ""}`)
  }
}

function main() {
  let root
  let docs
  let inventory = { files: [], skipped: [], truncated: false }
  try {
    root = resolveWorkspace(workspaceInput)
    docs = findDocsDirectory(root)
    inventory = walkMetadata(root, docs.path)
    for (const skipped of inventory.skipped) {
      const level = skipped.reason === "outside_workspace" ? "error" : "warning"
      findings.add(level, skipped.reason === "outside_workspace" ? "path_escape" : "inventory_truncated", `Inventory skipped ${skipped.path}: ${skipped.reason}.`)
    }
  } catch (error) {
    findings.add("error", "workspace_error", error.message)
  }

  let packet = { metadata: undefined, text: "", file: undefined }
  let loop = { records: [], statistics: { total_records: 0, legacy_records: 0, invalid_records: 0, full_regression_runs: 0 } }
  if (root && docs) {
    packet = validatePacket(root, docs, inventory)
    loop = validateLoopRuns(root, docs, inventory)
    crossValidate(packet, loop)
  }

  const resultData = findings.result(maxFindings)
  const result = {
    tool: "validate-loop-state",
    version: TOOL_VERSION,
    workspace: root ?? resolve(workspaceInput),
    docs_directory: root && docs ? projectRelative(root, docs.path) : null,
    findings: resultData.findings,
    summary: resultData.summary,
    history: {
      ...loop.statistics,
      strict: strictHistory,
      ...(strictHistory ? { details: historyDetails } : {}),
    },
  }

  if (jsonOutput) console.log(safeJson(result))
  else printHuman(result)
  process.exitCode = result.summary.errors > 0 ? 1 : 0
}

main()
