/**
 * Hardened HTTP for provider calls — spec §5.5. Built for real in
 * feature: providers-day1 (with unit tests using fake timers).
 *
 * Planned surface:
 *  - fetchJson(url, { timeoutMs: 5000, retries: 2 }) — exp. backoff + jitter.
 *  - Per-status retry: retry 429 (honor Retry-After), 5xx, timeout, DNS/network;
 *    never retry 400/401/403/404; TLS errors fail fast.
 *  - CircuitBreaker per provider: >=5 consecutive failures → open 60s → half-open
 *    probe → close on success.
 */

export interface FetchJsonOptions {
  readonly timeoutMs?: number
  readonly retries?: number
  readonly headers?: Record<string, string>
}

export async function fetchJson<T>(
  _url: string,
  _options?: FetchJsonOptions
): Promise<T> {
  throw new Error('fetchJson: not implemented (providers-day1)')
}

export type BreakerState = 'closed' | 'open' | 'half-open'

/** Minimal per-provider circuit breaker. Implemented in providers-day1. */
export class CircuitBreaker {
  constructor(
    readonly name: string,
    readonly threshold = 5,
    readonly cooldownMs = 60_000
  ) {}

  get state(): BreakerState {
    throw new Error('CircuitBreaker: not implemented (providers-day1)')
  }

  async run<T>(_fn: () => Promise<T>): Promise<T> {
    throw new Error('CircuitBreaker: not implemented (providers-day1)')
  }
}
