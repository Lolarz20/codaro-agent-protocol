import type { Message, Scope } from './types.js';
/** Return a detached, API-valid history. Unanswered calls and orphan results are removed. */
export function sanitizeSessionHistory(history: readonly Message[], scope?: Scope): readonly Message[] {
  const out: Message[] = [];
  for (let i = 0; i < history.length; i++) {
    const m = structuredClone(history[i]!);
    if (m.role === 'tool') continue;
    if (m.role !== 'assistant' || !m.toolCalls?.length) { out.push(m); continue; }
    const results: Message[] = [];
    let end = i + 1;
    while (end < history.length && history[end]!.role === 'tool') end++;
    const pending = [...history.slice(i + 1, end)];
    const calls = m.toolCalls.filter(call => {
      const index = pending.findIndex(result => result.toolCallId === call.id);
      if (index < 0) return false;
      results.push(structuredClone(pending.splice(index, 1)[0]!));
      return true;
    });
    if (calls.length === m.toolCalls.length) out.push(m);
    else if (calls.length || m.content) {
      // Opaque blocks can include tool_use; partial pruning invalidates the whole continuation.
      const { continuation: _ignored, ...rest } = m;
      void _ignored;
      out.push({ ...rest, toolCalls: calls });
    }
    out.push(...results);
    i = end - 1;
  }
  return out.map(m => {
    const calls = m.toolCalls?.map(call => {
      const state = call.continuation;
      if (!state || (scope && state.provider === scope.provider && state.origin === scope.origin && state.model === scope.model)) return call;
      const { continuation: _ignored, ...rest } = call;
      void _ignored;
      return rest;
    });
    m = { ...m, ...(calls ? { toolCalls: calls } : {}) };
    const state = m.continuation;
    if (!state || (scope && state.provider === scope.provider && state.origin === scope.origin && state.model === scope.model)) return m;
    const { continuation: _ignored, ...rest } = m;
    void _ignored;
    return rest;
  });
}
