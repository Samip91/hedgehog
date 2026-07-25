import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Unit tests for the `/api/hedge`-only rate limiter (spec
 * `docs/features/propose-hedge/spec.md` AC 9, plan "Tests & seams"). Mocks
 * `@/server/cache`'s `redis` (`set`/`incr`) via `vi.hoisted` + `vi.mock`,
 * matching `health/route.test.ts`'s house style.
 *
 * Window init is atomic: `SET key 1 NX EX 600` creates the key + TTL in one
 * call ('OK' when created, `null` when the key already existed); only an
 * already-existing key falls through to `INCR`. This replaced an
 * `INCR`-then-conditional-`EXPIRE` sequence that could orphan an untimed
 * counter on a crash between the two calls.
 */

const mocks = vi.hoisted(() => ({
  set: vi.fn(),
  incr: vi.fn(),
}))

vi.mock('@/server/cache', () => ({
  redis: { set: mocks.set, incr: mocks.incr },
}))

import {
  checkHedgeRateLimit,
  checkRateLimit,
  clientIp,
  HEDGE_RATE_LIMIT,
  HEDGE_RATE_WINDOW_SECONDS,
} from './rate-limit'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('checkHedgeRateLimit — first request in the window', () => {
  it("redis.set (NX) returns 'OK' → count treated as 1, ok:true, remaining:9, incr not called", async () => {
    mocks.set.mockResolvedValue('OK')

    const result = await checkHedgeRateLimit('1.2.3.4')

    expect(result).toEqual({ ok: true, remaining: 9 })
    expect(mocks.incr).not.toHaveBeenCalled()
  })

  it('sets value + TTL atomically: redis.set(key, 1, { nx: true, ex: HEDGE_RATE_WINDOW_SECONDS })', async () => {
    mocks.set.mockResolvedValue('OK')

    await checkHedgeRateLimit('1.2.3.4')

    expect(mocks.set).toHaveBeenCalledWith('ratelimit:hedge:1.2.3.4', 1, {
      nx: true,
      ex: HEDGE_RATE_WINDOW_SECONDS,
    })
  })
})

describe('checkHedgeRateLimit — subsequent requests in the window', () => {
  it('redis.set (NX) returns null (key exists) → falls through to incr; 10th request (incr→10) is allowed', async () => {
    mocks.set.mockResolvedValue(null)
    mocks.incr.mockResolvedValue(10)

    const result = await checkHedgeRateLimit('1.2.3.4')

    expect(result.ok).toBe(true)
    expect(mocks.incr).toHaveBeenCalledWith('ratelimit:hedge:1.2.3.4')
  })

  it('11th request (incr→11) is blocked', async () => {
    mocks.set.mockResolvedValue(null)
    mocks.incr.mockResolvedValue(11)

    const result = await checkHedgeRateLimit('1.2.3.4')

    expect(result.ok).toBe(false)
    expect(HEDGE_RATE_LIMIT).toBe(10)
  })
})

describe('checkHedgeRateLimit — fail-open', () => {
  it('resolves {ok:true} and never throws when redis.set rejects', async () => {
    mocks.set.mockRejectedValue(new Error('ECONNRESET'))

    await expect(checkHedgeRateLimit('1.2.3.4')).resolves.toEqual({
      ok: true,
      remaining: HEDGE_RATE_LIMIT,
    })
  })

  it('resolves {ok:true} and never throws when redis.set resolves null but the fallback redis.incr rejects', async () => {
    mocks.set.mockResolvedValue(null)
    mocks.incr.mockRejectedValue(new Error('ECONNRESET'))

    await expect(checkHedgeRateLimit('1.2.3.4')).resolves.toEqual({
      ok: true,
      remaining: HEDGE_RATE_LIMIT,
    })
  })
})

