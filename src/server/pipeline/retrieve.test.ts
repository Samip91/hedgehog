import { MarketStatus, Provider } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildNormalizedMarket } from '@/server/providers/normalize'
import type { NormalizedMarket } from '@/server/providers/types'
import type { HedgeSpec } from '@/shared/schemas'

// retrieve.ts statically imports embedText (→ @/server/pipeline/embed →
// @/config/env, which does `import 'server-only'` and validates process.env
// at module load). Mocking the module out entirely (not `importOriginal`)
// keeps the real env.ts — and its `import 'server-only'` — from ever
// loading, mirroring embed.test.ts's approach.
vi.mock('@/config/env', () => ({
  env: {
    NVIDIA_BASE_URL: 'https://nim.example.com',
    NVIDIA_API_KEY: 'test-nim-key',
    EMBEDDING_MODEL: 'test-embed-model',
    EMBEDDING_DIM: 4,
  },
}))

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  findMany: vi.fn(),
}))

// db.ts does `import 'server-only'` at module load — a full mock (not
// `importOriginal`) means the real module (and that import) never runs
// (mirrors sync.test.ts's `@/server/db` mock).
vi.mock('@/server/db', () => ({
  db: {
    $queryRaw: mocks.queryRaw,
    marketSnapshot: { findMany: mocks.findMany },
  },
}))

import {
  DEADLINE_WINDOW_DAYS,
  LIQUIDITY_FLOOR_USD,
  MAX_CANDIDATES,
  combineScore,
  dedupeByQuestionSignature,
  keywordScore,
  liquidityBoost,
  questionSignature,
  retrieveCandidates,
  type Candidate,
  type RetrieveDeps,
  type ScoredMarket,
} from './retrieve'

// ── Fixture builders ────────────────────────────────────────────────────────

interface MarketInput {
  provider?: NormalizedMarket['provider']
  externalId?: string
  question?: string
  searchText?: string
  category?: string
  yesPrice?: number
  noPrice?: number
  status?: NormalizedMarket['status']
  url?: string
  eventTitle?: string
  volumeUsd?: number
  liquidityUsd?: number
  closeTime?: Date
  resolvedYes?: boolean
}

function market(overrides: MarketInput = {}): NormalizedMarket {
  return buildNormalizedMarket(
    {
      provider: overrides.provider ?? 'kalshi',
      externalId: overrides.externalId ?? 'K-TEST',
      question: overrides.question ?? 'Will it rain in Miami on March 21?',
      searchText:
        overrides.searchText ??
        'Will it rain in Miami on March 21? Miami Weather weather rain',
      yesPrice: overrides.yesPrice ?? 0.4,
      noPrice: overrides.noPrice ?? 0.6,
      status: overrides.status ?? 'open',
      url: overrides.url ?? 'https://kalshi.com/markets/K-TEST',
    },
    {
      eventTitle: overrides.eventTitle,
      category: overrides.category,
      volumeUsd: overrides.volumeUsd,
      liquidityUsd: overrides.liquidityUsd,
      closeTime: overrides.closeTime,
      resolvedYes: overrides.resolvedYes,
    }
  )
}

function spec(overrides: Partial<HedgeSpec> = {}): HedgeSpec {
  return {
    riskDescription: 'a generic risk description',
    domain: 'other',
    direction: 'happens',
    exposureUsd: null,
    deadline: null,
    location: null,
    asset: null,
    threshold: null,
    confidence: 'low',
    clarificationNeeded: null,
    ...overrides,
  }
}

function scored(m: NormalizedMarket, cosine: number): ScoredMarket {
  return { market: m, cosine }
}

/** Never touches the network — always injected explicitly so a test can
 * never accidentally fall through to the real `embedText`/NIM default seam. */
const embedOk: RetrieveDeps['embed'] = async () => [0.1, 0.2, 0.3, 0.4]

beforeEach(() => {
  mocks.queryRaw.mockReset()
  mocks.findMany.mockReset()
})

// ── Hard filters (AC 5–8) ───────────────────────────────────────────────────

