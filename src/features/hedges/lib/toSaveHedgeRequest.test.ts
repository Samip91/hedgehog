import { describe, expect, it } from 'vitest'
import type { HedgeMatch } from '@/shared/proposal'
import type { HedgeSpec } from '@/shared/schemas'
import { SaveHedgeRequestSchema } from '@/shared/schemas'
import { toSaveHedgeRequest } from './toSaveHedgeRequest'

/**
 * `toSaveHedgeRequest()` unit tests (spec AC 23; plan.md "Cross-slice
 * boundary"). Pure mapper: uppercases the provider, threads `best.price` →
 * `entryPrice`, passes `prompt`/`spec`/`stakeUsd` through, and Zod-validates
 * before returning — the result must parse against `SaveHedgeRequestSchema`,
 * and a bad input must throw rather than silently POST malformed data.
 */

function spec(overrides: Partial<HedgeSpec> = {}): HedgeSpec {
  return {
    riskDescription: 'Financial loss from rain at an outdoor wedding',
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

function match(overrides: Partial<HedgeMatch> = {}): HedgeMatch {
  return {
    provider: 'kalshi',
    externalId: 'K-TEST',
    question: 'Will it rain in Miami on March 21?',
    url: 'https://kalshi.com/markets/K-TEST',
    closeTime: '2026-03-21T00:00:00Z',
    yesPrice: 0.4,
    noPrice: 0.6,
    liquidityUsd: 10_000,
    side: 'YES',
    relevance: 'high',
    reasoning: 'This hedges the risk.',
    price: 0.4,
    sized: true,
    stakeUsd: 100,
    shares: 250,
    payoutIfWin: 250,
    netIfBadOutcome: -350,
    netIfGoodOutcome: -100,
    coverageRatio: 0.5,
    coveragePct: 50,
    ...overrides,
  }
}

describe('toSaveHedgeRequest — provider casing (AC 23)', () => {
  it('uppercases kalshi → KALSHI', () => {
    const req = toSaveHedgeRequest({
      prompt: 'Will it rain on my wedding?',
      spec: spec(),
      best: match({ provider: 'kalshi' }),
      stakeUsd: 100,
    })
    expect(req.provider).toBe('KALSHI')
  })

  it('uppercases polymarket → POLYMARKET', () => {
    const req = toSaveHedgeRequest({
      prompt: 'Will it rain on my wedding?',
      spec: spec(),
      best: match({ provider: 'polymarket' }),
      stakeUsd: 100,
    })
    expect(req.provider).toBe('POLYMARKET')
  })
})

describe('toSaveHedgeRequest — field mapping', () => {
  it('maps best.price → entryPrice, and passes prompt/spec/stakeUsd through', () => {
    const s = spec()
    const best = match({ price: 0.42, externalId: 'K-1', question: 'Q?' })
    const req = toSaveHedgeRequest({
      prompt: 'my risk prompt',
      spec: s,
      best,
      stakeUsd: 250,
    })

    expect(req.entryPrice).toBe(0.42)
    expect(req.prompt).toBe('my risk prompt')
    expect(req.spec).toEqual(s)
    expect(req.stakeUsd).toBe(250)
    expect(req.externalId).toBe('K-1')
    expect(req.question).toBe('Q?')
    expect(req.side).toBe(best.side)
  })

  it('mints a fresh client-side uuid for id', () => {
    const req1 = toSaveHedgeRequest({
      prompt: 'p',
      spec: spec(),
      best: match(),
      stakeUsd: 10,
    })
    const req2 = toSaveHedgeRequest({
      prompt: 'p',
      spec: spec(),
      best: match(),
      stakeUsd: 10,
    })
    expect(req1.id).not.toBe(req2.id)
    expect(req1.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )
  })
})

describe('toSaveHedgeRequest — Zod-validates before returning', () => {
  it('the result parses against SaveHedgeRequestSchema', () => {
    const req = toSaveHedgeRequest({
      prompt: 'Will it rain on my wedding?',
      spec: spec(),
      best: match(),
      stakeUsd: 100,
    })
    expect(() => SaveHedgeRequestSchema.parse(req)).not.toThrow()
  })

  it('stakeUsd: 0 throws (fails .positive())', () => {
    expect(() =>
      toSaveHedgeRequest({
        prompt: 'Will it rain on my wedding?',
        spec: spec(),
        best: match(),
        stakeUsd: 0,
      })
    ).toThrow()
  })

  it('an empty prompt throws (fails .min(1))', () => {
    expect(() =>
      toSaveHedgeRequest({
        prompt: '',
        spec: spec(),
        best: match(),
        stakeUsd: 100,
      })
    ).toThrow()
  })
})
