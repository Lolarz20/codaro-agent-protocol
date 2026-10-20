import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider } from '../dist/index.js';
import { runConformanceSuite, scenarioManifest } from '../dist/conformance/index.js';
for (const provider of ['openai', 'gemini', 'anthropic']) for (const scenario of scenarioManifest) {
  test(`${provider}: ${scenario}`, async () => {
    const results = await runConformanceSuite({ create: createProvider }, { providers: [provider], scenarios: [scenario] });
    assert.equal(results.length, 1); assert.equal(results[0].passed, true, JSON.stringify(results));
  });
}
test('driver accepts independent adapters and detects failure without echoing errors', async () => {
  const results = await runConformanceSuite({ create: () => ({ chat: async () => { throw new Error('SYNTHETIC-PRIVATE'); } }) }, { providers: ['openai'], scenarios: ['text-and-usage'] });
  assert.equal(results[0].passed, false); assert.ok(!JSON.stringify(results).includes('SYNTHETIC-PRIVATE'));
});
test('empty or unknown conformance selections cannot produce a vacuous pass', async () => {
  for (const options of [{ scenarios: [] }, { scenarios: ['typo'] }, { providers: [] }, { providers: ['unknown'] }]) await assert.rejects(runConformanceSuite({ create: createProvider }, options));
});
