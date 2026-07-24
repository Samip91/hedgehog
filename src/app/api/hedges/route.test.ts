import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HedgeSpec, SaveHedgeRequest } from '@/shared/schemas'

/**
 * Route tests for `POST` / `GET /api/hedges` (spec
 * `docs/features/saved-hedges/spec.md` ACs 1–3, 5–12, 35). Follows
 * `hedge/route.test.ts`'s `vi.hoisted` + `vi.mock` pattern: `@/server/db` and
 * `next/headers`'s `cookies()` are mocked so no Postgres/Next-request-context
 * call is ever made from this suite. `server-only` is neutralized (mirrors
 * `sync.test.ts`) so the real `@/server/anon` + `@/server/db` module graph
 * can load under vitest's plain `node` environment.
 */

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  findUniqueSavedHedge: vi.fn(),
  upsertSavedHedge: vi.fn(),
  findManySavedHedge: vi.fn(),
  findUniqueMarketSnapshot: vi.fn(),
  findManyMarketSnapshot: vi.fn(),
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
      upsert: mocks.upsertSavedHedge,
      findMany: mocks.findManySavedHedge,
    },
    marketSnapshot: {
      findUnique: mocks.findUniqueMarketSnapshot,
      findMany: mocks.findManyMarketSnapshot,
    },
  },
}))

import { GET, POST } from './route'

function setCookie(anonId: string | null): void {
  mocks.cookieGet.mockImplementation((name: string) =>
    name === 'anonId' && anonId !== null ? { name, value: anonId } : undefined
  )
}

function fakeSpec(): HedgeSpec {
  return {
    riskDescription: 'Financial loss from rain on wedding day',
    domain: 'weather',
    direction: 'happens',
    exposureUsd: 500,
    deadline: '2026-03-21',
    location: 'Miami',
    asset: null,
    threshold: null,
    confidence: 'high',
    clarificationNeeded: null,
  }
}

function validBody(
  overrides: Partial<SaveHedgeRequest> = {}
): SaveHedgeRequest {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    prompt: 'Will it rain on my wedding?',
    spec: fakeSpec(),
    provider: 'KALSHI',
    externalId: 'K-TEST',
    question: 'Will it rain in Miami on March 21?',
    side: 'YES',
    entryPrice: 0.4,
    stakeUsd: 100,
    ...overrides,
  }
}

/** A DB row shape sufficient for `savedHedgeToView` (plain numbers coerce
 * fine through `Number()`, matching how `Prisma.Decimal` also coerces). */
function fakeRow(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    anonId: 'anon-A',
    prompt: 'Will it rain on my wedding?',
    spec: fakeSpec(),
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

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/hedges', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function getReq(): NextRequest {
  return new NextRequest('http://localhost/api/hedges', { method: 'GET' })
}

beforeEach(() => {
  vi.clearAllMocks()
  setCookie(null)
  mocks.findUniqueSavedHedge.mockResolvedValue(null)
  mocks.upsertSavedHedge.mockResolvedValue(fakeRow())
  mocks.findManySavedHedge.mockResolvedValue([])
  mocks.findUniqueMarketSnapshot.mockResolvedValue(null)
  mocks.findManyMarketSnapshot.mockResolvedValue([])
})

// ── AC 1 — no cookie → mint + set on response ───────────────────────────────
describe('POST /api/hedges — anonId cookie mint (AC 1)', () => {
  it('no existing cookie → 200, upserted, and a fresh anonId cookie is SET on the response', async () => {
    setCookie(null)

    const res = await POST(postReq(validBody()))

    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
    expect(mocks.upsertSavedHedge).toHaveBeenCalledOnce()

    const cookie = res.cookies.get('anonId')
    expect(cookie).toBeDefined()
    expect(cookie?.value).toBeTruthy()
    expect(cookie?.httpOnly).toBe(true)
  })
})

// ── AC 2 — existing cookie is reused, not rotated ───────────────────────────
describe('POST /api/hedges — anonId cookie reuse (AC 2)', () => {
  it('existing cookie → 200, no new cookie minted on the response', async () => {
    setCookie('anon-existing')
    mocks.findUniqueSavedHedge.mockResolvedValue(null)

    const res = await POST(postReq(validBody()))

    expect(res.status).toBe(200)
    expect(res.cookies.get('anonId')).toBeUndefined()
    expect(mocks.upsertSavedHedge).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ anonId: 'anon-existing' }),
      })
    )
  })
})

