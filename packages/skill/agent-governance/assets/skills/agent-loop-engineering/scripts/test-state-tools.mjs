#!/usr/bin/env node

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const bootstrapScript = join(scriptDirectory, "bootstrap-active-packet.mjs")
const validatorScript = join(scriptDirectory, "validate-loop-state.mjs")
const temporaryRoot = mkdtempSync(join(tmpdir(), "agent-loop-2.1-"))
let passed = 0

function fixture(name) {
  const root = join(temporaryRoot, name)
  mkdirSync(join(root, "Docs"), { recursive: true })
  return root
}

function write(root, relativePath, content) {
  const destination = join(root, relativePath)
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, content.trimStart().replace(/\n/g, "\r\n"), "utf8")
}

function baseLegacy(root, route = "R23") {
  write(root, "Docs/TARGET.md", `
# ${route} Current Target

Current Route: ${route}

## Desired Outcome

Operators can export a verified report from the application.

## Scope

- Export one report from the current application flow.

## Non-Goals

- No production deployment.
`)
  write(root, "Docs/ACCEPTANCE.md", `
# ${route} Acceptance

Current Route: ${route}

## Acceptance Criteria

- [ ] Export succeeds through the operator flow and the file can be opened.
`)
  write(root, `Docs/CURRENT_WORK_ORDER_${route}.md`, `
# Current Work Order ${route}

Current Assignment: ${route}

## Scope

- Implement the authorized export flow.

## Current Stage Outcome

Reproduce the flow and deliver the first verifiable slice.

## One Next Action

- Run the focused export-flow baseline.
`)
}

function runJson(script, root, extra = []) {
  const execution = spawnSync(process.execPath, [script, "--workspace", root, "--json", ...extra], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  })
  let data
  try {
    data = JSON.parse(execution.stdout)
  } catch (error) {
    throw new Error(`Could not parse ${basename(script)} output (exit ${execution.status}).\nSTDOUT:\n${execution.stdout}\nSTDERR:\n${execution.stderr}`)
  }
  return { ...execution, data }
}

