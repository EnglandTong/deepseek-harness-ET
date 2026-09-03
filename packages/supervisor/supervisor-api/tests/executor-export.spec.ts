/** Compile-time contract: foreign adapters import the executor seam from supervisor-api. */

import { describe, expect, it } from 'vitest'
import type {
  ExecutorCapabilities,
  PreparedSupervisorExecution,
  SupervisorExecutionRequest,
  SupervisorExecutorProvider,
} from '../src/executor.ts'

describe('supervisor-api executor type export', () => {
  it('accepts a structural SupervisorExecutorProvider', async () => {
    const capabilities: ExecutorCapabilities = {
      permissions: ['write'],
      background: true,
      cancellation: true,
      providers: ['governance'],
    }
    const provider: SupervisorExecutorProvider = {
      name: 'governance',
      capabilities,
      prepare(request: SupervisorExecutionRequest): Promise<PreparedSupervisorExecution> {
        expect(request.taskId).toBeDefined()
        return Promise.resolve({
          childSessionId: 'child' as PreparedSupervisorExecution['childSessionId'],
          start: () => Promise.reject(new Error('not started in type export test')),
        })
      },
    }
    expect(provider.name).toBe('governance')
    expect(provider.capabilities.providers).toEqual(['governance'])
  })
})