describe('retrieveCandidates — hard filters (AC 5–8)', () => {
  it('AC 5: a closed/resolved market is never returned, even scoring highest', async () => {
    const open = market({ externalId: 'OPEN-1' })
    const closed = market({ externalId: 'CLOSED-1', status: 'closed' })
    const deps: RetrieveDeps = {
      embed: embedOk,
      vectorTopK: async () => [scored(open, 0.1), scored(closed, 0.99)],
    }

    const result = await retrieveCandidates(spec(), 'rain', deps)

    const ids = result.map(c => c.market.externalId)
    expect(ids).not.toContain('CLOSED-1')
    expect(ids).toContain('OPEN-1')
  })

  it('AC 6: excludes closeTime > deadline+30d, retains within window, excludes missing closeTime with a deadline set', async () => {
    const deadline = '2026-08-01'
    const tooLate = market({
      externalId: 'TOO-LATE',
      closeTime: new Date('2026-09-10T00:00:00.000Z'), // deadline + 40d
    })
    const withinWindow = market({
      externalId: 'WITHIN-WINDOW',
      closeTime: new Date('2026-08-11T00:00:00.000Z'), // deadline + 10d
    })
    const noCloseTime = market({ externalId: 'NO-CLOSE-TIME' })
    const deps: RetrieveDeps = {
      embed: embedOk,
      vectorTopK: async () => [
        scored(tooLate, 0.5),
        scored(withinWindow, 0.5),
        scored(noCloseTime, 0.5),
      ],
    }

    const result = await retrieveCandidates(spec({ deadline }), 'x', deps)

    const ids = result.map(c => c.market.externalId)
    expect(ids).not.toContain('TOO-LATE')
    expect(ids).toContain('WITHIN-WINDOW')
    expect(ids).not.toContain('NO-CLOSE-TIME')
  })

  it(`AC 6: DEADLINE_WINDOW_DAYS is ${30} and no closeTime filter applies when deadline is null`, async () => {
    expect(DEADLINE_WINDOW_DAYS).toBe(30)

    const farFuture = market({
      externalId: 'FAR-FUTURE',
      question: 'Will X happen far in the future?',
      searchText: 'Will X happen far in the future?',
      closeTime: new Date('2099-01-01T00:00:00.000Z'),
    })
    const noCloseTime = market({
      externalId: 'NO-CLOSE-TIME',
      question: 'Will Y happen with no known close time?',
      searchText: 'Will Y happen with no known close time?',
    })
    const deps: RetrieveDeps = {
      embed: embedOk,
      vectorTopK: async () => [
        scored(farFuture, 0.5),
        scored(noCloseTime, 0.5),
      ],
    }

    const result = await retrieveCandidates(spec({ deadline: null }), 'x', deps)

    const ids = result.map(c => c.market.externalId)
    expect(ids).toContain('FAR-FUTURE')
    expect(ids).toContain('NO-CLOSE-TIME')
  })

  it('AC 7: excludes liquidityUsd below the floor; unknown (undefined) liquidity is not excluded', async () => {
    const belowFloor = market({
      externalId: 'LOW-LIQ',
      liquidityUsd: LIQUIDITY_FLOOR_USD - 1,
    })
    const unknownLiq = market({ externalId: 'UNKNOWN-LIQ' })
    const deps: RetrieveDeps = {
      embed: embedOk,
      vectorTopK: async () => [
        scored(belowFloor, 0.5),
        scored(unknownLiq, 0.5),
      ],
    }

    const result = await retrieveCandidates(spec(), 'x', deps)

    const ids = result.map(c => c.market.externalId)
    expect(ids).not.toContain('LOW-LIQ')
    expect(ids).toContain('UNKNOWN-LIQ')
  })

  it('AC 8: confidence "high" excludes a wrong-category market; "medium" does not', async () => {
    const weatherM = market({
      externalId: 'WEATHER-1',
      question: 'Will it rain in Miami on March 21?',
      searchText: 'Will it rain in Miami on March 21? weather',
      category: 'weather',
    })
    const cryptoM = market({
      externalId: 'CRYPTO-1',
      question: 'Will BTC close above 60000 dollars?',
      searchText: 'Will BTC close above 60000 dollars? crypto',
      category: 'crypto',
    })
    const deps: RetrieveDeps = {
      embed: embedOk,
      vectorTopK: async () => [scored(weatherM, 0.5), scored(cryptoM, 0.5)],
    }

    const highResult = await retrieveCandidates(
      spec({ domain: 'weather', confidence: 'high' }),
      'x',
      deps
    )
    const highIds = highResult.map(c => c.market.externalId)
    expect(highIds).toContain('WEATHER-1')
    expect(highIds).not.toContain('CRYPTO-1')

    const mediumResult = await retrieveCandidates(
      spec({ domain: 'weather', confidence: 'medium' }),
      'x',
      deps
    )
    const mediumIds = mediumResult.map(c => c.market.externalId)
    expect(mediumIds).toContain('WEATHER-1')
    expect(mediumIds).toContain('CRYPTO-1')
  })
})

