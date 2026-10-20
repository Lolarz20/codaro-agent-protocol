# Architecture

Readonly canonical messages -> detached/sanitized scoped history -> protocol codec -> injected bounded HTTP transport -> JSON or SSE accumulator -> normalized response. Instances and per-turn accumulators share no mutable state.

ProviderError exposes only classified failures and HTTP status. Tool calls are data. The public conformance subpath creates adapter instances with scripted fetch responses; it does not depend on a particular runtime constructor. Experimental recovery is opt-in and separate from normal contractual parsing.

Compared with earlier Codaro implementations, product policy/configuration and model profiles were removed; continuation scope includes origin/model, transport is injected, recovery is default-off, and resource bounds cover body stalls. Implementations and fixtures were rewritten against behavior rather than importing extension internals.
