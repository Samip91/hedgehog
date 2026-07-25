import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Route tests for `GET` / `DELETE /api/hedges/[id]` (spec
 * `docs/features/saved-hedges/spec.md` ACs 4, 13, 14, 21, 22, 35). Mocks
 * `@/server/db` + `next/headers`'s `cookies()` (same pattern as
 * `../route.test.ts`); `server-only` neutralized so the real `@/server/anon`
 * module can load under vitest's `node` environment.
 */

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  findUniqueSavedHedge: vi.fn(),
  deleteSavedHedge: vi.fn(),
  findUniqueMarketSnapshot: vi.fn(),
  checkRateLimit: vi.fn(),
  clientIp: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
}))

vi.mock('server-only', () => ({}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: mocks.cookieGet,
  })),
}))

vi.mock('@/server/db', () => ({
  db: {
    savedHedge: {
      findUnique: mocks.findUniqueSavedHedge,
      delete: mocks.deleteSavedHedge,
    },
    marketSnapshot: {
      findUnique: mocks.findUniqueMarketSnapshot,
    },
  },
}))

// hardening: the route now reads `@/config/env` directly (RL_* tunables) —
// mock it out (same idiom as `retrieve.test.ts`) so the real module's
// `import 'server-only'` + `process.env` validation never runs.
vi.mock('@/config/env', () => ({
  env: {
    RL_HEDGES_SAVE_LIMIT: 20,
    RL_HEDGES_SAVE_WINDOW: 600,
    RL_HEDGES_READ_LIMIT: 60,
    RL_HEDGES_READ_WINDOW: 60,
    RL_HEDGES_DELETE_LIMIT: 30,
    RL_HEDGES_DELETE_WINDOW: 60,
    RL_HEALTH_LIMIT: 120,
    RL_HEALTH_WINDOW: 60,
    LOG_LEVEL: 'info',
  },
}))

// `@/server/log` does `import 'server-only'` — mock it out so it never loads
// unmocked, and so `logger.error`/`logger.warn` calls are assertable.
vi.mock('@/server/log', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
  newErrorId: () => 'test-err-id',
}))

// hardening AC 3, 4: both handlers now rate-limit first. Default the mock to
// "allowed" so every existing assertion below is unaffected; individual
// tests override to exercise the 429 path.
vi.mock('@/server/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  checkHedgeRateLimit: vi.fn(async () => ({ ok: true, remaining: 9 })),
  clientIp: mocks.clientIp,
  HEDGE_RATE_LIMIT: 10,
  HEDGE_RATE_WINDOW_SECONDS: 600,
}))

import { DELETE, GET } from './route'

function setCookie(anonId: string | null): void {
  mocks.cookieGet.mockImplementation((name: string) =>
    name === 'anonId' && anonId !== null ? { name, value: anonId } : undefined
  )
}

function fakeRow(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'hedge-1',
    anonId: 'anon-A',
    prompt: 'Will it rain on my wedding?',
    spec: {},
    provider: 'KALSHI',
    externalId: 'K-TEST',
    question: 'Will it rain in Miami on March 21?',
    side: 'YES',
    entryPrice: 0.4,
    stakeUsd: 100,
    shares: 250,
    status: 'OPEN',
    settledPnlUsd: null,
    createdAt: new Date('2026-03-01T00:00:00Z'),
    updatedAt: new Date('2026-03-01T00:00:00Z'),
    ...overrides,
  }
}

function req(method: 'GET' | 'DELETE'): NextRequest {
  return new NextRequest('http://localhost/api/hedges/hedge-1', { method })
}

function ctx(id = 'hedge-1'): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  setCookie(null)
  mocks.findUniqueSavedHedge.mockResolvedValue(null)
  mocks.deleteSavedHedge.mockResolvedValue(undefined)
  mocks.findUniqueMarketSnapshot.mockResolvedValue(null)
  mocks.checkRateLimit.mockResolvedValue({ ok: true, remaining: 59 })
  mocks.clientIp.mockReturnValue('1.2.3.4')
})