// ── Hybrid scoring — pure helpers (AC 9) ────────────────────────────────────

describe('combineScore / liquidityBoost / keywordScore (AC 9)', () => {
  it('combineScore matches score = 0.60·cosine + 0.25·keyword + 0.15·liquidityBoost exactly', () => {
    expect(combineScore(0.5, 0.4, 0.2)).toBeCloseTo(
      0.6 * 0.5 + 0.25 * 0.4 + 0.15 * 0.2,
      10
    )
  })

  it('liquidityBoost(undefined) === 0 (never NaN/undefined)', () => {
    expect(liquidityBoost(undefined)).toBe(0)
  })

  it('liquidityBoost clamps to [0, 1] and scales linearly below the full-boost value', () => {
    expect(liquidityBoost(0)).toBe(0)
    expect(liquidityBoost(250_000)).toBeCloseTo(0.5, 10) // half of LIQUIDITY_FULL_BOOST_USD
    expect(liquidityBoost(5_000_000)).toBe(1) // clamped, not > 1
  })

  it('keywordScore: token-coverage formula on a known token pair', () => {
    const m = market({
      searchText: 'rain forecast for the wedding venue this weekend',
    })
    const s = spec({ riskDescription: 'rain flooding wedding' })

    // queryTokens = {rain, flooding, wedding} (size 3); marketTokens contains
    // rain + wedding but not flooding → overlap 2 → 2/3.
    expect(keywordScore(m, s, 'rain flooding wedding')).toBeCloseTo(2 / 3, 10)
  })

  it('keywordScore returns 0 (never NaN) when the query has no tokenizable terms', () => {
    const m = market({ searchText: 'rain in miami' })
    const s = spec({ riskDescription: '!!!' })

    expect(keywordScore(m, s, '???')).toBe(0)
  })
})

// ── Determinism (AC 10) ──────────────────────────────────────────────────────

describe('retrieveCandidates — determinism (AC 10)', () => {
  it('running twice on identical injected fixtures yields identical ordered output', async () => {
    const a = market({ externalId: 'A', liquidityUsd: 5_000 })
    const b = market({
      externalId: 'B',
      question: 'A different question about B',
      searchText: 'A different question about B',
      liquidityUsd: 5_000,
    })
    const deps: RetrieveDeps = {
      embed: embedOk,
      vectorTopK: async () => [scored(a, 0.5), scored(b, 0.5)],
    }
    const s = spec()

    const first = await retrieveCandidates(s, 'x', deps)
    const second = await retrieveCandidates(s, 'x', deps)

    expect(second).toEqual(first)
  })
})

// ── Cross-provider dedupe (AC 11) ───────────────────────────────────────────

describe('questionSignature / dedupeByQuestionSignature (AC 11)', () => {
  it('normalizes case and word order; drops stopwords but keeps numeric tokens', () => {
    expect(questionSignature('Will BTC drop below 60000 dollars?')).toBe(
      questionSignature('The BTC Dollars Below 60000 Will Drop')
    )
    expect(questionSignature('below 60000')).not.toBe(
      questionSignature('below 70000')
    )
  })

  it('dedupeByQuestionSignature keeps only the higher-scoring candidate per signature', () => {
    const low: Candidate = {
      market: market({
        provider: 'kalshi',
        externalId: 'K-1',
        question: 'Will it rain in NYC tomorrow?',
      }),
      cosine: 0.5,
      keyword: 0.5,
      score: 0.5,
    }
    const high: Candidate = {
      market: market({
        provider: 'polymarket',
        externalId: 'P-1',
        question: 'Will it rain in NYC tomorrow?',
      }),
      cosine: 0.9,
      keyword: 0.9,
      score: 0.9,
    }

    const result = dedupeByQuestionSignature([low, high])

    expect(result).toHaveLength(1)
    expect(result[0]?.market.externalId).toBe('P-1')
  })

  it('retrieveCandidates: a same-signature cross-provider pair yields exactly one candidate (the higher-scoring)', async () => {
    const kalshiM = market({
      provider: 'kalshi',
      externalId: 'K-BTC-60K',
      question: 'Will BTC drop below 60000 dollars?',
      searchText: 'Will BTC drop below 60000 dollars? crypto',
      liquidityUsd: 400_000,
    })
    const polyM = market({
      provider: 'polymarket',
      externalId: 'P-BTC-60K',
      question: 'Will BTC drop below 60000 dollars?',
      searchText: 'Will BTC drop below 60000 dollars? crypto',
      liquidityUsd: 1_000,
    })
    const deps: RetrieveDeps = {
      embed: embedOk,
      vectorTopK: async () => [scored(kalshiM, 0.9), scored(polyM, 0.1)],
    }

    const result = await retrieveCandidates(spec(), 'x', deps)

    expect(result).toHaveLength(1)
    expect(result[0]?.market.externalId).toBe('K-BTC-60K')
  })
})

