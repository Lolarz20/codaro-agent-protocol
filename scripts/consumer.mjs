import assert from 'node:assert/strict';
import { createProvider } from 'codaro-agent-protocol';
import { runConformanceSuite } from 'codaro-agent-protocol/conformance';
const results = await runConformanceSuite({ create: createProvider });
assert.ok(results.length === 33 && results.every(result => result.passed));
