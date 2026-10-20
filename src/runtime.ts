import type { ChatRequest, ChatResponse, Provider, ProviderId, Scope, StreamEvent } from './types.js';
import { ProviderError } from './errors.js';
import { sanitizeSessionHistory } from './session.js';
import { encode, decode } from './codecs/index.js';
import { StreamAccumulator } from './codecs/stream.js';
import { frames, lease, readJson, send, type HttpOptions } from './transport/http.js';
import { recoverToolCalls } from './experimental/reasoning-recovery.js';

export interface ProviderOptions {
  readonly provider: ProviderId;
  /** Full POST endpoint; Gemini generateContent path includes the model. No default endpoint. */
  readonly endpoint: string;
  readonly model: string;
  /** Must be supplied even for network use: no implicit global fetch. */
  readonly fetch: typeof globalThis.fetch;
  readonly credential?: () => string | undefined | Promise<string | undefined>;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly maxErrorBytes?: number;
  readonly maxFrameBytes?: number;
  readonly maxStreamBytes?: number;
  readonly maxRetries?: number;
  readonly retryBudgetMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly experimentalReasoningRecovery?: boolean;
}
export function createProvider(options: ProviderOptions): Provider {
  options = { ...options };
  let endpoint: URL;
  try { endpoint = new URL(options.endpoint); } catch { throw new ProviderError('invalid_request'); }
  if (!['openai', 'gemini', 'anthropic'].includes(options.provider) || !options.model || !options.fetch || !['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash || [...endpoint.searchParams.keys()].some(k => /key|token|secret/i.test(k))) throw new ProviderError('invalid_request');
  if (endpoint.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) throw new ProviderError('invalid_request');
  const positive = (n: number | undefined, fallback: number) => {
    if (n === undefined) return fallback;
    if (!Number.isSafeInteger(n) || n <= 0) throw new ProviderError('invalid_request');
    return n;
  };
  const retries = options.maxRetries ?? 0;
  if (!Number.isInteger(retries) || retries < 0 || retries > 5) throw new ProviderError('invalid_request');
  const opts: HttpOptions = {
    fetch: options.fetch, timeoutMs: positive(options.timeoutMs, 30_000),
    maxResponseBytes: positive(options.maxResponseBytes, 2_097_152), maxErrorBytes: positive(options.maxErrorBytes, 4096),
    maxFrameBytes: positive(options.maxFrameBytes, 65_536), maxStreamBytes: positive(options.maxStreamBytes, 8_388_608),
    maxRetries: retries, retryBudgetMs: positive(options.retryBudgetMs, 5000), now: options.now ?? (() => performance.now()),
    sleep: options.sleep ?? ((ms, signal) => new Promise(resolve => {
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, ms);
      signal.addEventListener('abort', done, { once: true });
      if (signal.aborted) done();
    }))
  };
  const scope: Scope = { provider: options.provider, origin: endpoint.origin, model: options.model };
  async function begin(request: ChatRequest, stream: boolean, budget: ReturnType<typeof lease>) {
    if (request.signal?.aborted) throw new ProviderError('cancelled');
    if (request.maxTokens !== undefined && (!Number.isSafeInteger(request.maxTokens) || request.maxTokens <= 0)) throw new ProviderError('invalid_request');
    if (request.temperature !== undefined && (!Number.isFinite(request.temperature) || request.temperature < 0)) throw new ProviderError('invalid_request');
    const credential = await budget.race(Promise.resolve().then(() => options.credential?.()));
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (credential) headers[options.provider === 'gemini' ? 'x-goog-api-key' : options.provider === 'anthropic' ? 'x-api-key' : 'authorization'] = options.provider === 'openai' ? `Bearer ${credential}` : credential;
    if (options.provider === 'anthropic') headers['anthropic-version'] = '2023-06-01';
    // Metadata is deliberately a small opt-in header namespace, not arbitrary auth overrides.
    for (const [key, value] of Object.entries(request.metadata ?? {})) {
      if (!/^[a-z0-9-]{1,40}$/i.test(key) || /[\r\n]/.test(value) || value.length > 256) throw new ProviderError('invalid_request');
      headers[`x-client-${key}`] = value;
    }
    const url = new URL(endpoint);
    if (stream && options.provider === 'gemini') { url.pathname = url.pathname.replace(/:generateContent$/, ':streamGenerateContent'); url.searchParams.set('alt', 'sse'); }
    const messages = sanitizeSessionHistory(request.messages, scope);
    return send(url.href, headers, encode({ ...request, messages }, scope, stream), opts, budget);
  }
  function result(value: unknown, request: ChatRequest): ChatResponse {
    let response: ChatResponse;
    try { response = decode(value, scope); } catch (err) { if (err instanceof ProviderError) throw err; throw new ProviderError('protocol'); }
    if (options.experimentalReasoningRecovery && !response.toolCalls.length && response.finishReason !== 'refusal') {
      const reasoning = response.continuation?.data.openai as { reasoning_content?: string } | undefined;
      const calls = recoverToolCalls(reasoning?.reasoning_content ?? '', request.tools ?? []);
      if (calls.length) response = { ...response, toolCalls: calls, finishReason: 'tool_calls', recoveredFromReasoning: true };
    }
    return response;
  }
  return Object.freeze({
    id: options.provider,
    async chat(request: ChatRequest) {
      const budget = lease(request.signal, opts.timeoutMs);
      try { return result(await readJson(await begin(request, false, budget), opts, budget), request); }
      catch (err) { if (err instanceof ProviderError) throw err; throw new ProviderError('protocol'); }
      finally { budget.dispose(); }
    },
    async *chatStream(request: ChatRequest): AsyncGenerator<StreamEvent> {
      const budget = lease(request.signal, opts.timeoutMs);
      try {
        const response = await begin(request, true, budget);
        const accumulator = new StreamAccumulator(options.provider);
        for await (const frame of frames(response, opts, budget)) for (const event of accumulator.push(frame)) yield event;
        yield { type: 'complete', response: result(accumulator.finish(), request) };
      } catch (err) { if (err instanceof ProviderError) throw err; throw new ProviderError('protocol'); }
      finally { budget.dispose(); }
    }
  });
}
