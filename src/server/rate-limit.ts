import type { NextRequest } from 'next/server'
import { redis } from '@/server/cache'

/**
 * `/api/hedge`-only fixed-window rate limiter (ADR 005) — 10 requests per 10
 * minutes per client IP, reusing the existing Redis client (no new
 * dependency). Checked first in the route handler, before body parse or any
 * pipeline stage, so a blocked request never spends a token.
 *
 * Fail-open on any Redis error: the limiter must not be the single point of
 * failure for `/api/hedge`.
 */
export const HEDGE_RATE_LIMIT = 10
export const HEDGE_RATE_WINDOW_SECONDS = 600

const keyFor = (bucket: string, ip: string): string =>
  `ratelimit:${bucket}:${ip}`

export interface RateLimitResult {
  readonly ok: boolean
  readonly remaining: number
}

/** `x-forwarded-for` first hop → `x-real-ip` → `'unknown'` (Next 16 route
 * handlers have no `NextRequest.ip`). `'unknown'`-IP requests share one
 * bucket — accepted (ADR 005). */
export function clientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get('x-forwarded-for')
  if (forwardedFor !== null) {
    const firstHop = forwardedFor.split(',')[0]?.trim()
    if (firstHop !== undefined && firstHop.length > 0) return firstHop
  }

  const realIp = req.headers.get('x-real-ip')
  if (realIp !== null && realIp.trim().length > 0) return realIp.trim()

  return 'unknown'
}

/**
 * Fixed-window counter on `ratelimit:${bucket}:${ip}`. The first request in a
 * window is created atomically with its TTL via `SET key 1 NX EX window`, so
 * a key with a value always has an expiry — there is no `INCR`-then-`EXPIRE`
 * window where a crash could orphan an untimed counter and block the IP
 * forever. Subsequent requests `INCR`. Allowed while `count <= limit`.
 * Fail-open on any Redis error (ADR 005): the limiter must not be the single
 * point of failure for a rate-limited route.
 */
export async function checkRateLimit(
  bucket: string,
  ip: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  try {
    const key = keyFor(bucket, ip)
    // `SET … NX EX` returns 'OK' when it created the key (window start), else
    // null; only then do we INCR the existing counter. Value + TTL are set
    // together, so no untimed orphan is possible.
    const created = await redis.set(key, 1, {
      nx: true,
      ex: windowSeconds,
    })
    const count = created ? 1 : await redis.incr(key)
    return {
      ok: count <= limit,
      remaining: Math.max(0, limit - count),
    }
  } catch {
    return { ok: true, remaining: limit }
  }
}

/** `/api/hedge`-only wrapper — preserves the original bucket key
 * (`ratelimit:hedge:${ip}`) and 10/10min defaults. */
export async function checkHedgeRateLimit(
  ip: string
): Promise<RateLimitResult> {
  return checkRateLimit(
    'hedge',
    ip,
    HEDGE_RATE_LIMIT,
    HEDGE_RATE_WINDOW_SECONDS
  )
}