// ── AC 4, 13, 14 — GET detail ────────────────────────────────────────────────
describe('GET /api/hedges/[id] — owned (AC 13)', () => {
  it('owned id → 200 { ok:true, data: SavedHedgeView } settled', async () => {
    setCookie('anon-A')
    mocks.findUniqueSavedHedge.mockResolvedValue(fakeRow())

    const res = await GET(req('GET'), ctx())

    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data: { id: string } }
    expect(body.ok).toBe(true)
    expect(body.data.id).toBe('hedge-1')
  })
})

describe('GET /api/hedges/[id] — missing or foreign (AC 4, 14)', () => {
  it('no anonId cookie at all → 404 (no existence leak)', async () => {
    setCookie(null)
    mocks.findUniqueSavedHedge.mockResolvedValue(fakeRow())

    const res = await GET(req('GET'), ctx())

    expect(res.status).toBe(404)
    const body = (await res.json()) as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('row does not exist → 404, identical shape to the foreign-anon case', async () => {
    setCookie('anon-A')
    mocks.findUniqueSavedHedge.mockResolvedValue(null)

    const res = await GET(req('GET'), ctx())

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Saved hedge not found.' },
    })
  })

  it('row exists but owned by a DIFFERENT anonId → 404, identical shape to missing', async () => {
    setCookie('anon-B')
    mocks.findUniqueSavedHedge.mockResolvedValue(fakeRow({ anonId: 'anon-A' }))

    const res = await GET(req('GET'), ctx())

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Saved hedge not found.' },
    })
  })
})

// ── AC 21, 22 — DELETE ───────────────────────────────────────────────────────
describe('DELETE /api/hedges/[id] — owned (AC 21)', () => {
  it('owned id → 200 { ok:true, data:{id} }, db.savedHedge.delete called', async () => {
    setCookie('anon-A')
    mocks.findUniqueSavedHedge.mockResolvedValue(fakeRow())

    const res = await DELETE(req('DELETE'), ctx())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: { id: 'hedge-1' },
    })
    expect(mocks.deleteSavedHedge).toHaveBeenCalledWith({
      where: { id: 'hedge-1' },
    })
  })
})

describe('DELETE /api/hedges/[id] — missing or foreign (AC 22)', () => {
  it('missing row → 404, delete never called', async () => {
    setCookie('anon-A')
    mocks.findUniqueSavedHedge.mockResolvedValue(null)

    const res = await DELETE(req('DELETE'), ctx())

    expect(res.status).toBe(404)
    expect(mocks.deleteSavedHedge).not.toHaveBeenCalled()
  })

  it('foreign anonId → 404, delete never called (same shape as missing)', async () => {
    setCookie('anon-B')
    mocks.findUniqueSavedHedge.mockResolvedValue(fakeRow({ anonId: 'anon-A' }))

    const res = await DELETE(req('DELETE'), ctx())

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Saved hedge not found.' },
    })
    expect(mocks.deleteSavedHedge).not.toHaveBeenCalled()
  })

  it('no cookie at all → 404, delete never called', async () => {
    setCookie(null)
    mocks.findUniqueSavedHedge.mockResolvedValue(fakeRow())

    const res = await DELETE(req('DELETE'), ctx())

    expect(res.status).toBe(404)
    expect(mocks.deleteSavedHedge).not.toHaveBeenCalled()
  })
})

