import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider, ProviderError } from '../dist/index.js';
import { fixture } from '../dist/conformance/fixtures.js';
const request = { messages: [{ role: 'user', content: 'synthetic' }] };
const make = (fetch, extra = {}) => createProvider({ provider: 'openai', endpoint: 'https://fixture.invalid/chat', model: 'synthetic', fetch, ...extra });
test('OpenAI-compatible per-call extension bag survives and is origin-scoped', async () => {
  const first = fixture('openai', true);
  first.choices[0].message.tool_calls[0].extra_content = { google: { thought_signature: 'SYNTHETIC-SIGNATURE' }, future: { flag: true } };
  const turn = await make(async () => Response.json(first)).chat(request);
  const history = [...request.messages, { role: 'assistant', toolCalls: turn.toolCalls }, { role: 'tool', toolCallId: 'call-1', content: 'synthetic' }];
  for (const [endpoint, preserved] of [['https://fixture.invalid/chat', true], ['https://other.invalid/chat', false]]) {
    await make(async (_url, init) => { assert.equal(init.body.includes('SYNTHETIC-SIGNATURE'), preserved); return Response.json(fixture('openai')); }, { endpoint }).chat({ messages: history });
  }
});
test('OpenAI reasoning continuation persists without visible text leakage', async () => {
  const body = fixture('openai'); body.choices[0].message.reasoning_content = 'SYNTHETIC-REASONING';
  const turn = await make(async () => Response.json(body)).chat(request);
  assert.equal(turn.text, 'done');
  await make(async (_url, init) => { assert.ok(init.body.includes('SYNTHETIC-REASONING')); return Response.json(fixture('openai')); }).chat({ messages: [{ role: 'assistant', content: turn.text, continuation: turn.continuation }] });
});
test('Gemini missing wire ids are not invented in outbound function responses', async () => {
  const body = fixture('gemini', true); delete body.candidates[0].content.parts[0].functionCall.id;
  const options = { provider: 'gemini' };
  const turn = await make(async () => Response.json(body), options).chat(request);
  await make(async (_url, init) => { const response = JSON.parse(init.body).contents.at(-1).parts[0].functionResponse; assert.equal(response.id, undefined); assert.equal(response.name, 'echo'); return Response.json(fixture('gemini')); }, options).chat({ messages: [...request.messages, { role: 'assistant', toolCalls: turn.toolCalls, continuation: turn.continuation }, { role: 'tool', toolCallId: turn.toolCalls[0].id, content: 'synthetic' }] });
});
test('error body budget discards long sensitive echoes before truncation', async () => {
  await assert.rejects(make(async () => new Response('SYNTHETIC-SENSITIVE'.repeat(10_000), { status: 400 }), { maxErrorBytes: 8 }).chat(request), err => err instanceof ProviderError && !String(err).includes('SYNTHETIC-SENSITIVE'));
});
test('stalled error body is bounded by total timeout', async () => {
  await assert.rejects(make(async () => new Response(new ReadableStream({ start() {} }), { status: 400 }), { timeoutMs: 20 }).chat(request), err => err.failure.kind === 'timeout');
});
test('cancellation during injected retry sleep is final', async () => {
  const controller = new AbortController(); let calls = 0;
  const provider = make(async () => { calls++; return new Response('', { status: 503 }); }, { maxRetries: 2, sleep: async () => { controller.abort(); await new Promise(() => {}); } });
  await assert.rejects(provider.chat({ ...request, signal: controller.signal }), err => err.failure.kind === 'cancelled'); assert.equal(calls, 1);
});
test('invalid metadata cannot override auth headers or inject newlines', async () => {
  let calls = 0;
  const provider = make(async (_url, init) => { calls++; assert.equal(init.headers['x-client-trace'], 'synthetic'); return Response.json(fixture('openai')); });
  await provider.chat({ ...request, metadata: { trace: 'synthetic' } });
  await assert.rejects(provider.chat({ ...request, metadata: { trace: 'bad\r\nvalue' } }), err => err.failure.kind === 'invalid_request'); assert.equal(calls, 1);
});
test('caller mutation of options does not redirect an existing instance', async () => {
  const options = { provider: 'openai', endpoint: 'https://fixture.invalid/chat', model: 'synthetic', fetch: async () => Response.json(fixture('openai')) };
  const provider = createProvider(options); options.provider = 'gemini'; options.endpoint = 'https://other.invalid';
  assert.equal((await provider.chat(request)).text, 'done'); assert.equal(provider.id, 'openai');
});
