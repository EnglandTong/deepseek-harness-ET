// Keyless mock adapter for the desktop echo profiles. Registers one provider
// route `mock-echo` on the llm service and streams the conversation's last
// user text back as the reply, so the shell exercises streaming, tool-card
// chrome, and the session lifecycle without a model key.
//
// Plain-object adapter: the runtime contract is the `stream()` method plus
// the optional metadata hooks (see `LlmAdapter` in @deepseek-ai/dsh-llm), and
// `registerAdapter()` validates provider metadata structurally, not by class
// identity. No import of any host package keeps this file loadable from any
// checkout layout.

export const name = 'mock-llm'
export const inject = ['llm']

export function apply(ctx) {
  ctx.llm.registerAdapter(['mock-echo'], {
    providerInfo(provider) {
      return { id: provider, name: 'Mock Echo' }
    },
    providerRetryPolicy() {
      return undefined
    },
    resolveModel(provider, model) {
      return Promise.resolve({ provider, id: model, name: model })
    },
    listModels() {
      return Promise.resolve([{ id: 'mock-echo', name: 'Mock Echo' }])
    },
    async *stream(options) {
      const lastUser = [...(options.messages ?? [])].reverse().find((m) => m.role === 'user')
      const asked = (lastUser?.content ?? [])
        .map((b) => (b && b.type === 'text' ? b.text : ''))
        .filter(Boolean)
        .join('\n')
      const reply = `[mock-echo] ${asked || '(empty prompt)'}`
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: reply }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  })
}
