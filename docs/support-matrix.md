# Support matrix

| Protocol | Text/tools | SSE | Opaque continuation | Evidence |
|---|---|---|---|---|
| OpenAI Chat Completions | Yes | Yes, partial argument assembly | reasoning_content scoped to origin/model | Synthetic offline fixtures |
| Gemini generateContent | Yes | Yes | Entire ordered parts including signatures | Synthetic offline fixtures |
| Anthropic Messages | Yes | Yes, partial input JSON | Entire ordered blocks including thinking/redacted thinking | Synthetic offline fixtures |

No live provider tests were performed. This is fixture-level conformance, not vendor certification or universal adapter compatibility. The conformance driver accepts independent constructors using its injected transport. Eleven selectable scenarios per protocol cover text/usage, roundtrip, continuation, malformed arguments, refusal, truncation, streaming text, sequential/parallel tools, error results and JSON persistence. Runtime/session/transport tests cover additional failure and isolation cases.

DeepSeek, Qwen and custom profiles from earlier product work are deliberately not advertised as supported providers. Their optional fields/model-specific restrictions require explicit future fixtures. An explicit OpenAI endpoint can be tested as best-effort Chat Completions compatibility. No compatibility is inferred from a brand or URL.
