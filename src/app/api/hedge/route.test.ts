import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HedgeSpec } from '@/shared/schemas'
import type { HedgeProposal } from '@/shared/proposal'

/**
 * Route tests for `POST /api/hedge` (spec
 * `docs/features/propose-hedge/spec.md` AC 1,7,9,10,13). Follows
 * `health/route.test.ts`'s `vi.hoisted` + `vi.mock` pattern: the four
 * pipeline stage modules and `@/server/rate-limit` are mocked so no LLM/DB
 * call is ever made from this suite.
 */

const mocks = vi.hoisted(() => ({
  parseRisk: vi.fn(),
  retrieveCandidates: vi.fn(),
  rerank: vi.fn(),
  buildProposal: vi.fn(),
  checkHedgeRateLimit: vi.fn(),
  clientIp: vi.fn(),
}))

vi.mock('@/server/pipeline/parse', () => ({ parseRisk: mocks.parseRisk }))
vi.mock('@/server/pipeline/retrieve', () => ({
  retrieveCandidates: mocks.retrieveCandidates,
}))
vi.mock('@/server/pipeline/rank', () => ({ rerank: mocks.rerank }))
vi.mock('@/server/pipeline/propose', () => ({
  buildProposal: mocks.buildProposal,
}))
vi.mock('@/server/rate-limit', () => ({
  checkHedgeRateLimit: mocks.checkHedgeRateLimit,
  clientIp: mocks.clientIp,
}))

import { POST } from './route'

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/hedge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
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

function fakeProposal(overrides: Partial<HedgeProposal> = {}): HedgeProposal {
  return {
    spec: fakeSpec(),
    best: null,
    alternatives: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.checkHedgeRateLimit.mockResolvedValue({ ok: true, remaining: 9 })
  mocks.clientIp.mockReturnValue('1.2.3.4')
})

// ── AC 13 — 400 bad body (unchanged) ────────────────────────────────────────
describe('POST /api/hedge — 400 bad body', () => {
  it('missing prompt → 400 BAD_REQUEST', async () => {
    const res = await POST(postReq({}))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: {
        code: 'BAD_REQUEST',
        message: 'A non-empty `prompt` is required.',
      },
    })
  })

  it('empty prompt string → 400 BAD_REQUEST', async () => {
    const res = await POST(postReq({ prompt: '' }))

    expect(res.status).toBe(400)
    const body = (await res.json()) as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('BAD_REQUEST')
  })

  it('does not run any pipeline stage on a 400', async () => {
    await POST(postReq({}))

    expect(mocks.parseRisk).not.toHaveBeenCalled()
    expect(mocks.retrieveCandidates).not.toHaveBeenCalled()
    expect(mocks.rerank).not.toHaveBeenCalled()
    expect(mocks.buildProposal).not.toHaveBeenCalled()
  })
})

// ── AC 1 — 200 happy path ───────────────────────────────────────────────────
describe('POST /api/hedge — 200 happy path', () => {
  it('runs parse → retrieve → rerank → propose in sequence and returns ok(proposal)', async () => {
    const spec = fakeSpec()
    const candidates = [{ market: {}, cosine: 0, keyword: 0, score: 0 }]
    const matches = [{ side: 'YES' }]
    const proposal = fakeProposal({
      best: {
        provider: 'kalshi',
        externalId: 'K-1',
        question: 'Will it rain?',
        url: 'https://kalshi.com/markets/K-1',
        closeTime: null,
        yesPrice: 0.4,
        noPrice: 0.6,
        liquidityUsd: 1000,
        side: 'YES',
        relevance: 'high',
        reasoning: 'Direct hedge.',
        price: 0.4,
        sized: true,
        stakeUsd: 100,
        shares: 250,
        payoutIfWin: 250,
        netIfBadOutcome: -350,
        netIfGoodOutcome: -100,
        coverageRatio: 0.5,
        coveragePct: 50,
      },
    })
    mocks.parseRisk.mockResolvedValue(spec)
    mocks.retrieveCandidates.mockResolvedValue(candidates)
    mocks.rerank.mockResolvedValue(matches)
    mocks.buildProposal.mockResolvedValue(proposal)

    const res = await POST(postReq({ prompt: 'Will it rain on my wedding?' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, data: proposal })
    expect(mocks.parseRisk).toHaveBeenCalledWith('Will it rain on my wedding?')
    expect(mocks.retrieveCandidates).toHaveBeenCalledWith(
      spec,
      'Will it rain on my wedding?'
    )
    expect(mocks.rerank).toHaveBeenCalledWith(spec, candidates)
    expect(mocks.buildProposal).toHaveBeenCalledWith(spec, matches)
  })
})

// ── AC 5 — 200 empty-matches case ───────────────────────────────────────────
describe('POST /api/hedge — 200 empty-matches case', () => {
  it('rerank → [] and buildProposal → {best:null,alternatives:[]} still returns 200', async () => {
    const spec = fakeSpec()
    const emptyProposal = fakeProposal()
    mocks.parseRisk.mockResolvedValue(spec)
    mocks.retrieveCandidates.mockResolvedValue([])
    mocks.rerank.mockResolvedValue([])
    mocks.buildProposal.mockResolvedValue(emptyProposal)

    const res = await POST(postReq({ prompt: 'A very obscure risk' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: emptyProposal,
    })
  })
})

// ── AC 9 — 429 rate-limited, no pipeline stage runs ─────────────────────────
describe('POST /api/hedge — 429 rate-limited', () => {
  it('checkHedgeRateLimit ok:false → 429 RATE_LIMITED', async () => {
    mocks.checkHedgeRateLimit.mockResolvedValue({ ok: false, remaining: 0 })

    const res = await POST(postReq({ prompt: 'Will it rain?' }))

    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Try again shortly.',
      },
    })
  })

  it('runs none of the four pipeline stages when rate-limited (no LLM spend)', async () => {
    mocks.checkHedgeRateLimit.mockResolvedValue({ ok: false, remaining: 0 })

    await POST(postReq({ prompt: 'Will it rain?' }))

    expect(mocks.parseRisk).not.toHaveBeenCalled()
    expect(mocks.retrieveCandidates).not.toHaveBeenCalled()
    expect(mocks.rerank).not.toHaveBeenCalled()
    expect(mocks.buildProposal).not.toHaveBeenCalled()
  })

  it('the rate-limit check runs before body validation (blocked + invalid body → 429, not 400)', async () => {
    mocks.checkHedgeRateLimit.mockResolvedValue({ ok: false, remaining: 0 })

    const res = await POST(postReq({}))

    expect(res.status).toBe(429)
  })
})

