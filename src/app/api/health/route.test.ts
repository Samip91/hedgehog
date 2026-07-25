import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readHotCatalog: vi.fn(),
  readLastSyncAt: vi.fn(),
  mget: vi.fn(),
  kalshiFetch: vi.fn(),
  polyFetch: vi.fn(),
  checkRateLimit: vi.fn(),
  clientIp: vi.fn(),
  loggerWarn: vi.fn(),
}))

vi.mock('@/server/cache', () => ({
  degradedKey: (name: string) => `degraded:${name}`,
  readHotCatalog: mocks.readHotCatalog,
  readLastSyncAt: mocks.readLastSyncAt,
  redis: { mget: mocks.mget },
}))

vi.mock('@/server/providers/registry', () => ({
  providers: [
    {
      name: 'kalshi',
      fetchOpenMarkets: mocks.kalshiFetch,
      fetchMarket: vi.fn(),
    },
    {
      name: 'polymarket',
      fetchOpenMarkets: mocks.polyFetch,
      fetchMarket: vi.fn(),
    },
  ],
}))

// hardening: the route now reads `@/config/env` directly (RL_HEALTH_*) —
// mock it out (same idiom as `retrieve.test.ts`) so the real module's
// `import 'server-only'` + `process.env` validation never runs.
vi.mock('@/config/env', () => ({
  env: {
    RL_HEALTH_LIMIT: 120,
    RL_HEALTH_WINDOW: 60,
    LOG_LEVEL: 'info',
  },
}))

// `@/server/log` does `import 'server-only'` — mock it out so it never loads
// unmocked, and so `logger.warn` calls are assertable (AC 16).
vi.mock('@/server/log', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: mocks.loggerWarn,
    error: vi.fn(),
  },
  newErrorId: () => 'test-err-id',
}))

// hardening AC 5: GET now rate-limits first. Default the mock to "allowed"
// so every existing assertion below is unaffected; individual tests
// override to exercise the 429 path.
vi.mock('@/server/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  checkHedgeRateLimit: vi.fn(async () => ({ ok: true, remaining: 9 })),
  clientIp: mocks.clientIp,
  HEDGE_RATE_LIMIT: 10,
  HEDGE_RATE_WINDOW_SECONDS: 600,
}))

import { GET } from './route'

function getReq(): NextRequest {
  return new NextRequest('http://localhost/api/health', { method: 'GET' })
}

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkRateLimit.mockResolvedValue({ ok: true, remaining: 119 })
    mocks.clientIp.mockReturnValue('1.2.3.4')
  })

  // AC 18: populated Redis → correct {lastSyncAt, catalogSize, degraded} triple, 200.
  it('returns 200 with the status triple sourced from Redis', async () => {
    mocks.readHotCatalog.mockResolvedValue([
      { externalId: 'a' },
      { externalId: 'b' },
    ])
    mocks.readLastSyncAt.mockResolvedValue('2026-07-21T00:00:00.000Z')
    // order matches providers.map(name) + 'embedding': kalshi degraded, rest ok.
    mocks.mget.mockResolvedValue(['1', null, null])

    const res = await GET(getReq())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        lastSyncAt: '2026-07-21T00:00:00.000Z',
        catalogSize: 2,
        degraded: ['kalshi'],
      },
    })
    // hardening AC 16 — a non-empty degraded[] logs a structured warn.
    expect(mocks.loggerWarn).toHaveBeenCalledWith('health degraded', {
      degraded: ['kalshi'],
    })
  })

  // AC 19: pre-first-sync (Redis never populated) → 200, not 500.
  it('returns 200 with lastSyncAt: null, catalogSize: 0, degraded: [] pre-first-sync', async () => {
    mocks.readHotCatalog.mockResolvedValue([])
    mocks.readLastSyncAt.mockResolvedValue(null)
    mocks.mget.mockResolvedValue([null, null, null])

    const res = await GET(getReq())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: { lastSyncAt: null, catalogSize: 0, degraded: [] },
    })
    // Nothing degraded → no warn emitted.
    expect(mocks.loggerWarn).not.toHaveBeenCalled()
  })

  // AC 20: fast, Redis-only — never calls a provider or touches Postgres.
  it('never calls a provider.fetchOpenMarkets', async () => {
    mocks.readHotCatalog.mockResolvedValue([])
    mocks.readLastSyncAt.mockResolvedValue(null)
    mocks.mget.mockResolvedValue([null, null, null])

    await GET(getReq())

    expect(mocks.kalshiFetch).not.toHaveBeenCalled()
    expect(mocks.polyFetch).not.toHaveBeenCalled()
  })

  // ── hardening AC 5, 8 — rate limited ────────────────────────────────────
  it('checkRateLimit ok:false for the health bucket → 429 with Retry-After, before any Redis read', async () => {
    mocks.checkRateLimit.mockResolvedValue({ ok: false, remaining: 0 })

    const res = await GET(getReq())

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Try again shortly.',
      },
    })
    expect(mocks.readHotCatalog).not.toHaveBeenCalled()
    expect(mocks.readLastSyncAt).not.toHaveBeenCalled()
    expect(mocks.mget).not.toHaveBeenCalled()
  })

  it('is checked against the health bucket with the configured (loose) limit/window', async () => {
    mocks.readHotCatalog.mockResolvedValue([])
    mocks.readLastSyncAt.mockResolvedValue(null)
    mocks.mget.mockResolvedValue([null, null, null])

    await GET(getReq())

    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      'health',
      '1.2.3.4',
      120,
      60
    )
  })

  it('checkRateLimit ok:true (fail-open / allowed) → proceeds to a normal 200', async () => {
    mocks.readHotCatalog.mockResolvedValue([])
    mocks.readLastSyncAt.mockResolvedValue(null)
    mocks.mget.mockResolvedValue([null, null, null])
    mocks.checkRateLimit.mockResolvedValue({ ok: true, remaining: 119 })

    const res = await GET(getReq())

    expect(res.status).toBe(200)
  })

  it('never imports "@/server/db" (statically grep-checkable, matches AC 20)', () => {
    const routePath = fileURLToPath(new URL('./route.ts', import.meta.url))
    const source = readFileSync(routePath, 'utf-8')
    expect(source).not.toMatch(/@\/server\/db/)
  })
})