// ── hardening AC 3, 8 — GET rate limited ────────────────────────────────────
describe('GET /api/hedges/[id] — rate limited (hardening AC 3, 8)', () => {
  it('checkRateLimit ok:false for hedges:read → 429 with Retry-After, before any DB read', async () => {
    mocks.checkRateLimit.mockResolvedValue({ ok: false, remaining: 0 })

    const res = await GET(req('GET'), ctx())

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Try again shortly.',
      },
    })
    expect(mocks.findUniqueSavedHedge).not.toHaveBeenCalled()
  })

  it('is checked against the hedges:read bucket with the configured limit/window', async () => {
    setCookie('anon-A')
    mocks.findUniqueSavedHedge.mockResolvedValue(fakeRow())
    mocks.checkRateLimit.mockResolvedValue({ ok: true, remaining: 59 })

    await GET(req('GET'), ctx())

    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      'hedges:read',
      '1.2.3.4',
      60,
      60
    )
  })

  it('checkRateLimit ok:true (fail-open / allowed) → proceeds to a normal 200', async () => {
    setCookie('anon-A')
    mocks.findUniqueSavedHedge.mockResolvedValue(fakeRow())
    mocks.checkRateLimit.mockResolvedValue({ ok: true, remaining: 59 })

    const res = await GET(req('GET'), ctx())

    expect(res.status).toBe(200)
  })
})

// ── hardening AC 4, 8 — DELETE rate limited ─────────────────────────────────
describe('DELETE /api/hedges/[id] — rate limited (hardening AC 4, 8)', () => {
  it('checkRateLimit ok:false for hedges:delete → 429 with Retry-After, before any DB write', async () => {
    mocks.checkRateLimit.mockResolvedValue({ ok: false, remaining: 0 })

    const res = await DELETE(req('DELETE'), ctx())

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Try again shortly.',
      },
    })
    expect(mocks.deleteSavedHedge).not.toHaveBeenCalled()
    expect(mocks.findUniqueSavedHedge).not.toHaveBeenCalled()
  })

  it('is checked against the hedges:delete bucket with the configured limit/window', async () => {
    setCookie('anon-A')
    mocks.findUniqueSavedHedge.mockResolvedValue(fakeRow())
    mocks.checkRateLimit.mockResolvedValue({ ok: true, remaining: 29 })

    await DELETE(req('DELETE'), ctx())

    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      'hedges:delete',
      '1.2.3.4',
      30,
      60
    )
  })

  it('checkRateLimit ok:true (fail-open / allowed) → proceeds to a normal 200', async () => {
    setCookie('anon-A')
    mocks.findUniqueSavedHedge.mockResolvedValue(fakeRow())
    mocks.checkRateLimit.mockResolvedValue({ ok: true, remaining: 29 })

    const res = await DELETE(req('DELETE'), ctx())

    expect(res.status).toBe(200)
  })
})

// ── hardening AC 15 — structured error logging on a forced 500 ─────────────
describe('GET /api/hedges/[id] — logs a structured error on a forced 500 (hardening AC 15)', () => {
  it('db.savedHedge.findUnique rejects → 500 INTERNAL (unchanged envelope), logger.error called with an errorId', async () => {
    setCookie('anon-A')
    mocks.findUniqueSavedHedge.mockRejectedValue(new Error('db down'))

    const res = await GET(req('GET'), ctx())

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: 'Something went wrong.' },
    })
    expect(mocks.loggerError).toHaveBeenCalledWith(
      'GET /api/hedges/[id] failed',
      expect.objectContaining({
        route: 'GET /api/hedges/[id]',
        errorId: 'test-err-id',
        err: 'db down',
      })
    )
  })
})

describe('DELETE /api/hedges/[id] — logs a structured error on a forced 500 (hardening AC 15)', () => {
  it('db.savedHedge.delete rejects → 500 INTERNAL (unchanged envelope), logger.error called', async () => {
    setCookie('anon-A')
    mocks.findUniqueSavedHedge.mockResolvedValue(fakeRow())
    mocks.deleteSavedHedge.mockRejectedValue(new Error('db down'))

    const res = await DELETE(req('DELETE'), ctx())

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: 'Something went wrong.' },
    })
    expect(mocks.loggerError).toHaveBeenCalledWith(
      'DELETE /api/hedges/[id] failed',
      expect.objectContaining({
        route: 'DELETE /api/hedges/[id]',
        errorId: 'test-err-id',
        err: 'db down',
      })
    )
  })
})
