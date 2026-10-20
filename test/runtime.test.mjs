import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider, ProviderError, sanitizeSessionHistory } from '../dist/index.js';
import { fixture, tool } from '../dist/conformance/fixtures.js';
const make = (fetch, extra = {}) => createProvider({ provider: 'openai', endpoint: 'https://fixture.invalid/chat', model: 'synthetic', fetch, ...extra });
const request = { messages: [{ role: 'user', content: 'synthetic' }], tools: [tool] };
const kind = expected => err => err instanceof ProviderError && err.failure.kind === expected;
test('configuration is explicit; HTTP is allowed only for loopback', () => {
  for (const extra of [{ endpoint: undefined }, { endpoint: 'http://example.com' }, { endpoint: 'https://u:p@example.com' }, { endpoint: 'https://fixture.invalid/?key=synthetic' }, { maxRetries: 6 }, { timeoutMs: 0 }, { provider: 'other' }]) assert.throws(() => make(async () => Response.json({}), extra), kind('invalid_request'));
  assert.ok(make(async () => Response.json({}), { endpoint: 'http://127.0.0.1/chat' }));
});
for (const [status, expected, count] of [[400, 'invalid_request', 1], [401, 'auth', 1], [403, 'auth', 1], [429, 'rate_limit', 3], [503, 'server', 3], [302, 'invalid_request', 1]]) {
  test(`HTTP ${status} classification and bounded retry`, async () => {
    let calls = 0;
    const p = make(async () => { calls++; return new Response('SYNTHETIC-SENSITIVE', { status }); }, { maxRetries: 2, sleep: async () => {} });
    await assert.rejects(p.chat(request), err => kind(expected)(err) && !String(err).includes('SYNTHETIC-SENSITIVE'));
    assert.equal(calls, count);
  });
}
test('redirection is manual; credentials never reach another origin', async () => {
  let calls = 0;
  await assert.rejects(make(async (url, init) => {
    calls++; assert.equal(url, 'https://fixture.invalid/chat'); assert.equal(init.redirect, 'manual');
    assert.equal(init.headers.authorization, 'Bearer SYNTHETIC-CREDENTIAL');
    return new Response('', { status: 307, headers: { location: 'https://other.invalid' } });
  }, { credential: () => 'SYNTHETIC-CREDENTIAL' }).chat(request), kind('invalid_request'));
  assert.equal(calls, 1);
});
test('fetch exceptions are discarded and retry budget is honored', async () => {
  let calls = 0;
  await assert.rejects(make(async () => { calls++; throw new Error('SYNTHETIC-CREDENTIAL'); }, { maxRetries: 5, retryBudgetMs: 1 }).chat(request), err => kind('network')(err) && !String(err).includes('SYNTHETIC-CREDENTIAL'));
  assert.equal(calls, 1);
});
test('multiple instances do not share transport, credential or continuation', async () => {
  const seen = [];
  const providers = ['one', 'two'].map(id => make(async (_url, init) => { seen.push(init.headers.authorization); return Response.json(fixture('openai')); }, { credential: () => id }));
  await Promise.all(providers.map(p => p.chat(request)));
  assert.deepEqual(seen.sort(), ['Bearer one', 'Bearer two']);
});
test('response body byte bound', async () => {
  await assert.rejects(make(async () => new Response('x'.repeat(100)), { maxResponseBytes: 10 }).chat(request), kind('limit'));
});
test('malformed bodies and tool ids are refused without response echo', async () => {
  for (const body of ['SYNTHETIC-PRIVATE', '{}', '{"choices":[{"message":{"tool_calls":[{"id":"","function":{"name":"echo","arguments":"{}"}}]}}]}']) await assert.rejects(make(async () => new Response(body)).chat(request), err => kind('protocol')(err) && !String(err).includes('SYNTHETIC-PRIVATE'));
});
test('timeout includes stalled fetch, credential callback and body', async () => {
  for (const p of [make(() => new Promise(() => {}), { timeoutMs: 20 }), make(async () => Response.json(fixture('openai')), { credential: () => new Promise(() => {}), timeoutMs: 20 }), make(async () => new Response(new ReadableStream({ start() {} })), { timeoutMs: 20 })]) await assert.rejects(p.chat(request), kind('timeout'));
});
test('cancellation before request performs no network', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(make(async () => { calls++; return Response.json({}); }).chat({ ...request, signal: controller.signal }), kind('cancelled'));
  assert.equal(calls, 0);
});
test('cancellation during stalled request is bounded even if fetch ignores signal', async () => {
  const controller = new AbortController();
  const pending = make(() => new Promise(() => {})).chat({ ...request, signal: controller.signal });
  controller.abort(); await assert.rejects(pending, kind('cancelled'));
});
test('session repairs orphan, duplicate and unanswered results without mutation', () => {
  const history = [{ role: 'tool', toolCallId: 'orphan' }, { role: 'assistant', toolCalls: [{ id: 'a', name: 'echo', arguments: {} }, { id: 'b', name: 'echo', arguments: {} }], continuation: { provider: 'anthropic', origin: 'https://fixture.invalid', model: 'synthetic', data: { blocks: [] } } }, { role: 'tool', toolCallId: 'a', content: 'yes' }, { role: 'tool', toolCallId: 'a', content: 'duplicate' }];
  const before = JSON.stringify(history); const clean = sanitizeSessionHistory(history);
  assert.equal(JSON.stringify(history), before); assert.equal(clean.length, 2); assert.equal(clean[0].toolCalls.length, 1); assert.equal(clean[0].continuation, undefined);
  assert.deepEqual(sanitizeSessionHistory([{ role: 'assistant', toolCalls: [{ id: '', name: 'echo', arguments: {} }] }, { role: 'tool', toolCallId: '' }]).length, 2);
});
for (const change of [{ provider: 'gemini' }, { origin: 'https://other.invalid' }, { model: 'another' }]) test(`continuation scope ${JSON.stringify(change)}`, async () => {
  const scope = { provider: 'openai', origin: 'https://fixture.invalid', model: 'synthetic', ...change };
  const history = [{ role: 'assistant', content: 'hello', continuation: { ...scope, data: { openai: { reasoning_content: 'SYNTHETIC-PRIVATE' } } } }];
  await make(async (_url, init) => { assert.ok(!init.body.includes('SYNTHETIC-PRIVATE')); return Response.json(fixture('openai')); }).chat({ messages: history });
});
test('reasoning recovery is default-off and explicit opt-in only', async () => {
  const value = fixture('openai'); value.choices[0].message.reasoning_content = JSON.stringify({ tool_calls: [{ id: 'recovered', name: 'echo', arguments: {} }] });
  assert.equal((await make(async () => Response.json(value)).chat(request)).toolCalls.length, 0);
  const response = await make(async () => Response.json(value), { experimentalReasoningRecovery: true }).chat(request);
  assert.equal(response.toolCalls.length, 1); assert.equal(response.recoveredFromReasoning, true);
});
