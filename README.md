# Codaro Agent Protocol

Provider protocol adapters and executable offline conformance scenarios for multi-turn tool calling across OpenAI Chat Completions, Gemini generateContent and Anthropic Messages.

Tool conversations break when results lose their call IDs or adapters drop opaque signatures and thinking blocks. This library maps text/tool conversations and replays continuation state only for the same provider, origin and model.

**Offline fixture conformance is not vendor certification.** No live provider compatibility is asserted. The library never executes tools. It needs no account, performs no telemetry, and makes no network calls on import or in default tests. Requests use only the explicitly supplied endpoint and fetch function when you call `chat` or `chatStream`.

## Install v0.1.0

Node.js 22 and 24 are tested in CI on Linux and Windows. ESM JavaScript and declarations are shipped; CommonJS is not included.

Download `codaro-agent-protocol-0.1.0.tgz` and `SHA256SUMS` from [GitHub Releases](https://github.com/Lolarz20/codaro-agent-protocol/releases/tag/v0.1.0), verify the checksum, then:

```sh
npm install ./codaro-agent-protocol-0.1.0.tgz
```

The package is not published to npm. From source: `npm ci --ignore-scripts && npm run verify`.

## Offline example

```js
import { createProvider } from 'codaro-agent-protocol';
import { runConformanceSuite } from 'codaro-agent-protocol/conformance';

const results = await runConformanceSuite({ create: createProvider });
console.log(results.every(result => result.passed)); // true; scripted transport only
```

Run `node examples/offline-tool-roundtrip.mjs` for two-turn synthetic conversations. `examples/custom-adapter-conformance.mjs` demonstrates the public adapter interface; replace its constructor with your own adapter. The driver supplies an offline fetch and returns per-scenario pass/fail data without logging responses.

For deliberate network use, construct `createProvider({ provider: 'openai', endpoint: YOUR_FULL_POST_URL, model: YOUR_MODEL, fetch, credential: async () => YOUR_CREDENTIAL })`, then `await provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })`. Endpoint/model values are entirely caller controlled. Gemini requires the full `models/<model>:generateContent` URL. Streaming substitutes `:streamGenerateContent?alt=sse`. No model-specific parameter guessing or automatic provider discovery is performed.

`chatStream(request)` yields text deltas, partial argument data and one complete response. **Partial tool arguments are untrusted and must not be executed.** Use the complete event and validate tools/arguments in your application.

## Scope and safety

All public message/tool types are readonly. `sanitizeSessionHistory(history, scope?)` returns a detached history, drops orphan results/unanswered calls and strips continuation outside the supplied scope. Without a scope it strips all continuation. Partial call pruning discards its opaque continuation rather than replaying inconsistent blocks.

Continuation may contain opaque signatures, thinking blocks and reasoning text: treat it as sensitive, do not log it, and do not persist it without your own storage policy. Credentials are obtained per request and never persisted by this package.

Defaults: 30-second total request duration (including credentials, retry waits and body reads), 2 MiB JSON response, 4 KiB discarded error-body read budget, 64 KiB SSE frame, 8 MiB total SSE, zero retries. Optional retries are capped at five and a five-second retry budget; 400/auth/refusal/protocol/redirect failures are never retried. Error messages discard upstream text completely before any truncation. Redirects are always refused. HTTP is accepted only on explicit loopback endpoints.

Reasoning-derived recovery is disabled by default. `experimentalReasoningRecovery: true` enables strict JSON-only, allowlisted tool-name recovery with a 64 KiB bound. It returns data only and does not validate full JSON Schema. The separate experimental subpath exports the pure parser.

Not included: tool execution, filesystem access, session persistence, Responses/Realtime APIs, media, provider SDKs, model catalogs, automatic model capability selection, guaranteed compatibility with arbitrary OpenAI-compatible services, or live-provider tests. Model-specific parameters and Gemini schema subsets remain the caller's responsibility. See [support matrix](docs/support-matrix.md), [threat model](docs/threat-model.md) and [fixture provenance](docs/fixture-provenance.md).

## Development

`npm run verify` cleans, typechecks, lints, compiles, runs offline tests with coverage, inspects the packed allowlist and sensitive-content patterns, installs the tarball in a fresh consumer, and checks runtime exports/declarations. `npm test` runs tests against a prior build. No installation lifecycle script or automatic publication is configured.

## Codaro Open Source

This project was extracted from engineering work developed while building Codaro.
Focused infrastructure extracted from the engineering work behind Codaro.

Related projects:
- [codaro-agent-protocol](https://github.com/Lolarz20/codaro-agent-protocol)
- [codaro-text-patch](https://github.com/Lolarz20/codaro-text-patch)
- [codaro-local-check](https://github.com/Lolarz20/codaro-local-check)
