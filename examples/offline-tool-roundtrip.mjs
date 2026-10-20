import { createProvider } from 'codaro-agent-protocol';
import { runConformanceSuite } from 'codaro-agent-protocol/conformance';
const results = await runConformanceSuite({ create: createProvider }, { scenarios: ['tool-roundtrip', 'continuation-replay'] });
console.table(results);
if (results.some(result => !result.passed)) process.exitCode = 1;
