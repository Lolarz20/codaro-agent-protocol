import { ProviderError, httpError } from '../errors.js';
export interface HttpOptions {
  readonly fetch: typeof globalThis.fetch;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly maxErrorBytes: number;
  readonly maxFrameBytes: number;
  readonly maxStreamBytes: number;
  readonly maxRetries: number;
  readonly retryBudgetMs: number;
  readonly now: () => number;
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
}
export function lease(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = setTimeout(() => { timedOut = true; cancel(); }, timeoutMs);
  function race<T>(promise: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const aborted = () => { cleanup(); reject(new ProviderError(timedOut ? 'timeout' : 'cancelled')); };
      const cleanup = () => controller.signal.removeEventListener('abort', aborted);
      controller.signal.addEventListener('abort', aborted, { once: true });
      if (controller.signal.aborted) aborted();
      promise.then(value => { cleanup(); resolve(value); }, err => { cleanup(); reject(err); });
    });
  }
  return { signal: controller.signal, race, dispose: () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); controller.abort(); } };
}
export type Lease = ReturnType<typeof lease>;

export async function send(url: string, headers: Record<string, string>, body: unknown, opts: HttpOptions, budget: Lease): Promise<Response> {
  const started = opts.now();
  for (let attempt = 0; ; attempt++) {
    let response: Response | undefined;
    try {
      // Manual redirects: credential-bearing redirects are never followed, including same-origin ones.
      response = await budget.race(opts.fetch(url, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'manual', signal: budget.signal }));
      if (response.ok) return response;
      // Error bodies are discarded, not interpolated into exceptions. Redaction precedes any possible truncation.
      if (response.body) {
        const reader = response.body.getReader();
        try {
          let size = 0;
          while (size < opts.maxErrorBytes) {
            const chunk = await budget.race(reader.read());
            if (chunk.done) break;
            size += chunk.value.byteLength;
          }
        } finally { void reader.cancel().catch(() => {}); }
      }
      throw httpError(response.status);
    } catch (err) {
      const failure = err instanceof ProviderError ? err : new ProviderError(budget.signal.aborted ? 'cancelled' : 'network');
      const wait = Math.min(250 * 2 ** attempt, 2000);
      if (!failure.failure.retryable || attempt >= opts.maxRetries || opts.now() - started + wait > opts.retryBudgetMs) throw failure;
      await budget.race(opts.sleep(wait, budget.signal));
    }
  }
}

export async function readJson(response: Response, opts: HttpOptions, budget: Lease): Promise<unknown> {
  if (!response.body) throw new ProviderError('protocol');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await budget.race(reader.read());
      if (item.done) break;
      size += item.value.byteLength;
      if (size > opts.maxResponseBytes) throw new ProviderError('limit');
      chunks.push(item.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new ProviderError('protocol'); }
  } finally { void reader.cancel().catch(() => {}); }
}

export async function* frames(response: Response, opts: HttpOptions, budget: Lease): AsyncGenerator<unknown> {
  if (!response.body) throw new ProviderError('protocol');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const encoder = new TextEncoder();
  let buffer = '';
  let total = 0;
  try {
    while (true) {
      const part = await budget.race(reader.read());
      if (part.done) { buffer += decoder.decode(); break; }
      total += part.value.byteLength;
      if (total > opts.maxStreamBytes) throw new ProviderError('limit');
      buffer += decoder.decode(part.value, { stream: true });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        if (encoder.encode(frame).length > opts.maxFrameBytes) throw new ProviderError('limit');
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
        if (!data) continue;
        if (data === '[DONE]') return;
        try { yield JSON.parse(data); } catch (err) { if (err instanceof ProviderError) throw err; throw new ProviderError('protocol'); }
      }
      if (encoder.encode(buffer).length > opts.maxFrameBytes) throw new ProviderError('limit');
    }
    // An unterminated data frame is a truncated stream, not a successful empty response.
    if (buffer.trim()) throw new ProviderError('protocol');
  } finally { void reader.cancel().catch(() => {}); }
}