// ── AC 7 — 500 on a propagated infra failure ────────────────────────────────
describe('POST /api/hedge — 500 on propagated infra failure', () => {
  it('retrieveCandidates rejects (simulated Postgres failure) → 500 PIPELINE_ERROR, no partial body', async () => {
    mocks.parseRisk.mockResolvedValue(fakeSpec())
    mocks.retrieveCandidates.mockRejectedValue(new Error('connection refused'))

    const res = await POST(postReq({ prompt: 'Will it rain?' }))

    expect(res.status).toBe(500)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({
      ok: false,
      error: {
        code: 'PIPELINE_ERROR',
        message: 'Could not build a hedge right now.',
      },
    })
    expect(body).not.toHaveProperty('data')
    expect(mocks.rerank).not.toHaveBeenCalled()
    expect(mocks.buildProposal).not.toHaveBeenCalled()
  })
})

// ── review finding 2 — response-schema backstop ─────────────────────────────
describe('POST /api/hedge — 500 when buildProposal output fails HedgeProposalSchema (schema backstop)', () => {
  it('a proposal with an out-of-range `price` returns 500 PIPELINE_ERROR, never a 200 with a bad body', async () => {
    const malformed = fakeProposal({
      best: {
        provider: 'kalshi',
        externalId: 'K-1',
        question: 'Will it rain?',
        url: 'https://kalshi.com/markets/K-1',
        closeTime: null,
        yesPrice: 0.4,
        noPrice: 0.6,
        liquidityUsd: 1000,
        side: 'YES',
        relevance: 'high',
        reasoning: 'Direct hedge.',
        price: 1.5, // outside the schema's (0,1) bound
        sized: false,
        stakeUsd: null,
        shares: null,
        payoutIfWin: null,
        netIfBadOutcome: null,
        netIfGoodOutcome: null,
        coverageRatio: null,
        coveragePct: null,
      },
    })
    mocks.parseRisk.mockResolvedValue(fakeSpec())
    mocks.retrieveCandidates.mockResolvedValue([])
    mocks.rerank.mockResolvedValue([])
    mocks.buildProposal.mockResolvedValue(malformed)

    const res = await POST(postReq({ prompt: 'Will it rain?' }))

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: {
        code: 'PIPELINE_ERROR',
        message: 'Could not build a hedge right now.',
      },
    })
  })

  it('a proposal with a non-finite payoff field (Infinity) returns 500 PIPELINE_ERROR, never a 200', async () => {
    const malformed = fakeProposal({
      best: {
        provider: 'kalshi',
        externalId: 'K-1',
        question: 'Will it rain?',
        url: 'https://kalshi.com/markets/K-1',
        closeTime: null,
        yesPrice: 0.4,
        noPrice: 0.6,
        liquidityUsd: 1000,
        side: 'YES',
        relevance: 'high',
        reasoning: 'Direct hedge.',
        price: 0.4,
        sized: true,
        stakeUsd: 100,
        shares: 250,
        payoutIfWin: Infinity, // non-finite — must not leak into a 200
        netIfBadOutcome: -350,
        netIfGoodOutcome: -100,
        coverageRatio: 0.5,
        coveragePct: 50,
      },
    })
    mocks.parseRisk.mockResolvedValue(fakeSpec())
    mocks.retrieveCandidates.mockResolvedValue([])
    mocks.rerank.mockResolvedValue([])
    mocks.buildProposal.mockResolvedValue(malformed)

    const res = await POST(postReq({ prompt: 'Will it rain?' }))

    expect(res.status).toBe(500)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({
      ok: false,
      error: {
        code: 'PIPELINE_ERROR',
        message: 'Could not build a hedge right now.',
      },
    })
    expect(body).not.toHaveProperty('data')
  })
})

// ── AC 10 — writes nothing to SavedHedge ────────────────────────────────────
describe('POST /api/hedge — no persistence (AC 10)', () => {
  it('never imports "@/server/db" or "@prisma/client" (statically grep-checkable — no Prisma create/upsert is reachable)', () => {
    const routePath = fileURLToPath(new URL('./route.ts', import.meta.url))
    const source = readFileSync(routePath, 'utf-8')
    expect(source).not.toMatch(/@\/server\/db/)
    expect(source).not.toMatch(/@prisma\/client/)
  })
})

// ── request-path-no-providers ───────────────────────────────────────────────
describe('POST /api/hedge — never imports a provider client', () => {
  it('the route source never imports "@/server/providers"', () => {
    const routePath = fileURLToPath(new URL('./route.ts', import.meta.url))
    const source = readFileSync(routePath, 'utf-8')
    expect(source).not.toMatch(/@\/server\/providers/)
  })
})