function test(name, callback) {
  try {
    callback()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}: ${error.stack ?? error.message}`)
    throw error
  }
}

function loopRecord(overrides) {
  return JSON.stringify({
    record_version: "2.1",
    contract_version: "2.0",
    timestamp: "2026-08-13T00:00:00Z",
    packet_id: "R23-BOOTSTRAP",
    stage: 1,
    loop: 1,
    role: "Developer",
    result: "Progress",
    progress_delta: "A focused check changed from failing to passing.",
    evidence: ["work/evidence.log"],
    failure_signature: null,
    stage_review: "Not Reviewed",
    context_stats: {
      context_files: 5,
      context_chars: 12000,
      tool_output_chars: 900,
      full_regression_runs: 0,
    },
    next_action: "Continue the current stage.",
    ...overrides,
  })
}

try {
  test("conflict-free bootstrap remains compact and writes one packet", () => {
    const root = fixture("coherent")
    baseLegacy(root)
    const preview = runJson(bootstrapScript, root, ["--language", "zh-CN"])
    assert.equal(preview.status, 0)
    assert.equal(preview.data.written, false)
    assert.equal(preview.data.conflicts.length, 0)
    assert.ok(preview.data.packet.line_count <= 120)
    assert.equal(preview.data.packet.next_action_count, 1)
    assert.equal(existsSync(join(root, "Docs/ACTIVE_PACKET.md")), false)

    const written = runJson(bootstrapScript, root, ["--language", "zh-CN", "--write"])
    assert.equal(written.status, 0)
    assert.equal(written.data.written, true)
    assert.equal(existsSync(join(root, "Docs/ACTIVE_PACKET.md")), true)
    const packet = readFileSync(join(root, "Docs/ACTIVE_PACKET.md"), "utf8")
    assert.match(packet, /当前执行包/)
    assert.equal((packet.match(/^## One Next Action/gm) ?? []).length, 1)
  })

  test("R21 and R23 current-route conflict causes zero writes", () => {
    const root = fixture("route-conflict")
    baseLegacy(root, "R21")
    write(root, "Docs/ACCEPTANCE.md", `
# R23 Acceptance
Current Route: R23
## Acceptance Criteria
- [ ] R23 runtime flow passes.
`)
    const result = runJson(bootstrapScript, root, ["--write"])
    assert.equal(result.status, 2)
    assert.ok(result.data.conflicts.some((item) => item.code === "active_route_conflict"))
    assert.equal(result.data.written, false)
    assert.equal(existsSync(join(root, "Docs/ACTIVE_PACKET.md")), false)
  })

  test("QA heading and superseding body decision conflict causes zero writes", () => {
    const root = fixture("qa-conflict")
    baseLegacy(root)
    write(root, "Docs/QA_DECISION_CURRENT.md", `
# QA Decision: Accepted

Evidence was initially believed sufficient.

Superseding Decision: Failed
`)
    const result = runJson(bootstrapScript, root, ["--write"])
    assert.equal(result.status, 2)
    assert.ok(result.data.conflicts.some((item) => item.code === "qa_decision_conflict"))
    assert.equal(result.data.written, false)
  })

  test("multiple Current Assignment routes are rejected", () => {
    const root = fixture("assignment-conflict")
    baseLegacy(root, "M66")
    write(root, "Docs/CURRENT_ASSIGNMENT_M67.md", `
# Current Assignment M67
Current Assignment: M67
`)
    const result = runJson(bootstrapScript, root)
    assert.equal(result.status, 2)
    assert.ok(result.data.conflicts.some((item) => item.code === "multiple_current_assignments"))
  })

  test("explicit Current Effective override supersedes old routes", () => {
    const root = fixture("current-override")
    baseLegacy(root, "M56")
    write(root, "Docs/ACCEPTANCE.md", `
# M57 Acceptance
Current Route: M57
## Acceptance Criteria
- [ ] The current learning flow is verified.
`)
    write(root, "Docs/CURRENT_ASSIGNMENT_M57.md", `
# Current Assignment M57
Current Assignment: M57
## Scope
- Verify the current learning flow.
## One Next Action
- Reproduce the current flow.
`)
    write(root, "Docs/CURRENT_OVERRIDE.md", `
# Current Override
Current Effective: M66
Reason: M66 is the Owner-approved route; M56 and M57 are history.
`)
    const result = runJson(bootstrapScript, root)
    assert.equal(result.status, 0)
    assert.equal(result.data.conflicts.length, 0)
    assert.match(result.data.packet.preview, /packet_id: "M66-BOOTSTRAP"/)
    assert.ok(result.data.warnings.some((item) => item.code === "older_routes_superseded"))
  })

  test("historical Old directory cannot become current authority", () => {
    const root = fixture("old-directory")
    baseLegacy(root, "R23")
    write(root, "Docs/Old/App-Internal/TARGET.md", `
# R99 Old Target
Current Route: R99
`)
    write(root, "Docs/Old/App-Internal/ACCEPTANCE.md", `
# R99 Old Acceptance
Current Route: R99
`)
    const result = runJson(bootstrapScript, root)
    assert.equal(result.status, 0)
    assert.equal(result.data.conflicts.length, 0)
    assert.ok(!result.data.files_read.some((file) => /(?:^|\/)Old(?:\/|$)/i.test(file)))
    assert.match(result.data.packet.preview, /packet_id: "R23-BOOTSTRAP"/)
  })

  test("Contract evidence cannot be promoted to Runtime completion", () => {
    const root = fixture("contract-overclaim")
    baseLegacy(root)
    write(root, "Docs/TARGET.md", `
# R23 Current Target
Current Route: R23
delivery_class: Contract
## Desired Outcome
Define the export interface contract.
Runtime feature: Accepted and usable.
## Scope
- Add interface types.
## Non-Goals
- No runtime implementation.
`)
    const result = runJson(bootstrapScript, root, ["--write"])
    assert.equal(result.status, 2)
    assert.ok(result.data.conflicts.some((item) => item.code === "claim_class_mismatch"))
    assert.equal(result.data.written, false)
  })

  test("legacy JSONL field gaps are aggregated and findings are capped", () => {
    const root = fixture("legacy-history")
    baseLegacy(root)
    const bootstrap = runJson(bootstrapScript, root, ["--write"])
    assert.equal(bootstrap.status, 0)
    const lines = []
    for (let index = 0; index < 600; index += 1) lines.push(JSON.stringify({ timestamp: `2026-01-01T00:00:${String(index % 60).padStart(2, "0")}Z` }))
    write(root, "Docs/LOOP_RUNS.jsonl", `${lines.join("\n")}\n`)
    const result = runJson(validatorScript, root, ["--summary", "--max-findings", "20"])
    assert.equal(result.status, 0)
    assert.ok(result.data.findings.length <= 20)
    assert.equal(result.data.history.legacy_records, 600)
    assert.ok(result.data.summary.category_counts.legacy_history_missing_fields >= 1000)
    assert.equal(result.data.history.strict, false)
  })

  test("linked authority path escape is rejected before writing", () => {
    const root = fixture("path-escape")
    baseLegacy(root)
    write(temporaryRoot, "outside.md", "# Outside authority\n")
    const targetPath = join(root, "Docs/TARGET.md")
    writeFileSync(targetPath, `${readFileSync(targetPath, "utf8")}\r\n[Outside](../../outside.md)\r\n`, "utf8")
    const result = runJson(bootstrapScript, root, ["--write"])
    assert.equal(result.status, 2)
    assert.ok(result.data.conflicts.some((item) => item.code === "authority_path_escape"))
    assert.equal(result.data.written, false)
  })

  test("Stage Reviewer failure repair and pass stops before independent acceptance", () => {
    const root = fixture("layered-review")
    baseLegacy(root)
    const bootstrap = runJson(bootstrapScript, root, ["--write"])
    assert.equal(bootstrap.status, 0)
    const packetPath = join(root, "Docs/ACTIVE_PACKET.md")
    let packet = readFileSync(packetPath, "utf8")
    packet = packet
      .replace('execution_state: "Ready"', 'execution_state: "Ready for Independent Acceptance"')
      .replace('stage_review: "Not Reviewed"', 'stage_review: "Passed"')
      .replace(/- \[ \] AC-/g, "- [x] AC-")
      .replace("- Read-only bootstrap inventory and authority conflict checks passed.", "- Functional user-flow evidence passed: `work/export-e2e.log`.")
    writeFileSync(packetPath, packet, "utf8")

    const records = [
      loopRecord({
        loop: 1,
        role: "Stage Reviewer",
        result: "Needs Fix",
        progress_delta: "Primary flow failed at file creation.",
        failure_signature: "export-flow:EACCES",
        stage_review: "Needs Fix",
        next_action: "Repair output-path handling.",
      }),
      loopRecord({
        loop: 2,
        role: "Developer",
        result: "Progress",
        progress_delta: "Output-path handling was repaired and the focused check passes.",
        failure_signature: "export-flow:EACCES",
        stage_review: "Needs Fix",
        next_action: "Re-run Stage Review.",
      }),
      loopRecord({
        loop: 3,
        role: "Stage Reviewer",
        result: "Passed",
        progress_delta: "Focused and functional evidence now satisfy AC-01.",
        failure_signature: null,
        stage_review: "Passed",
        next_action: "Hand evidence to an independent QA task.",
      }),
    ]
    write(root, "Docs/LOOP_RUNS.jsonl", `${records.join("\n")}\n`)
    const result = runJson(validatorScript, root, ["--summary", "--max-findings", "20"])
    assert.equal(result.status, 0)
    assert.equal(result.data.summary.errors, 0)
    const finalPacket = readFileSync(packetPath, "utf8")
    assert.match(finalPacket, /execution_state: "Ready for Independent Acceptance"/)
    assert.match(finalPacket, /qa_decision: "Not Reviewed"/)
    assert.match(finalPacket, /project_state: "Active"/)
  })

  test("Stage Reviewer cannot sign final acceptance", () => {
    const root = fixture("stage-reviewer-acceptance")
    baseLegacy(root)
    const bootstrap = runJson(bootstrapScript, root, ["--write"])
    assert.equal(bootstrap.status, 0)
    write(root, "Docs/LOOP_RUNS.jsonl", `${loopRecord({ role: "Stage Reviewer", result: "Accepted", stage_review: "Passed" })}\n`)
    const result = runJson(validatorScript, root, ["--summary"])
    assert.equal(result.status, 1)
    assert.ok(result.data.findings.some((item) => item.code === "stage_reviewer_final_acceptance"))
  })

  test("unsafe write scope and outside-write policy are rejected", () => {
    const root = fixture("unsafe-write-policy")
    baseLegacy(root)
    const bootstrap = runJson(bootstrapScript, root, ["--write"])
    assert.equal(bootstrap.status, 0)
    const packetPath = join(root, "Docs/ACTIVE_PACKET.md")
    const unsafe = readFileSync(packetPath, "utf8")
      .replace('write_scope: "."', 'write_scope: ".."')
      .replace('outside_write_policy: "Deny"', 'outside_write_policy: "Allow"')
    writeFileSync(packetPath, unsafe, "utf8")
    const result = runJson(validatorScript, root, ["--summary"])
    assert.equal(result.status, 1)
    assert.ok(result.data.findings.some((item) => item.code === "unsafe_write_scope"))
    assert.ok(result.data.findings.some((item) => item.code === "invalid_value"))
  })

  test("unsafe parallel delegation settings are rejected", () => {
    const root = fixture("unsafe-delegation-policy")
    baseLegacy(root)
    const bootstrap = runJson(bootstrapScript, root, ["--write"])
    assert.equal(bootstrap.status, 0)
    const packetPath = join(root, "Docs/ACTIVE_PACKET.md")
    const unsafe = readFileSync(packetPath, "utf8")
      .replace("max_parallel_agents: 3", "max_parallel_agents: 9")
      .replace("single_writer: true", "single_writer: false")
    writeFileSync(packetPath, unsafe, "utf8")
    const result = runJson(validatorScript, root, ["--summary"])
    assert.equal(result.status, 1)
    assert.ok(result.data.findings.some((item) => item.code === "invalid_parallel_agent_limit"))
    assert.ok(result.data.findings.some((item) => item.code === "invalid_single_writer"))
  })

  console.log(`\n${passed} state-tool regression tests passed.`)
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
