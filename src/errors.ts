import type { Failure, FailureKind } from './types.js';
export class ProviderError extends Error {
  readonly failure: Failure;
  constructor(kind: FailureKind, status?: number) {
    // Intentionally discard upstream bodies, URLs, headers and exception messages.
    super(`Provider request failed (${kind}${status === undefined ? '' : `, HTTP ${status}`})`);
    this.name = 'ProviderError';
    this.failure = Object.freeze({ kind, retryable: kind === 'rate_limit' || kind === 'server' || kind === 'network', ...(status === undefined ? {} : { status }) });
  }
}
export function httpError(status: number): ProviderError {
  return new ProviderError(status === 401 || status === 403 ? 'auth' : status === 429 ? 'rate_limit' : status >= 500 ? 'server' : 'invalid_request', status);
}
export function record(value: unknown): Record<string, any> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ProviderError('protocol');
  return value as Record<string, any>;
}
export function argumentsObject(value: unknown): Readonly<Record<string, unknown>> {
  try { return record(typeof value === 'string' ? JSON.parse(value) : value); }
  catch { throw new ProviderError('protocol'); }
}