// ── hardening AC 1, 9 — generalized checkRateLimit(bucket, ip, limit, window) ─
describe('checkRateLimit — arbitrary bucket (hardening AC 1, 9)', () => {
  it('key shape is ratelimit:{bucket}:{ip} on the first request (redis.set NX EX window)', async () => {
    mocks.set.mockResolvedValue('OK')

    await checkRateLimit('hedges:read', '9.9.9.9', 60, 60)

    expect(mocks.set).toHaveBeenCalledWith('ratelimit:hedges:read:9.9.9.9', 1, {
      nx: true,
      ex: 60,
    })
    expect(mocks.incr).not.toHaveBeenCalled()
  })

  it('different buckets for the same IP use independent keys', async () => {
    mocks.set.mockResolvedValue('OK')

    await checkRateLimit('health', '1.1.1.1', 120, 60)
    await checkRateLimit('hedges:save', '1.1.1.1', 20, 600)

    expect(mocks.set).toHaveBeenNthCalledWith(
      1,
      'ratelimit:health:1.1.1.1',
      1,
      {
        nx: true,
        ex: 60,
      }
    )
    expect(mocks.set).toHaveBeenNthCalledWith(
      2,
      'ratelimit:hedges:save:1.1.1.1',
      1,
      { nx: true, ex: 600 }
    )
  })

  it('allows while count <= limit (count === limit)', async () => {
    mocks.set.mockResolvedValue(null)
    mocks.incr.mockResolvedValue(60)

    const result = await checkRateLimit('hedges:read', '9.9.9.9', 60, 60)

    expect(result).toEqual({ ok: true, remaining: 0 })
    expect(mocks.incr).toHaveBeenCalledWith('ratelimit:hedges:read:9.9.9.9')
  })

  it('blocks when count > limit', async () => {
    mocks.set.mockResolvedValue(null)
    mocks.incr.mockResolvedValue(61)

    const result = await checkRateLimit('hedges:read', '9.9.9.9', 60, 60)

    expect(result).toEqual({ ok: false, remaining: 0 })
  })

  it('fails open ({ok:true, remaining:limit}) when redis.set rejects', async () => {
    mocks.set.mockRejectedValue(new Error('ECONNRESET'))

    await expect(
      checkRateLimit('hedges:save', '9.9.9.9', 20, 600)
    ).resolves.toEqual({ ok: true, remaining: 20 })
  })

  it('fails open when redis.set resolves null and the fallback redis.incr rejects', async () => {
    mocks.set.mockResolvedValue(null)
    mocks.incr.mockRejectedValue(new Error('ECONNRESET'))

    await expect(
      checkRateLimit('hedges:delete', '9.9.9.9', 30, 60)
    ).resolves.toEqual({ ok: true, remaining: 30 })
  })
})

// ── checkHedgeRateLimit stays a byte-identical wrapper post-generalization ──
describe("checkHedgeRateLimit — still delegates to checkRateLimit('hedge', …) unchanged", () => {
  it('first request: redis.set (NX) → OK → ok:true, remaining:9, same as before generalization', async () => {
    mocks.set.mockResolvedValue('OK')

    const result = await checkHedgeRateLimit('1.2.3.4')

    expect(result).toEqual({ ok: true, remaining: 9 })
    expect(mocks.set).toHaveBeenCalledWith('ratelimit:hedge:1.2.3.4', 1, {
      nx: true,
      ex: HEDGE_RATE_WINDOW_SECONDS,
    })
  })

  it('11th request is blocked, matching the pre-generalization behavior', async () => {
    mocks.set.mockResolvedValue(null)
    mocks.incr.mockResolvedValue(11)

    const result = await checkHedgeRateLimit('1.2.3.4')

    expect(result.ok).toBe(false)
  })
})

describe('clientIp', () => {
  function req(headers: Record<string, string>): NextRequest {
    return new NextRequest('http://localhost/api/hedge', { headers })
  }

  it('uses the first hop of x-forwarded-for, comma-split and trimmed', () => {
    const ip = clientIp(req({ 'x-forwarded-for': ' 1.2.3.4 , 5.6.7.8' }))

    expect(ip).toBe('1.2.3.4')
  })

  it('prefers x-forwarded-for over x-real-ip when both are present', () => {
    const ip = clientIp(
      req({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '9.8.7.6' })
    )

    expect(ip).toBe('1.2.3.4')
  })

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    const ip = clientIp(req({ 'x-real-ip': '9.8.7.6' }))

    expect(ip).toBe('9.8.7.6')
  })

  it("falls back to 'unknown' when neither header is present", () => {
    const ip = clientIp(req({}))

    expect(ip).toBe('unknown')
  })
})
