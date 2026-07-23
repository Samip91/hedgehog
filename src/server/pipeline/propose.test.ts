import { describe, expect, it } from 'vitest'
import { buildNormalizedMarket } from '@/server/providers/normalize'
import type { NormalizedMarket } from '@/server/providers/types'
import type { HedgeSpec } from '@/shared/schemas'
import { computeHedge, suggestedStake } from '@/shared/hedgeMath'
import { HedgeProposalSchema } from '@/shared/proposal'
import { buildProposal } from './propose'
import type { RankedMatch } from './rank'

/**
 * Unit tests for pure Stage 4 `buildProposal` (spec
 * `docs/features/propose-hedge/spec.md` AC 2,3,4,5,6,8,11,12). Zero mocks in
 * this file — `buildProposal` is pure (no network/DB), so fixtures are built
 * entirely in memory. That absence of any `vi.mock` is itself the AC 11
 * purity check. Fixture style mirrors `rank.test.ts`'s
 * `buildNormalizedMarket` + `RankedMatch` literals.
 */

// ── Fixture builders ────────────────────────────────────────────────────────

interface MatchOverrides {
  provider?: NormalizedMarket['provider']
  externalId?: string
  question?: string
  yesPrice?: number
  noPrice?: number
  liquidityUsd?: number
  status?: NormalizedMarket['status']
  side?: 'YES' | 'NO'
  relevance?: 'high' | 'partial' | 'weak'
  reasoning?: string
}

function market(overrides: MatchOverrides = {}): NormalizedMarket {
  const externalId = overrides.externalId ?? 'K-TEST'
  return buildNormalizedMarket(
    {
      provider: overrides.provider ?? 'kalshi',
      externalId,
      question: overrides.question ?? 'Will it rain in Miami on March 21?',
      searchText: overrides.question ?? 'Will it rain in Miami on March 21?',
      yesPrice: overrides.yesPrice ?? 0.4,
      noPrice: overrides.noPrice ?? 0.6,
      status: overrides.status ?? 'open',
      url: `https://kalshi.com/markets/${externalId}`,
    },
    { liquidityUsd: overrides.liquidityUsd }
  )
}

function rankedMatch(overrides: MatchOverrides = {}): RankedMatch {
  return {
    candidate: { market: market(overrides), cosine: 0, keyword: 0, score: 0 },
    side: overrides.side ?? 'YES',
    relevance: overrides.relevance ?? 'high',
    reasoning: overrides.reasoning ?? 'This hedges the risk.',
  }
}

function spec(overrides: Partial<HedgeSpec> = {}): HedgeSpec {
  return {
    riskDescription:
      'Financial loss from rain disrupting an outdoor beach wedding',
    domain: 'weather',
    direction: 'happens',
    exposureUsd: 500,
    deadline: '2026-03-21',
    location: 'Miami',
    asset: null,
    threshold: null,
    confidence: 'high',
    clarificationNeeded: null,
    ...overrides,
  }
}

// ── AC 2 — side-price selection ─────────────────────────────────────────────
describe('buildProposal — side-price selection (AC 2)', () => {
  it('a YES-side match uses market.yesPrice as the chosen price', async () => {
    const match = rankedMatch({ side: 'YES', yesPrice: 0.35, noPrice: 0.65 })

    const result = await buildProposal(spec(), [match])

    expect(result.best?.price).toBe(0.35)
  })

  it('a NO-side match uses market.noPrice as the chosen price', async () => {
    const match = rankedMatch({ side: 'NO', yesPrice: 0.35, noPrice: 0.65 })

    const result = await buildProposal(spec(), [match])

    expect(result.best?.price).toBe(0.65)
  })
})

