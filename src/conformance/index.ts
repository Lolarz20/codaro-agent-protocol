import type { ChatRequest, Message, Provider, ProviderId } from '../types.js';
import { fixture, tool } from './fixtures.js';
export interface ConformanceAdapter {
  /** Construct your adapter using only this scripted transport; no live calls are needed. */
  create(options: { readonly provider: ProviderId; readonly endpoint: string; readonly model: string; readonly fetch: typeof globalThis.fetch }): Provider;
}
export interface ConformanceResult { readonly scenario: string; readonly passed: boolean; readonly detail?: string }
export const scenarioManifest = Object.freeze(['text-and-usage', 'tool-roundtrip', 'continuation-replay', 'malformed-arguments', 'refusal', 'truncation', 'streaming-text', 'sequential-tools', 'parallel-tools', 'tool-error-recovery', 'json-persistence'] as const);
export async function runConformanceSuite(adapter: ConformanceAdapter, options: { readonly providers?: readonly ProviderId[]; readonly scenarios?: readonly string[] } = {}): Promise<readonly ConformanceResult[]> {
  if (options.providers && (!options.providers.length || options.providers.some(provider => !['openai', 'gemini', 'anthropic'].includes(provider)))) throw new Error('Unsupported or empty provider selection');
  if (options.scenarios && (!options.scenarios.length || options.scenarios.some(scenario => !(scenarioManifest as readonly string[]).includes(scenario)))) throw new Error('Unsupported or empty scenario selection');
  const results: ConformanceResult[] = [];
  for (const provider of options.providers ?? ['openai', 'gemini', 'anthropic']) {
    for (const scenario of scenarioManifest) {
      if (options.scenarios && !options.scenarios.includes(scenario)) continue;
      const captured: any[] = [];
      let turn = 0;
      const transport: typeof fetch = async (_url, init) => {
        captured.push(JSON.parse(String(init?.body)));
        const currentTurn = turn++;
        const toolScenario = ['tool-roundtrip', 'continuation-replay', 'malformed-arguments', 'sequential-tools', 'parallel-tools', 'tool-error-recovery', 'json-persistence'].includes(scenario);
        const value: any = fixture(provider, toolScenario && currentTurn < (scenario === 'sequential-tools' ? 3 : 1));
        if (scenario === 'parallel-tools' && currentTurn === 0) {
          if (provider === 'openai') { const call = structuredClone(value.choices[0].message.tool_calls[0]); call.id = 'call-2'; value.choices[0].message.tool_calls.push(call); }
          else if (provider === 'gemini') { const part = structuredClone(value.candidates[0].content.parts[0]); part.functionCall.id = 'call-2'; delete part.thoughtSignature; value.candidates[0].content.parts.push(part); }
          else { const block = structuredClone(value.content[2]); block.id = 'call-2'; value.content.push(block); }
        }
        if (scenario === 'malformed-arguments') {
          if (provider === 'openai') value.choices[0].message.tool_calls[0].function.arguments = '{';
          else if (provider === 'gemini') value.candidates[0].content.parts[0].functionCall.args = [];
          else value.content[2].input = [];
        }
        if (scenario === 'refusal' || scenario === 'truncation') {
          const refusal = scenario === 'refusal';
          if (provider === 'openai') value.choices[0].finish_reason = refusal ? 'content_filter' : 'length';
          else if (provider === 'gemini') value.candidates[0].finishReason = refusal ? 'SAFETY' : 'MAX_TOKENS';
          else value.stop_reason = refusal ? 'refusal' : 'max_tokens';
        }
        if (scenario === 'streaming-text') {
          const events = provider === 'openai' ? [{ choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] }] : provider === 'gemini' ? [value] : [{ type: 'message_start', message: { usage: value.usage } }, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, { type: 'message_stop' }];
          return new Response(events.map(v => `data: ${JSON.stringify(v)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
        }
        return Response.json(value);
      };
      try {
        const runtime = adapter.create({ provider, endpoint: 'https://fixture.invalid/models/synthetic:generateContent', model: 'synthetic', fetch: transport });
        const request: ChatRequest = { messages: [{ role: 'user', content: 'Synthetic round trip' }], tools: [tool] };
        const check = (condition: boolean) => { if (!condition) throw new Error(); };
        if (scenario === 'streaming-text') {
          let text = ''; let complete = false;
          for await (const event of runtime.chatStream(request)) { if (event.type === 'text') text += event.text; if (event.type === 'complete') complete = event.response.text === 'done'; }
          check(text === 'done' && complete);
        } else if (scenario === 'malformed-arguments') {
          let refused = false;
          try { await runtime.chat(request); } catch { refused = true; }
          check(refused);
        } else {
          const response = await runtime.chat(request);
          if (scenario === 'text-and-usage') check(response.text === 'done' && response.usage.total === 10 && response.finishReason === 'stop');
          else if (scenario === 'refusal') check(response.finishReason === 'refusal' && response.toolCalls.length === 0);
          else if (scenario === 'truncation') check(response.finishReason === 'length');
          else {
            check(response.toolCalls.length === (scenario === 'parallel-tools' ? 2 : 1) && response.toolCalls[0]?.arguments.value === 'synthetic');
            let history: Message[] = [...request.messages];
            let next = response;
            for (let round = 0; round < (scenario === 'sequential-tools' ? 3 : 1); round++) {
              history.push({ role: 'assistant', content: next.text, toolCalls: next.toolCalls, ...(next.continuation ? { continuation: next.continuation } : {}) }, ...next.toolCalls.map(call => ({ role: 'tool' as const, toolCallId: call.id, content: 'SYNTHETIC-RESULT', ...(scenario === 'tool-error-recovery' ? { isError: true } : {}) })));
              if (scenario === 'json-persistence') history = JSON.parse(JSON.stringify(history));
              next = await runtime.chat({ ...request, messages: history });
            }
            check(next.text === 'done');
            const outbound = JSON.stringify(captured.at(-1));
            check(outbound.includes('SYNTHETIC-RESULT') && outbound.includes('echo'));
            if (scenario === 'sequential-tools') check((outbound.match(/SYNTHETIC-RESULT/g) ?? []).length === 3);
            if (scenario === 'parallel-tools') check((outbound.match(/SYNTHETIC-RESULT/g) ?? []).length === 2);
            if (scenario === 'tool-error-recovery' && provider === 'anthropic') check(outbound.includes('"is_error":true'));
            if (scenario === 'tool-error-recovery' && provider === 'gemini') check(outbound.includes('"error":"SYNTHETIC-RESULT"'));
            if (scenario === 'json-persistence' && provider !== 'openai') check(outbound.includes('SYNTHETIC-SIGNATURE'));
            if (scenario === 'continuation-replay' && provider !== 'openai') check(outbound.includes('SYNTHETIC-SIGNATURE'));
            if (provider === 'anthropic' && scenario === 'continuation-replay') check(outbound.includes('SYNTHETIC-OPAQUE'));
          }
        }
        results.push({ scenario: `${provider}/${scenario}`, passed: true });
      } catch { results.push({ scenario: `${provider}/${scenario}`, passed: false, detail: 'Synthetic scenario failed; inspect your adapter locally with redacted fixtures.' }); }
    }
  }
  return results;
}
