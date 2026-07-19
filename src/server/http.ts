/**
 * Hardened HTTP for provider calls — spec §5.5.
 *
 * - fetchJson: timeout (AbortController), per-status retry, exponential backoff
 *   with full jitter, honors Retry-After on 429.
 * - Retry policy: retry 429 / 5xx / timeout / network; never retry
 *   400/401/403/404 or TLS errors.
 * - CircuitBreaker: opens after N consecutive failures, fast-fails during a
 *   cooldown, half-open probe, closes on success.
 *
 * Time and I/O are injectable (`sleep`, `random`, `now`, `fetchImpl`) so the
 * retry policy and breaker are unit-tested deterministically.
 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export class SchemaMismatchError extends Error {
  constructor(
    message: string,
    readonly payloadPreview: string
  ) {
    super(message)
    this.name = 'SchemaMismatchError'
  }
}

export interface FetchJsonOptions {
  readonly timeoutMs?: number
  readonly retries?: number
  readonly headers?: Record<string, string>
  /** Test seams — default to real implementations. */
  readonly fetchImpl?: typeof fetch
  readonly sleep?: (ms: number) => Promise<void>
  readonly random?: () => number
}

const NON_RETRYABLE_STATUS = new Set([400, 401, 403, 404])
const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_RETRIES = 2
const BASE_DELAY_MS = 300
const MAX_DELAY_MS = 8000

const realSleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

function backoffDelay(attempt: number, random: () => number): number {
  const exp = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS)
  return Math.floor(exp * (0.5 + random() * 0.5)) // full jitter
}

function isRetryableStatus(status: number): boolean {
  if (NON_RETRYABLE_STATUS.has(status)) return false
  return status === 429 || status >= 500
}

function retryAfterMs(res: Response): number | null {
  const header = res.headers.get('retry-after')
  if (!header) return null
  const secs = Number(header)
  if (Number.isFinite(secs)) return secs * 1000
  const date = Date.parse(header)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null
}

function errorCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null) {
    const e = err as { code?: unknown; cause?: { code?: unknown } }
    const code = e.code ?? e.cause?.code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

/** TLS / certificate failures should fail fast, never retry. */
function isNonRetryableNetworkError(err: unknown): boolean {
  const code = errorCode(err)
  return (
    code !== undefined &&
    (code.startsWith('CERT_') ||
      code.startsWith('ERR_TLS') ||
      code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
      code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE')
  )
}

export async function fetchJson<T>(
  url: string,
  opts: FetchJsonOptions = {}
): Promise<T> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    headers,
    fetchImpl = fetch,
    sleep = realSleep,
    random = Math.random,
  } = opts

  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const init: RequestInit = { signal: controller.signal }
    if (headers) init.headers = headers

    try {
      const res = await fetchImpl(url, init)
      clearTimeout(timer)

      if (res.ok) return (await res.json()) as T

      if (!isRetryableStatus(res.status) || attempt === retries) {
        throw new HttpError(res.status, `HTTP ${res.status} for ${url}`)
      }
      const wait =
        res.status === 429
          ? (retryAfterMs(res) ?? backoffDelay(attempt, random))
          : backoffDelay(attempt, random)
      await sleep(wait)
    } catch (err) {
      clearTimeout(timer)
      if (err instanceof HttpError) throw err
      lastError = err
      if (isNonRetryableNetworkError(err) || attempt === retries) {
        throw asError(err, url)
      }
      await sleep(backoffDelay(attempt, random))
    }
  }
  throw asError(lastError, url)
}

function asError(err: unknown, url: string): Error {
  if (err instanceof Error) return err
  return new Error(`request to ${url} failed: ${String(err)}`)
}

// ── Circuit breaker ─────────────────────────────────────────────────────────

export type BreakerState = 'closed' | 'open' | 'half-open'

export interface CircuitBreakerOptions {
  readonly threshold?: number
  readonly cooldownMs?: number
  /** Injectable clock for deterministic tests. */
  readonly now?: () => number
}

export class CircuitBreaker {
  private failures = 0
  private openedAt = 0
  private current: BreakerState = 'closed'
  private readonly threshold: number
  private readonly cooldownMs: number
  private readonly clock: () => number

  constructor(
    readonly name: string,
    opts: CircuitBreakerOptions = {}
  ) {
    this.threshold = opts.threshold ?? 5
    this.cooldownMs = opts.cooldownMs ?? 60_000
    this.clock = opts.now ?? Date.now
  }

  get state(): BreakerState {
    if (
      this.current === 'open' &&
      this.clock() - this.openedAt >= this.cooldownMs
    ) {
      this.current = 'half-open'
    }
    return this.current
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      throw new Error(`circuit '${this.name}' is open`)
    }
    try {
      const result = await fn()
      this.failures = 0
      this.current = 'closed'
      return result
    } catch (err) {
      this.failures++
      if (this.failures >= this.threshold) {
        this.current = 'open'
        this.openedAt = this.clock()
      }
      throw err
    }
  }
}