// ── AC 3 — sized case ────────────────────────────────────────────────────────
describe('buildProposal — sized case, exposureUsd positive (AC 3)', () => {
  it('stakeUsd matches suggestedStake and the 6 computeHedge fields match computeHedge, all finite', async () => {
    const s = spec({ exposureUsd: 500 })
    const price = 0.3
    const liquidityUsd = 100_000
    const match = rankedMatch({
      side: 'YES',
      yesPrice: price,
      noPrice: 1 - price,
      liquidityUsd,
    })

    const result = await buildProposal(s, [match])
    const best = result.best
    expect(best).not.toBeNull()
    if (best === null) throw new Error('expected a best match')

    const expectedStake = suggestedStake(500, price, liquidityUsd)
    expect(best.stakeUsd).toBe(expectedStake)

    const expected = computeHedge({
      stakeUsd: expectedStake,
      price,
      exposureUsd: 500,
    })
    expect(best.shares).toBe(expected.shares)
    expect(best.payoutIfWin).toBe(expected.payoutIfWin)
    expect(best.netIfBadOutcome).toBe(expected.netIfBadOutcome)
    expect(best.netIfGoodOutcome).toBe(expected.netIfGoodOutcome)
    expect(best.coverageRatio).toBe(expected.coverageRatio)
    expect(best.coveragePct).toBe(expected.coveragePct)

    expect(best.sized).toBe(true)
    for (const v of [
      best.stakeUsd,
      best.shares,
      best.payoutIfWin,
      best.netIfBadOutcome,
      best.netIfGoodOutcome,
      best.coverageRatio,
      best.coveragePct,
    ]) {
      expect(Number.isFinite(v)).toBe(true)
    }
  })
})

// ── AC 4 — unsized case ──────────────────────────────────────────────────────
describe('buildProposal — unsized case, exposureUsd null (AC 4)', () => {
  it('all 7 payoff fields are null, sized:false, but price is still present and in (0,1)', async () => {
    const s = spec({ exposureUsd: null })
    const match = rankedMatch({ side: 'YES', yesPrice: 0.42, noPrice: 0.58 })

    const result = await buildProposal(s, [match])
    const best = result.best
    expect(best).not.toBeNull()
    if (best === null) throw new Error('expected a best match')

    expect(best.sized).toBe(false)
    expect(best.stakeUsd).toBeNull()
    expect(best.shares).toBeNull()
    expect(best.payoutIfWin).toBeNull()
    expect(best.netIfBadOutcome).toBeNull()
    expect(best.netIfGoodOutcome).toBeNull()
    expect(best.coverageRatio).toBeNull()
    expect(best.coveragePct).toBeNull()

    expect(best.price).toBe(0.42)
    expect(best.price).toBeGreaterThan(0)
    expect(best.price).toBeLessThan(1)
  })
})

// ── AC 12 — liquidity cap ────────────────────────────────────────────────────
describe('buildProposal — liquidity cap applied (AC 12)', () => {
  it('caps stakeUsd at market.liquidityUsd when the uncapped suggestedStake would exceed it', async () => {
    const price = 0.3
    const s = spec({ exposureUsd: 10_000 })
    const uncapped = suggestedStake(10_000, price) // no cap
    const liquidityUsd = uncapped / 2 // deliberately below the uncapped stake
    const match = rankedMatch({
      side: 'YES',
      yesPrice: price,
      noPrice: 1 - price,
      liquidityUsd,
    })

    const result = await buildProposal(s, [match])

    expect(result.best?.stakeUsd).toBe(liquidityUsd)
    expect(result.best?.stakeUsd).toBeLessThan(uncapped)
  })
})

