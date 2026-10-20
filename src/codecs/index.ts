import type { ChatRequest, ChatResponse, Scope, ToolCall } from '../types.js';
import { ProviderError, argumentsObject, record } from '../errors.js';
import { finish, usage } from './common.js';

export function encode(request: ChatRequest, scope: Scope, stream: boolean): Record<string, unknown> {
  const messages = request.messages;
  const systems = [request.systemPrompt, ...messages.filter(m => m.role === 'system').map(m => m.content)].filter(Boolean).join('\n');
  if (scope.provider === 'openai') return {
    model: scope.model,
    messages: [ ...(systems ? [{ role: 'system', content: systems }] : []), ...messages.filter(m => m.role !== 'system').map(m => ({
      role: m.role, content: m.content ?? null,
      ...(m.toolCallId === undefined ? {} : { tool_call_id: m.toolCallId }),
      ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) }, ...(call.continuation?.data.extraContent ? { extra_content: call.continuation.data.extraContent } : {}) })) } : {}),
      ...(m.continuation?.data.openai ?? {})
    })) ],
    ...(request.tools?.length ? { tools: request.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })) } : {}),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.maxTokens === undefined ? {} : { max_completion_tokens: request.maxTokens }),
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {})
  };
  if (scope.provider === 'gemini') {
    const contents: any[] = [];
    let calls: readonly ToolCall[] = [];
    let parts: any[] = [];
    for (const m of messages) {
      if (m.role === 'system') continue;
      if (m.role === 'tool') {
        const call = calls.find(c => c.id === m.toolCallId);
        if (!call) throw new ProviderError('protocol');
        const raw = parts.find(p => p.functionCall?.name === call.name && (p.functionCall.id === call.id || !p.functionCall.id));
        const part = { functionResponse: { name: call.name, ...(raw?.functionCall.id ? { id: raw.functionCall.id } : {}), response: { [m.isError ? 'error' : 'output']: m.content ?? '' } } };
        const prev = contents.at(-1);
        if (prev?.role === 'user' && prev.parts.every((p: any) => p.functionResponse)) prev.parts.push(part);
        else contents.push({ role: 'user', parts: [part] });
      } else if (m.role === 'assistant') {
        calls = m.toolCalls ?? [];
        parts = structuredClone(m.continuation?.data.parts as any[] | undefined) ?? [ ...(m.content ? [{ text: m.content }] : []), ...calls.map(c => ({ functionCall: { name: c.name, args: c.arguments } })) ];
        if (parts.length) contents.push({ role: 'model', parts });
      } else { contents.push({ role: 'user', parts: [{ text: m.content ?? '' }] }); calls = []; parts = []; }
    }
    return { contents, ...(systems ? { systemInstruction: { parts: [{ text: systems }] } } : {}),
      ...(request.tools?.length ? { tools: [{ functionDeclarations: request.tools.map(t => ({ name: t.name, description: t.description, parameters: t.inputSchema })) }] } : {}),
      generationConfig: { ...(request.temperature === undefined ? {} : { temperature: request.temperature }), ...(request.maxTokens === undefined ? {} : { maxOutputTokens: request.maxTokens }) } };
  }
  const output: any[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    let blocks: any[];
    if (m.role === 'tool') blocks = [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content ?? '', ...(m.isError ? { is_error: true } : {}) }];
    else if (m.role === 'assistant') blocks = structuredClone(m.continuation?.data.blocks as any[] | undefined) ?? [ ...(m.content ? [{ type: 'text', text: m.content }] : []), ...(m.toolCalls ?? []).map(c => ({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments })) ];
    else blocks = [{ type: 'text', text: m.content ?? '' }];
    if (!blocks.length) continue;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    if (output.at(-1)?.role === role) output.at(-1).content.push(...blocks);
    else output.push({ role, content: blocks });
  }
  return { model: scope.model, messages: output, max_tokens: request.maxTokens ?? 1024,
    ...(systems ? { system: systems } : {}), ...(stream ? { stream: true } : {}),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.tools?.length ? { tools: request.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema })) } : {}) };
}

export function decode(value: unknown, scope: Scope): ChatResponse {
  const root = record(value);
  let calls: ToolCall[] = [];
  let text = '';
  let reason: unknown;
  let state: Record<string, unknown> = {};
  let counts = usage(0, 0);
  if (scope.provider === 'openai') {
    const choice = record(root.choices?.[0]);
    const message = record(choice.message);
    if (message.content !== undefined && message.content !== null && typeof message.content !== 'string') throw new ProviderError('protocol');
    text = message.content ?? '';
    reason = message.refusal ? 'refusal' : choice.finish_reason;
    calls = (message.tool_calls ?? []).map((c: any) => ({ id: c.id, name: c.function?.name, arguments: argumentsObject(c.function?.arguments), ...(c.extra_content && typeof c.extra_content === 'object' && !Array.isArray(c.extra_content) ? { continuation: { ...scope, data: { extraContent: structuredClone(c.extra_content) } } } : {}) }));
    const extensions: Record<string, unknown> = {};
    if (typeof message.reasoning_content === 'string') extensions.reasoning_content = message.reasoning_content;
    if (Object.keys(extensions).length) state = { openai: extensions };
    counts = usage(root.usage?.prompt_tokens, root.usage?.completion_tokens, root.usage?.prompt_tokens_details?.cached_tokens);
  } else if (scope.provider === 'gemini') {
    if (root.promptFeedback?.blockReason) return { text: '', toolCalls: [], finishReason: 'refusal', usage: counts };
    const candidate = record(root.candidates?.[0]);
    const parts: any[] = candidate.content?.parts;
    if (!Array.isArray(parts)) throw new ProviderError('protocol');
    reason = candidate.finishReason;
    text = parts.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('');
    calls = parts.filter(p => p.functionCall).map((p, i) => ({ id: p.functionCall.id ?? `gemini-local-${i}`, name: p.functionCall.name, arguments: argumentsObject(p.functionCall.args) }));
    state = { parts: structuredClone(parts) };
    counts = usage(root.usageMetadata?.promptTokenCount, root.usageMetadata?.candidatesTokenCount, root.usageMetadata?.cachedContentTokenCount);
  } else {
    if (!Array.isArray(root.content)) throw new ProviderError('protocol');
    text = root.content.filter((b: any) => b.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('');
    calls = root.content.filter((b: any) => b.type === 'tool_use').map((b: any) => ({ id: b.id, name: b.name, arguments: argumentsObject(b.input) }));
    state = { blocks: structuredClone(root.content) };
    reason = root.stop_reason;
    counts = usage(root.usage?.input_tokens, root.usage?.output_tokens, root.usage?.cache_read_input_tokens, root.usage?.cache_creation_input_tokens);
  }
  const ids = new Set<string>();
  for (const c of calls) {
    if (typeof c.id !== 'string' || !c.id || typeof c.name !== 'string' || !c.name || ids.has(c.id)) throw new ProviderError('protocol');
    ids.add(c.id);
  }
  const finishReason = finish(reason, calls.length > 0);
  if (finishReason === 'refusal') calls = [];
  return { text, toolCalls: calls, usage: counts, finishReason,
    ...(Object.keys(state).length ? { continuation: { ...scope, data: state } } : {}) };
}
