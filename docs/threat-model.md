# Threat model

The caller controls endpoint, model, transport, credentials and tool execution. Treat all provider data as untrusted; validate a complete tool call against your application schema before any action. This package executes no tools and owns no filesystem or shell.

Endpoint validation permits HTTPS and explicit HTTP loopback, rejects URL userinfo, fragments and credential-like query names. It is not an SSRF firewall: callers must allowlist origins when endpoints come from users. An injected fetch is trusted to honor manual redirect semantics; a malicious transport can ignore any option.

Every operation has a real timer and AbortSignal race, including injected fetch/body/credential promises that ignore cancellation. Late third-party promise side effects cannot be undone. Consumers must advance or return from stream iterators: an abandoned iterator can retain its suspended generator until garbage collection, although the timer still aborts transport. The byte limit is checked after a transport chunk arrives; a transport allocating an enormous chunk has already allocated it. Runtime limits do not bound caller-owned input history or a malicious injected adapter.

Upstream error bodies and transport exception text are never exposed, logged or persisted. At most the error read budget is consumed before cancelling; one already-delivered transport chunk can exceed the budget but is discarded entirely. Continuation is scoped to provider/origin/model and never converted between vendors. Same-origin routes share that trust scope. No automatic cross-origin redirect opt-in is offered in v0.1.

Retries are opt-in and can repeat billable inference. There is no automatic retry after stream parsing starts. Timeout, cancellation, request, auth, refusal, protocol and limit failures are final.
