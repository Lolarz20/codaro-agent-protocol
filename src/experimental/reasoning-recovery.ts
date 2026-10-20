import type { Tool, ToolCall } from '../types.js';
import { argumentsObject } from '../errors.js';
/** Experimental strict JSON-only recovery. Does not evaluate code or execute a call. */
export function recoverToolCalls(reasoning: string, tools: readonly Tool[]): readonly ToolCall[] {
  if (reasoning.length > 65_536) return [];
  try {
    const data = JSON.parse(reasoning);
    if (!Array.isArray(data.tool_calls) || data.tool_calls.length > 32) return [];
    const ids = new Set<string>();
    return data.tool_calls.map((item: any) => {
      if (typeof item.id !== 'string' || !item.id || ids.has(item.id) || !tools.some(t => t.name === item.name)) throw new Error();
      ids.add(item.id);
      return { id: item.id, name: item.name, arguments: argumentsObject(item.arguments) };
    });
  } catch { return []; }
}