// ── AC 6 — best/alternatives ordering, capped at 2 ──────────────────────────
describe('buildProposal — best/alternatives ordering preserved, capped at 2 (AC 6)', () => {
  it('best = first RankedMatch; alternatives = the next 2 in order; a 4th match is dropped', async () => {
    const matches = [
      rankedMatch({ externalId: 'M-1', question: 'market one' }),
      rankedMatch({ externalId: 'M-2', question: 'market two' }),
      rankedMatch({ externalId: 'M-3', question: 'market three' }),
      rankedMatch({ externalId: 'M-4', question: 'market four' }),
    ]

    const result = await buildProposal(spec(), matches)

    expect(result.best?.externalId).toBe('M-1')
    expect(result.alternatives.map(m => m.externalId)).toEqual(['M-2', 'M-3'])
    expect(result.alternatives).toHaveLength(2)
  })
})

// ── AC 5 — empty matches ─────────────────────────────────────────────────────
describe('buildProposal — empty matches input (AC 5)', () => {
  it('buildProposal(spec, []) returns {best:null, alternatives:[]}', async () => {
    const s = spec()

    const result = await buildProposal(s, [])

    expect(result).toEqual({ spec: s, best: null, alternatives: [] })
  })
})

// ── AC 8 — invalid price dropped ────────────────────────────────────────────
describe('buildProposal — out-of-range side-price is dropped, not nulled (AC 8)', () => {
  it('drops a match whose chosen side-price is 0', async () => {
    const match = rankedMatch({ side: 'YES', yesPrice: 0, noPrice: 0.5 })

    const result = await buildProposal(spec(), [match])

    expect(result).toEqual({ spec: spec(), best: null, alternatives: [] })
  })

  it('drops a match whose chosen side-price is 1', async () => {
    const match = rankedMatch({ side: 'NO', yesPrice: 0.5, noPrice: 1 })

    const result = await buildProposal(spec(), [match])

    expect(result.best).toBeNull()
    expect(result.alternatives).toEqual([])
  })

  it('drops a match whose chosen side-price is NaN', async () => {
    const match = rankedMatch({ side: 'YES', yesPrice: NaN, noPrice: 0.5 })

    const result = await buildProposal(spec(), [match])

    expect(result.best).toBeNull()
    expect(result.alternatives).toEqual([])
  })

  it('a mix of one valid + one invalid match → only the valid one survives as best', async () => {
    const invalid = rankedMatch({
      externalId: 'BAD',
      side: 'YES',
      yesPrice: 0,
      noPrice: 0.5,
    })
    const valid = rankedMatch({
      externalId: 'GOOD',
      side: 'YES',
      yesPrice: 0.5,
      noPrice: 0.5,
    })

    const result = await buildProposal(spec(), [invalid, valid])

    expect(result.best?.externalId).toBe('GOOD')
    expect(result.alternatives).toEqual([])
  })

  it('all matches invalid → {best:null, alternatives:[]}', async () => {
    const matches = [
      rankedMatch({ externalId: 'A', side: 'YES', yesPrice: 0 }),
      rankedMatch({ externalId: 'B', side: 'NO', noPrice: 1 }),
      rankedMatch({ externalId: 'C', side: 'YES', yesPrice: NaN }),
    ]

    const result = await buildProposal(spec(), matches)

    expect(result).toEqual({ spec: spec(), best: null, alternatives: [] })
  })
})

// ── AC 11 — purity + response-schema validity ───────────────────────────────
describe('buildProposal — purity (no mocks in this file) + schema validity (AC 11)', () => {
  it('a sized result validates against HedgeProposalSchema', async () => {
    const s = spec({ exposureUsd: 500 })
    const match = rankedMatch({
      side: 'YES',
      yesPrice: 0.4,
      noPrice: 0.6,
      liquidityUsd: 5000,
    })

    const result = await buildProposal(s, [match])

    expect(HedgeProposalSchema.safeParse(result).success).toBe(true)
  })

  it('an unsized result validates against HedgeProposalSchema', async () => {
    const s = spec({ exposureUsd: null })
    const match = rankedMatch({ side: 'YES', yesPrice: 0.4, noPrice: 0.6 })

    const result = await buildProposal(s, [match])

    expect(HedgeProposalSchema.safeParse(result).success).toBe(true)
  })
})
