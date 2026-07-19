import { describe, expect, it } from 'vitest'
import { computeHedge, suggestedStake } from './hedgeMath'

describe('computeHedge', () => {
  it('computes the worked example: $120 stake of NO at 24¢, $500 exposure', () => {
    const r = computeHedge({ stakeUsd: 120, price: 0.24, exposureUsd: 500 })
    expect(r.shares).toBeCloseTo(500, 6)
    expect(r.payoutIfWin).toBeCloseTo(500, 6)
    // 500 payout − 120 stake − 500 exposure = -120 (net cost of the stake)
    expect(r.netIfBadOutcome).toBeCloseTo(-120, 6)
    expect(r.netIfGoodOutcome).toBeCloseTo(-120, 6)
    expect(r.coverageRatio).toBeCloseTo(1, 6)
    expect(r.coveragePct).toBeCloseTo(100, 6)
  })

  it('shares = stake / price', () => {
    expect(computeHedge({ stakeUsd: 50, price: 0.25, exposureUsd: 100 }).shares).toBe(200)
  })

  it('good outcome always loses exactly the stake', () => {
    const r = computeHedge({ stakeUsd: 37.5, price: 0.5, exposureUsd: 1000 })
    expect(r.netIfGoodOutcome).toBe(-37.5)
  })

  it('a cheap side (low price) can over-cover exposure', () => {
    const r = computeHedge({ stakeUsd: 100, price: 0.1, exposureUsd: 500 })
    expect(r.payoutIfWin).toBeCloseTo(1000, 6) // 100 / 0.1
    expect(r.coverageRatio).toBeCloseTo(2, 6)
    expect(r.netIfBadOutcome).toBeCloseTo(1000 - 100 - 500, 6) // +400
  })

  it('coverage is 0 (not Infinity) when there is no exposure', () => {
    const r = computeHedge({ stakeUsd: 10, price: 0.3, exposureUsd: 0 })
    expect(r.coverageRatio).toBe(0)
    expect(r.coveragePct).toBe(0)
  })

  it('accepts a zero stake', () => {
    const r = computeHedge({ stakeUsd: 0, price: 0.4, exposureUsd: 200 })
    expect(r.shares).toBe(0)
    expect(r.payoutIfWin).toBe(0)
    expect(r.netIfBadOutcome).toBe(-200)
  })

  it.each([0, 1, -0.1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects out-of-range price %p',
    price => {
      expect(() => computeHedge({ stakeUsd: 10, price, exposureUsd: 100 })).toThrow(
        RangeError
      )
    }
  )

  it('rejects negative stake and exposure', () => {
    expect(() => computeHedge({ stakeUsd: -1, price: 0.5, exposureUsd: 10 })).toThrow(
      RangeError
    )
    expect(() => computeHedge({ stakeUsd: 1, price: 0.5, exposureUsd: -10 })).toThrow(
      RangeError
    )
  })
})

describe('suggestedStake', () => {
  it('sizes a stake that fully offsets the exposure', () => {
    // stake = 500 * 0.24 / (1 - 0.24) = 157.894...
    const stake = suggestedStake(500, 0.24)
    expect(stake).toBeCloseTo(157.8947, 3)

    // and feeding it back yields coverage that offsets the loss net of stake
    const r = computeHedge({ stakeUsd: stake, price: 0.24, exposureUsd: 500 })
    expect(r.payoutIfWin - stake).toBeCloseTo(500, 4)
    expect(r.netIfBadOutcome).toBeCloseTo(0, 4)
  })

  it('honors a liquidity cap', () => {
    expect(suggestedStake(500, 0.24, 50)).toBe(50)
    expect(suggestedStake(500, 0.24, 10_000)).toBeCloseTo(157.8947, 3)
  })

  it('is 0 when there is no exposure', () => {
    expect(suggestedStake(0, 0.3)).toBe(0)
  })

  it('rejects invalid price', () => {
    expect(() => suggestedStake(100, 1)).toThrow(RangeError)
  })
})
