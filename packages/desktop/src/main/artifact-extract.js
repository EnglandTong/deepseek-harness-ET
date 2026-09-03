// Pure extraction helpers for the artifact IPC surface — no Electron import,
// so node --test can require this module directly. The ipc/electron side
// (artifact-ipc.js) imports these; the heuristics stay testable in plain Node.

'use strict'

// Best-effort path extraction from a tool/result payload. Tool results carry
// heterogeneous shapes across the codebase; we look at a small set of
// well-known fields plus any text block that contains an artifact-like path.
function extractPathCandidates(data) {
  const out = []
  const push = (v) => { if (typeof v === 'string' && v.length > 0) out.push(v) }
  push(data && data.filePath)
  push(data && data.path)
  push(data && data.file)
  push(data && data.meta && data.meta.filePath)
  push(data && data.meta && data.meta.path)
  if (Array.isArray(data.content)) {
    for (const block of data.content) {
      if (block && block.type === 'text' && typeof block.text === 'string') {
        // Match anything that looks like a workspace file path ending in an
        // artifact-eligible extension. Kept intentionally narrow so noisy
        // tool output doesn't false-positive.
        const m = block.text.match(/[\w./\\-]+\.(?:html|svg|md)\b/g)
        if (m) for (const p of m) push(p)
      }
    }
  }
  return out
}

// Pull the shell command string out of a bash tool/call. The wire ships
// `arguments` either as a JSON string (jsonrpc profile) or a decoded object
// (daemon paths). Both shapes carry `.command`.
function extractBashCommand(data) {
  let args = data && data.arguments
  if (typeof args === 'string') { try { args = JSON.parse(args) } catch { return null } }
  if (!args || typeof args !== 'object') return null
  return typeof args.command === 'string' ? args.command : null
}

// From a bash command string, pluck any artifact-eligible target paths the
// command is writing to. Recognises the four common write shapes:
//   cat <<EOF > /path/foo.svg
//   echo … > /path/foo.html
//   printf … > /path/foo.md   (redirection form)
//   tee /path/foo.svg <<EOF
// We deliberately stay narrow: only extension-matching paths, only after a
// write operator. Wildcards and pipelines aren't targeted — those write
// through fs primitives we can't statically pull from a shell string.
function extractBashTargetPaths(cmd) {
  const paths = []
  // Redirection targets: `> /path/foo.svg` or `>> /path/foo.html`
  for (const m of cmd.matchAll(/>{1,2}\s*['"]?([^\s'";|&<>]+\.(?:html|svg|md))['"]?/gi)) {
    paths.push(m[1])
  }
  // tee target
  for (const m of cmd.matchAll(/\btee\s+(?:-a\s+)?['"]?([^\s'";|&<>]+\.(?:html|svg|md))['"]?/gi)) {
    paths.push(m[1])
  }
  return paths
}

// Roots we'll try when a tool/result carries a relative path. The runtime's
// cwd is captured at spawn time in profiles.js; we can't peek at it from
// here, so we probe candidates. `dirname` is the caller module's dir; the
// sibling checkout two/three levels up covers the packaged-dev layouts.
function candidateRoots(dirname, { artifactDir, workspaceRoot, cwd, homedir } = {}) {
  const roots = []
  if (artifactDir) roots.push(artifactDir)
  // sibling checkout (most common — dev spawns run there)
  roots.push(require('node:path').resolve(dirname, '..', '..', '..', 'deepseek-harness-dev'))
  // shell workspace root
  if (workspaceRoot) roots.push(workspaceRoot)
  else roots.push(require('node:path').resolve(dirname, '..', '..'))
  // process cwd
  if (cwd) roots.push(cwd)
  // home
  if (homedir) roots.push(homedir)
  return roots
}

module.exports = { extractPathCandidates, extractBashCommand, extractBashTargetPaths, candidateRoots }
