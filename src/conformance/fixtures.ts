import type { ProviderId } from '../types.js';
/** Synthetic fixtures authored 2026-10-21. No captured responses or real state. */
export function fixture(provider: ProviderId, tool = false): unknown {
  if (provider === 'openai') return { choices: [{ message: tool ? { content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'echo', arguments: '{"value":"synthetic"}' } }] } : { content: 'done' }, finish_reason: tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 3 } };
  if (provider === 'gemini') return { candidates: [{ content: { role: 'model', parts: tool ? [{ functionCall: { id: 'call-1', name: 'echo', args: { value: 'synthetic' } }, thoughtSignature: 'SYNTHETIC-SIGNATURE' }] : [{ text: 'done' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 } };
  return { content: tool ? [{ type: 'thinking', thinking: 'SYNTHETIC-THINKING', signature: 'SYNTHETIC-SIGNATURE' }, { type: 'redacted_thinking', data: 'SYNTHETIC-OPAQUE' }, { type: 'tool_use', id: 'call-1', name: 'echo', input: { value: 'synthetic' } }] : [{ type: 'text', text: 'done' }], stop_reason: tool ? 'tool_use' : 'end_turn', usage: { input_tokens: 7, output_tokens: 3 } };
}
export const tool = Object.freeze({ name: 'echo', description: 'Synthetic schema; never executed by this library.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } });
