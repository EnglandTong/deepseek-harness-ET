import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
const binScript = fileURLToPath(new URL('./fixtures/dsh-snapshot/snapshot.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/dsh-snapshot/cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

describe('workspace snapshot and multi_edit assembled snapshot', () => {
  it('applies, diffs, restores, and rolls back atomically through the shipped app', async () => {
    const run = await runLoaderSmoke({
      label: 'workspace snapshot snapshot',
      tempDirPrefix: 'headless-snapshot-workspace-',
      binScript,
      libBinScript: binScript,
      configPath,
      tsconfigPath,
      processTimeoutMs: LOADER_SMOKE_TEST_TIMEOUT_MS * 3,
    })
    expect(run.stderr).toBe('')
    const summary = JSON.parse(run.stdout) as Record<string, string>
    expect(summary.multiEdit).toContain('Applied 2 edit(s)')
    expect(summary.diff).toContain('a.txt (modified)')
    expect(summary.diff).toContain('-alpha')
    expect(summary.diff).toContain('+ALPHA')
    expect(summary.restore).toContain('Workspace restored to snapshot s1')
    expect(summary.readAfterRestore).toContain('alpha')
    expect(summary.rollbackError).toContain('multi_edit failed')
    expect(summary.rollbackError).toContain('rolled back')
    expect(summary.readAfterRollback).toContain('alpha')
    expect(summary).toMatchInlineSnapshot(`
      {
        "diff": "Diff against snapshot s1:
      {{workspace}}/a.txt (modified)
      @@ -1,1 +1,1 @@
      -alpha
      +ALPHA
      {{workspace}}/b.txt (modified)
      @@ -1,1 +1,1 @@
      -beta
      +BETA",
        "multiEdit": "Applied 2 edit(s): {{workspace}}/a.txt, {{workspace}}/b.txt",
        "readAfterRestore": "<path>{{workspace}}/a.txt</path>
      <type>file</type>
      <content>
      1: alpha

      (End of file - total 1 lines)
      </content>",
        "readAfterRollback": "<path>{{workspace}}/a.txt</path>
      <type>file</type>
      <content>
      1: alpha

      (End of file - total 1 lines)
      </content>",
        "restore": "Workspace restored to snapshot s1.
      Rewritten: {{workspace}}/a.txt, {{workspace}}/b.txt",
        "rollbackError": "Error: multi_edit failed at b.txt: FsError: old_string was not found in "{{workspace}}/b.txt". The workspace was rolled back to its pre-edit state.",
      }
    `)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS * 4)
})