// ── Top-15 cut (AC 12, 13) ──────────────────────────────────────────────────

describe('retrieveCandidates — top-15 cut (AC 12, 13)', () => {
  it('AC 12: never returns more than 15 candidates, even with 20 survivors', async () => {
    // Token attached to the digit (`topic${i}`) so single-digit indices
    // still tokenize to a distinct signature (bare single-digit numbers are
    // dropped by `tokenize`'s `length >= 2` filter).
    const markets = Array.from({ length: 20 }, (_, i) =>
      market({
        externalId: `M-${i}`,
        question: `Question about topic${i}`,
        searchText: `Question about topic${i}`,
        liquidityUsd: 1_000 + i,
      })
    )
    const deps: RetrieveDeps = {
      embed: embedOk,
      vectorTopK: async () => markets.map((m, i) => scored(m, i / 20)),
    }

    const result = await retrieveCandidates(spec(), 'x', deps)

    expect(result).toHaveLength(MAX_CANDIDATES)
  })

  it('AC 13: returns fewer than 15, not padded or duplicated, when fewer survive', async () => {
    const m1 = market({
      externalId: 'ONLY-1',
      question: 'unique question one',
      searchText: 'unique question one',
    })
    const m2 = market({
      externalId: 'ONLY-2',
      question: 'unique question two',
      searchText: 'unique question two',
    })
    const deps: RetrieveDeps = {
      embed: embedOk,
      vectorTopK: async () => [scored(m1, 0.5), scored(m2, 0.4)],
    }

    const result = await retrieveCandidates(spec(), 'x', deps)

    expect(result.length).toBeLessThanOrEqual(2)
    const ids = result.map(c => c.market.externalId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

// ── pgvector query — default seam (AC 14) ───────────────────────────────────

describe('retrieveCandidates — pgvector query, default vectorTopK seam (AC 14)', () => {
  it('issues exactly one db.$queryRaw call, bound LIMIT <= 50, when embed succeeds', async () => {
    mocks.queryRaw.mockResolvedValue([])
    // Only `embed` is injected — `vectorTopK` is left to its default
    // (`pgvectorTopK`), which is the thing this test exercises.
    const deps: RetrieveDeps = { embed: embedOk }

    await retrieveCandidates(spec(), 'x', deps)

    expect(mocks.queryRaw).toHaveBeenCalledTimes(1)
    const callArgs = mocks.queryRaw.mock.calls[0] as unknown[]
    const limitArg = callArgs[callArgs.length - 1]
    expect(typeof limitArg).toBe('number')
    expect(limitArg as number).toBeLessThanOrEqual(50)
    // The degraded-mode pool read must not also run.
    expect(mocks.findMany).not.toHaveBeenCalled()
  })

  // Reviewer finding: pgvectorTopK's per-row VectorRowSchema.safeParse must
  // skip a malformed row rather than aborting the whole read — a single
  // corrupt row must not take retrieval down (mirrors sync's per-row
  // resilience, see the "Malformed rows are skipped" doc comment above
  // pgvectorTopK).
  it('skips a malformed $queryRaw row without throwing; valid rows still survive', async () => {
    const validRow = {
      provider: Provider.KALSHI,
      externalId: 'K-VALID-1',
      question: 'Will it rain in Miami on March 21?',
      eventTitle: null,
      searchText: 'Will it rain in Miami on March 21? weather',
      category: 'weather',
      yesPrice: 0.4,
      noPrice: 0.6,
      volumeUsd: null,
      liquidityUsd: 5_000,
      closeTime: null,
      status: MarketStatus.OPEN,
      resolvedYes: null,
      cosine: 0.8,
    }
    // Malformed: missing `question` (required, min length 1) and a
    // `yesPrice` DecimalLikeSchema can't coerce — VectorRowSchema rejects it.
    const malformedRow = {
      provider: Provider.KALSHI,
      externalId: 'K-MALFORMED-1',
      eventTitle: null,
      searchText: 'a malformed row missing question',
      category: 'weather',
      yesPrice: null,
      noPrice: 0.6,
      volumeUsd: null,
      liquidityUsd: 5_000,
      closeTime: null,
      status: MarketStatus.OPEN,
      resolvedYes: null,
      cosine: 0.9,
    }
    mocks.queryRaw.mockResolvedValue([validRow, malformedRow])
    const deps: RetrieveDeps = { embed: embedOk }

    const result = await retrieveCandidates(spec(), 'x', deps)

    const ids = result.map(c => c.market.externalId)
    expect(ids).not.toContain('K-MALFORMED-1')
    expect(ids).toContain('K-VALID-1')
  })
})

// ── Degraded mode (AC 15, 16) ───────────────────────────────────────────────

describe('retrieveCandidates — degraded (keyword-only) mode (AC 15, 16)', () => {
  it('AC 15: a rejecting embed degrades to keyword-only, never throws, every cosine === 0', async () => {
    const m = market({
      question: 'Will it rain in Miami on March 21?',
      searchText: 'Will it rain in Miami on March 21? Miami Weather weather',
      liquidityUsd: 5_000,
    })
    const vectorTopKSpy = vi.fn().mockResolvedValue([])
    const deps: RetrieveDeps = {
      embed: async () => {
        throw new Error('NIM down')
      },
      keywordPool: async () => [m],
      vectorTopK: vectorTopKSpy,
    }

    const result = await retrieveCandidates(
      spec({ riskDescription: 'rain in Miami' }),
      'rain in Miami',
      deps
    )

    expect(result.length).toBeGreaterThan(0)
    expect(result.every(c => c.cosine === 0)).toBe(true)
    // The pgvector cosine query is skipped entirely in degraded mode.
    expect(vectorTopKSpy).not.toHaveBeenCalled()
  })

  it('AC 16: the degraded path still excludes closed and below-floor markets', async () => {
    const closed = market({ externalId: 'CLOSED-1', status: 'closed' })
    const belowFloor = market({
      externalId: 'LOW-LIQ',
      liquidityUsd: LIQUIDITY_FLOOR_USD - 1,
    })
    const open = market({ externalId: 'OPEN-OK', liquidityUsd: 5_000 })
    const deps: RetrieveDeps = {
      embed: async () => {
        throw new Error('NIM down')
      },
      keywordPool: async () => [closed, belowFloor, open],
    }

    const result = await retrieveCandidates(spec(), 'x', deps)

    const ids = result.map(c => c.market.externalId)
    expect(ids).not.toContain('CLOSED-1')
    expect(ids).not.toContain('LOW-LIQ')
    expect(ids).toContain('OPEN-OK')
  })
})

// ── Postgres failure propagates (distinct from AC 15's embed-only catch) ───

describe('retrieveCandidates — Postgres failures propagate (not swallowed)', () => {
  it('a throwing vectorTopK (embed succeeds) rejects retrieveCandidates', async () => {
    const deps: RetrieveDeps = {
      embed: embedOk,
      vectorTopK: async () => {
        throw new Error('db down')
      },
    }

    await expect(retrieveCandidates(spec(), 'x', deps)).rejects.toThrow(
      'db down'
    )
  })

  it('a throwing keywordPool in degraded mode (embed rejects) also rejects retrieveCandidates', async () => {
    const deps: RetrieveDeps = {
      embed: async () => {
        throw new Error('NIM down')
      },
      keywordPool: async () => {
        throw new Error('db down')
      },
    }

    await expect(retrieveCandidates(spec(), 'x', deps)).rejects.toThrow(
      'db down'
    )
  })
})
