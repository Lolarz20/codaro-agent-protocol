import type { FinishReason, Usage } from '../types.js';
export function usage(input: unknown, output: unknown, cached: unknown = 0, created: unknown = 0): Usage {
  const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
  return { input: n(input), output: n(output), cachedInput: n(cached), cacheCreationInput: n(created), total: n(input) + n(output) };
}
export function finish(reason: unknown, hasCalls: boolean): FinishReason {
  if (['content_filter', 'SAFETY', 'RECITATION', 'refusal'].includes(String(reason))) return 'refusal';
  if (['length', 'MAX_TOKENS', 'max_tokens'].includes(String(reason))) return 'length';
  if (hasCalls) return 'tool_calls';
  return ['stop', 'STOP', 'end_turn', 'stop_sequence'].includes(String(reason)) ? 'stop' : 'unknown';
}