// ── AC 7 — 400 on invalid body ──────────────────────────────────────────────
describe('POST /api/hedges — 400 invalid body (AC 7)', () => {
  it('a body missing required fields → 400 BAD_REQUEST, nothing upserted', async () => {
    const res = await POST(postReq({ id: 'not-a-uuid' }))

    expect(res.status).toBe(400)
    const body = (await res.json()) as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('BAD_REQUEST')
    expect(mocks.upsertSavedHedge).not.toHaveBeenCalled()
  })
})

// ── AC 8 — foreign anonId collision → 403 ───────────────────────────────────
describe('POST /api/hedges — foreign anonId collision (AC 8)', () => {
  it('id already exists under a DIFFERENT anonId → 403 FORBIDDEN, no upsert', async () => {
    setCookie('anon-B')
    mocks.findUniqueSavedHedge.mockResolvedValue({ anonId: 'anon-A' })

    const res = await POST(postReq(validBody()))

    expect(res.status).toBe(403)
    const body = (await res.json()) as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('FORBIDDEN')
    expect(mocks.upsertSavedHedge).not.toHaveBeenCalled()
  })
})

// ── AC 6 — idempotent re-POST by the same anonId ────────────────────────────
describe('POST /api/hedges — idempotent re-POST (AC 6)', () => {
  it('same id, same anonId, POSTed twice → upsert called both times, no 403/duplicate', async () => {
    setCookie('anon-A')
    const body = validBody()

    mocks.findUniqueSavedHedge.mockResolvedValueOnce(null)
    const res1 = await POST(postReq(body))
    expect(res1.status).toBe(200)

    mocks.findUniqueSavedHedge.mockResolvedValueOnce({ anonId: 'anon-A' })
    const res2 = await POST(postReq(body))
    expect(res2.status).toBe(200)

    expect(mocks.upsertSavedHedge).toHaveBeenCalledTimes(2)
    expect(mocks.upsertSavedHedge.mock.calls[0]?.[0].where).toEqual({
      id: body.id,
    })
    expect(mocks.upsertSavedHedge.mock.calls[1]?.[0].where).toEqual({
      id: body.id,
    })
  })
})

// ── AC 5, 9 — Decimal math + shape on create ────────────────────────────────
describe('POST /api/hedges — Decimal upsert shape (AC 5, 9)', () => {
  it('create payload has shares = stakeUsd/entryPrice, status OPEN, settledPnlUsd null', async () => {
    setCookie('anon-A')

    await POST(postReq(validBody({ stakeUsd: 100, entryPrice: 0.4 })))

    const call = mocks.upsertSavedHedge.mock.calls[0]?.[0]
    expect(call.create.status).toBe('OPEN')
    expect(call.create.settledPnlUsd).toBeNull()
    // Prisma.Decimal exposes toNumber(); shares should equal stake/entry.
    expect(Number(call.create.shares)).toBeCloseTo(250, 5)
  })
})

// ── AC 3 — GET list with no cookie → empty, no mint ─────────────────────────
describe('GET /api/hedges — no cookie (AC 3)', () => {
  it('no anonId cookie → 200 { ok:true, data:[] }, savedHedge.findMany never called', async () => {
    setCookie(null)

    const res = await GET(getReq())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, data: [] })
    expect(mocks.findManySavedHedge).not.toHaveBeenCalled()
  })

  it('never sets a cookie on a GET (read-only)', async () => {
    setCookie(null)

    const res = await GET(getReq())

    expect(res.cookies.get('anonId')).toBeUndefined()
  })
})

// ── AC 10, 11, 12 — GET list happy path / empty / no cross-anon leakage ─────
describe('GET /api/hedges — list (AC 10, 11, 12)', () => {
  it('zero owned rows → 200 { data: [] } (not 404)', async () => {
    setCookie('anon-A')
    mocks.findManySavedHedge.mockResolvedValue([])

    const res = await GET(getReq())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, data: [] })
  })

  it('N owned rows → 200 with N settled views, scoped to the caller anonId, one batched snapshot query', async () => {
    setCookie('anon-A')
    const rows = [
      fakeRow({ id: 'a', externalId: 'K-1' }),
      fakeRow({ id: 'b', externalId: 'K-2' }),
    ]
    mocks.findManySavedHedge.mockResolvedValue(rows)
    mocks.findManyMarketSnapshot.mockResolvedValue([])

    const res = await GET(getReq())

    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data: unknown[] }
    expect(body.ok).toBe(true)
    expect(body.data).toHaveLength(2)

    // No cross-anon leakage: the query is scoped by the caller's own anonId.
    expect(mocks.findManySavedHedge).toHaveBeenCalledWith({
      where: { anonId: 'anon-A' },
      orderBy: { createdAt: 'desc' },
    })
    // Batched (not N+1): exactly one snapshot findMany call for the whole list.
    expect(mocks.findManyMarketSnapshot).toHaveBeenCalledOnce()
  })
})
