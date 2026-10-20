import { createProvider } from 'codaro-agent-protocol';
import { runConformanceSuite } from 'codaro-agent-protocol/conformance';
// Replace this create function with your adapter's constructor. It must use the supplied fetch.
const adapter = { create: options => createProvider(options) };
const results = await runConformanceSuite(adapter);
console.table(results);
if (results.some(result => !result.passed)) process.exitCode = 1;
