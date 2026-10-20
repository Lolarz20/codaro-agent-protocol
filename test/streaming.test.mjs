import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider, ProviderError } from '../dist/index.js';
const collect = async iterable => { const items = []; for await (const item of iterable) items.push(item); return items; };
const encode = events => events.map(e => `data: ${JSON.stringify(e)}\r\n\r\n`).join('');
const request = { messages: [{ role: 'user', content: 'synthetic' }] };
const make = (body, extra = {}) => createProvider({ provider: 'openai', model: 'synthetic', endpoint: 'https://fixture.invalid/chat', fetch: async () => new Response(body), ...extra });
test('OpenAI streamed partial JSON tool arguments and UTF-8 chunk boundaries', async () => {
  const wire = encode([{ choices: [{ delta: { content: 'ą🙂', tool_calls: [{ index: 0, id: 'call-1', function: { name: 'echo', arguments: '{"val' } }] } }] }, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ue":1}' } }] }, finish_reason: 'tool_calls' }] }]);
  const bytes = new TextEncoder().encode(wire);
  const body = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
  const events = await collect(make(body).chatStream(request));
  assert.equal(events.at(-1).response.text, 'ą🙂'); assert.equal(events.at(-1).response.toolCalls[0].arguments.value, 1); assert.equal(events.filter(e => e.type === 'tool_arguments').length, 2);
});
test('Anthropic partial JSON, thinking, signatures and error results survive replay', async () => {
  const wire = encode([{ type: 'message_start', message: { usage: { input_tokens: 4 } } }, { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'SYNTHETIC' } }, { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'SYNTHETIC-SIGNATURE' } }, { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'call-1', name: 'echo', input: {} } }, { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"value":1}' } }, { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 2 } }, { type: 'message_stop' }]);
  const events = await collect(make(wire, { provider: 'anthropic' }).chatStream(request));
  const response = events.at(-1).response;
  assert.equal(response.toolCalls[0].arguments.value, 1); assert.equal(response.continuation.data.blocks[0].signature, 'SYNTHETIC-SIGNATURE'); assert.equal(response.usage.total, 6);
});
for (const [name, wire, extra, kind] of [
  ['oversize frame', 'data: ' + 'x'.repeat(200), { maxFrameBytes: 100 }, 'limit'],
  ['total size', ': ' + 'x'.repeat(200) + '\n\n', { maxStreamBytes: 100 }, 'limit'],
  ['malformed JSON', 'data: {\n\n', {}, 'protocol'],
  ['missing stop', encode([{ choices: [{ delta: { content: 'partial' } }] }]), {}, 'protocol'],
  ['truncated frame', 'data: {}', {}, 'protocol'],
  ['malformed arguments', encode([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'id', function: { name: 'echo', arguments: '{' } }] }, finish_reason: 'tool_calls' }] }]), {}, 'protocol'],
  ['invalid index', encode([{ choices: [{ delta: { tool_calls: [{ index: -1 }] } }] }]), {}, 'protocol']
]) test(`bounded stream refusal: ${name}`, async () => {
  await assert.rejects(collect(make(wire, extra).chatStream(request)), err => err instanceof ProviderError && err.failure.kind === kind);
});
test('stalled stream timeout', async () => {
  await assert.rejects(collect(make(new ReadableStream({ start() {} }), { timeoutMs: 20 }).chatStream(request)), err => err.failure.kind === 'timeout');
});
test('early iterator return cancels body', async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(encode([{ choices: [{ delta: { content: 'first' } }] }]))); }, cancel() { cancelled = true; } });
  for await (const event of make(body).chatStream(request)) { assert.equal(event.type, 'text'); break; }
  assert.equal(cancelled, true);
});
