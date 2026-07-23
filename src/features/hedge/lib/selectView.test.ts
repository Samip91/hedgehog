import { describe, expect, it } from 'vitest'
import type { ApiResponse } from '@/shared/schemas'
import type { HedgeSpec } from '@/shared/schemas'
import type { HedgeMatch, HedgeProposal } from '@/shared/proposal'
import { NETWORK_ERROR_MESSAGE, selectView } from './selectView'

/**
 * Unit tests for the pure `selectView` state selector — the single source of
 * truth for AC 1 ("exactly one render state, isPending beats stale data") and
 * the branch-selection ACs 18–21 (no-hedge / sized / unsized / amber / red).
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
    stakeUsd: 300,
    shares: 750,
    payoutIfWin: 750,
    netIfBadOutcome: -50,
    netIfGoodOutcome: -300,
    coverageRatio: 1.5,
    coveragePct: 150,
    ...overrides,
  }
}

function proposal(overrides: Partial<HedgeProposal> = {}): HedgeProposal {
  return {
    spec: spec(),
    best: match(),
    alternatives: [],
    ...overrides,
  }
}

function okResponse(data: HedgeProposal): ApiResponse<HedgeProposal> {
  return { ok: true, data }
}

describe('selectView — loading beats stale data/error (AC 1)', () => {
  it('isPending:true with no data/error → loading', () => {
    expect(
      selectView({ isPending: true, data: undefined, error: null })
    ).toEqual({ kind: 'loading' })
  })

  it('isPending:true with stale ok data present → loading, not sized', () => {
    const view = selectView({
      isPending: true,
      data: okResponse(proposal()),
      error: null,
    })
    expect(view).toEqual({ kind: 'loading' })
  })

  it('isPending:true with a stale error present → loading, not error', () => {
    const view = selectView({
      isPending: true,
      data: undefined,
      error: new Error('previous failure'),
    })
    expect(view).toEqual({ kind: 'loading' })
  })
})

describe('selectView — idle (AC 1)', () => {
  it('not pending, no data, no error → idle', () => {
    expect(
      selectView({ isPending: false, data: undefined, error: null })
    ).toEqual({ kind: 'idle' })
  })
})

describe('selectView — error (AC 20, 21)', () => {
  it('a mutation error (no isPending) → red, network copy', () => {
    const view = selectView({
      isPending: false,
      data: undefined,
      error: new Error('fetch failed'),
    })
    expect(view).toEqual({
      kind: 'error',
      tone: 'red',
      message: NETWORK_ERROR_MESSAGE,
    })
  })

  it('data.ok === false → amber with the server error message', () => {
    const view = selectView({
      isPending: false,
      data: { ok: false, error: { code: 'BAD_INPUT', message: 'Try again.' } },
      error: null,
    })
    expect(view).toEqual({
      kind: 'error',
      tone: 'amber',
      message: 'Try again.',
    })
  })

  it('error takes precedence over a non-ok data payload', () => {
    const view = selectView({
      isPending: false,
      data: { ok: false, error: { code: 'X', message: 'amber msg' } },
      error: new Error('network'),
    })
    expect(view).toEqual({
      kind: 'error',
      tone: 'red',
      message: NETWORK_ERROR_MESSAGE,
    })
  })
})

describe('selectView — no-hedge (AC 18, 19)', () => {
  it('data.ok && best === null → no-hedge, carries spec', () => {
    const s = spec({ riskDescription: 'no market for this' })
    const view = selectView({
      isPending: false,
      data: okResponse({ spec: s, best: null, alternatives: [] }),
      error: null,
    })
    expect(view).toEqual({ kind: 'no-hedge', spec: s })
  })
})

describe('selectView — sized vs unsized (AC 7, 12)', () => {
  it('best.sized === true → kind:"sized" with best + alternatives', () => {
    const s = spec()
    const b = match({ sized: true })
    const alts = [match({ externalId: 'ALT-1' })]
    const view = selectView({
      isPending: false,
      data: okResponse({ spec: s, best: b, alternatives: alts }),
      error: null,
    })
    expect(view).toEqual({
      kind: 'sized',
      spec: s,
      best: b,
      alternatives: alts,
    })
  })

  it('best.sized === false → kind:"unsized" with best + alternatives', () => {
    const s = spec({ exposureUsd: null })
    const b = match({
      sized: false,
      stakeUsd: null,
      shares: null,
      payoutIfWin: null,
      netIfBadOutcome: null,
      netIfGoodOutcome: null,
      coverageRatio: null,
      coveragePct: null,
    })
    const view = selectView({
      isPending: false,
      data: okResponse({ spec: s, best: b, alternatives: [] }),
      error: null,
    })
    expect(view).toEqual({
      kind: 'unsized',
      spec: s,
      best: b,
      alternatives: [],
    })
  })
})
