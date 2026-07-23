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
