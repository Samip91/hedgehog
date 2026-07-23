import { describe, expect, it } from 'vitest'
import { computeHedge } from '@/shared/hedgeMath'
import {
  clampStake,
  payoffToChartData,
  sliderBounds,
  stakeToPayoff,
} from './payoff'

/**
 * AC 8: `stakeToPayoff` must deep-equal `computeHedge` (the real oracle,
 * imported — never hardcoded) across a stake sweep including `s = 0`. Also
 * covers `sliderBounds`/`clampStake` (AC 9) and `payoffToChartData` (design Q2/A).
 */

describe('stakeToPayoff — delegates to computeHedge, sweep incl. 0 (AC 8)', () => {
  const price = 0.24
  const exposureUsd = 500

  it.each([0, 1, 50, 120.5, 999])(
    'stakeUsd=%s matches computeHedge exactly',
    stakeUsd => {
      const expected = computeHedge({ stakeUsd, price, exposureUsd })
      expect(stakeToPayoff(stakeUsd, price, exposureUsd)).toEqual(expected)
    }
  )

  it('sweeps a dense range of stakes and prices, always matching computeHedge', () => {
    const prices = [0.05, 0.24, 0.5, 0.75, 0.95]
    const stakes = [0, 0.01, 10, 100, 1000, 5000]
    for (const p of prices) {
      for (const s of stakes) {
        const expected = computeHedge({ stakeUsd: s, price: p, exposureUsd })
        expect(stakeToPayoff(s, p, exposureUsd)).toEqual(expected)
      }
    }
  })

  it('exposureUsd = 0 (no exposure) still matches computeHedge, including stakeUsd = 0', () => {
    const expected = computeHedge({ stakeUsd: 0, price, exposureUsd: 0 })
    expect(stakeToPayoff(0, price, 0)).toEqual(expected)
  })
})

describe('sliderBounds (AC 9)', () => {
  it('seed = 0 → {min:0, max:1, step:1}', () => {
    expect(sliderBounds(0)).toEqual({ min: 0, max: 1, step: 1 })
  })

  it('a normal seed → max = ceil(seed*2), min = 0, step >= 1', () => {
    const bounds = sliderBounds(300)
    expect(bounds.min).toBe(0)
    expect(bounds.max).toBe(600)
    expect(bounds.step).toBeGreaterThanOrEqual(1)
  })

  it('a large seed → max scales with seed, step still >= 1 and roughly 1/100th of max', () => {
    const bounds = sliderBounds(100_000)
    expect(bounds.max).toBe(200_000)
    expect(bounds.step).toBeGreaterThanOrEqual(1)
    expect(bounds.step).toBe(Math.round(bounds.max / 100))
  })

  it('a fractional seed rounds max up (ceil)', () => {
    const bounds = sliderBounds(10.2)
    expect(bounds.max).toBe(Math.ceil(10.2 * 2))
  })
})

describe('clampStake', () => {
  const bounds = sliderBounds(300) // {min:0, max:600, step:6}

  it('clamps a value below min up to min', () => {
    expect(clampStake(-50, bounds)).toBe(bounds.min)
  })

  it('clamps a value above max down to max', () => {
    expect(clampStake(10_000, bounds)).toBe(bounds.max)
  })

  it('passes through a value already inside the range', () => {
    expect(clampStake(300, bounds)).toBe(300)
  })
})

describe('payoffToChartData', () => {
  it('returns the 2-entry shape with the correct net values', () => {
    const result = computeHedge({ stakeUsd: 120, price: 0.4, exposureUsd: 500 })
    const chart = payoffToChartData(result)

    expect(chart).toHaveLength(2)
    expect(chart).toEqual([
      { label: 'If it happens', net: result.netIfBadOutcome },
      { label: "If it doesn't", net: result.netIfGoodOutcome },
    ])
  })
})
