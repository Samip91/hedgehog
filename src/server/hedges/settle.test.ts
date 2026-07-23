import { describe, expect, it } from 'vitest'
import { settle, type SettleInput } from './settle'

/**
 * `settle()` unit tests — spec `docs/features/saved-hedges/spec.md` ACs
 * 15–20. Pure, fixture-driven, no DB/network: every branch (null snapshot,
 * `RESOLVED` matching/opposite side, `RESOLVED` with `resolvedYes===null`,
 * `CLOSED`, `OPEN` both sides, `OPEN` with a null side-price) plus the
 * "never throws" guarantee.
 */

function input(overrides: Partial<SettleInput> = {}): SettleInput {
  return {
    side: 'YES',
    stakeUsd: 100,
    shares: 250,
    snapshot: null,
    ...overrides,
  }
}

describe('settle — null snapshot (AC 15)', () => {
  it('returns OPEN/null/null and never throws', () => {
    const result = settle(input({ snapshot: null }))
    expect(result).toEqual({
      status: 'OPEN',
      currentPrice: null,
      simulatedPnlUsd: null,
    })
  })

  it('OPEN/null/null regardless of side/stake/shares', () => {
    const result = settle(
      input({ side: 'NO', stakeUsd: 999, shares: 12.5, snapshot: null })
    )
    expect(result).toEqual({
      status: 'OPEN',
      currentPrice: null,
      simulatedPnlUsd: null,
    })
  })
})

describe('settle — RESOLVED, outcome matches saved side (AC 16)', () => {
  it('resolvedYes: true, side: YES → RESOLVED_WIN, pnl = shares*1 - stakeUsd', () => {
    const result = settle(
      input({
        side: 'YES',
        stakeUsd: 100,
        shares: 250,
        snapshot: {
          status: 'RESOLVED',
          resolvedYes: true,
          yesPrice: 1,
          noPrice: 0,
        },
      })
    )
    expect(result).toEqual({
      status: 'RESOLVED_WIN',
      currentPrice: null,
      simulatedPnlUsd: 150, // 250*1 - 100
    })
  })

  it('resolvedYes: false, side: NO → RESOLVED_WIN, pnl = shares*1 - stakeUsd', () => {
    const result = settle(
      input({
        side: 'NO',
        stakeUsd: 40,
        shares: 100,
        snapshot: {
          status: 'RESOLVED',
          resolvedYes: false,
          yesPrice: 0,
          noPrice: 1,
        },
      })
    )
    expect(result).toEqual({
      status: 'RESOLVED_WIN',
      currentPrice: null,
      simulatedPnlUsd: 60, // 100*1 - 40
    })
  })
})

describe('settle — RESOLVED, outcome opposite the saved side (AC 17)', () => {
  it('resolvedYes: true, side: NO → RESOLVED_LOSS, pnl = -stakeUsd', () => {
    const result = settle(
      input({
        side: 'NO',
        stakeUsd: 75,
        shares: 187.5,
        snapshot: {
          status: 'RESOLVED',
          resolvedYes: true,
          yesPrice: 1,
          noPrice: 0,
        },
      })
    )
    expect(result).toEqual({
      status: 'RESOLVED_LOSS',
      currentPrice: null,
      simulatedPnlUsd: -75,
    })
  })

  it('resolvedYes: false, side: YES → RESOLVED_LOSS, pnl = -stakeUsd', () => {
    const result = settle(
      input({
        side: 'YES',
        stakeUsd: 20,
        shares: 50,
        snapshot: {
          status: 'RESOLVED',
          resolvedYes: false,
          yesPrice: 0,
          noPrice: 1,
        },
      })
    )
    expect(result).toEqual({
      status: 'RESOLVED_LOSS',
      currentPrice: null,
      simulatedPnlUsd: -20,
    })
  })
})

describe('settle — RESOLVED with resolvedYes===null → MARKET_CLOSED (edge, plan Q1)', () => {
  it('never throws, and no pre-resolution P&L leaks out', () => {
    const result = settle(
      input({
        snapshot: {
          status: 'RESOLVED',
          resolvedYes: null,
          yesPrice: 0.4,
          noPrice: 0.6,
        },
      })
    )
    expect(result).toEqual({
      status: 'MARKET_CLOSED',
      currentPrice: null,
      simulatedPnlUsd: null,
    })
  })
})

describe('settle — CLOSED, resolvedYes still null (AC 18)', () => {
  it('returns MARKET_CLOSED/null/null', () => {
    const result = settle(
      input({
        snapshot: {
          status: 'CLOSED',
          resolvedYes: null,
          yesPrice: 0.4,
          noPrice: 0.6,
        },
      })
    )
    expect(result).toEqual({
      status: 'MARKET_CLOSED',
      currentPrice: null,
      simulatedPnlUsd: null,
    })
  })

  it('CLOSED wins over any stray resolvedYes value (never treated as RESOLVED)', () => {
    const result = settle(
      input({
        snapshot: {
          status: 'CLOSED',
          resolvedYes: true,
          yesPrice: 0.9,
          noPrice: 0.1,
        },
      })
    )
    expect(result.status).toBe('MARKET_CLOSED')
    expect(result.currentPrice).toBeNull()
    expect(result.simulatedPnlUsd).toBeNull()
  })
})

describe('settle — OPEN, mark-to-market off the saved side price (AC 19)', () => {
  it('side: YES → currentPrice = yesPrice, pnl = shares*yesPrice - stakeUsd', () => {
    const result = settle(
      input({
        side: 'YES',
        stakeUsd: 100,
        shares: 250,
        snapshot: {
          status: 'OPEN',
          resolvedYes: null,
          yesPrice: 0.5,
          noPrice: 0.5,
        },
      })
    )
    expect(result).toEqual({
      status: 'OPEN',
      currentPrice: 0.5,
      simulatedPnlUsd: 25, // 250*0.5 - 100
    })
  })

  it('side: NO → currentPrice = noPrice, pnl = shares*noPrice - stakeUsd', () => {
    const result = settle(
      input({
        side: 'NO',
        stakeUsd: 60,
        shares: 100,
        snapshot: {
          status: 'OPEN',
          resolvedYes: null,
          yesPrice: 0.4,
          noPrice: 0.6,
        },
      })
    )
    expect(result).toEqual({
      status: 'OPEN',
      currentPrice: 0.6,
      simulatedPnlUsd: 0, // 100*0.6 - 60
    })
  })
})

describe('settle — OPEN with a null side-price falls back to OPEN/null, no NaN (AC 19, 20)', () => {
  it('side: YES, yesPrice: null → OPEN/null/null (never NaN)', () => {
    const result = settle(
      input({
        side: 'YES',
        snapshot: {
          status: 'OPEN',
          resolvedYes: null,
          yesPrice: null,
          noPrice: 0.6,
        },
      })
    )
    expect(result).toEqual({
      status: 'OPEN',
      currentPrice: null,
      simulatedPnlUsd: null,
    })
    expect(result.simulatedPnlUsd).not.toBeNaN()
  })

  it('side: NO, noPrice: null → OPEN/null/null (never NaN)', () => {
    const result = settle(
      input({
        side: 'NO',
        snapshot: {
          status: 'OPEN',
          resolvedYes: null,
          yesPrice: 0.4,
          noPrice: null,
        },
      })
    )
    expect(result).toEqual({
      status: 'OPEN',
      currentPrice: null,
      simulatedPnlUsd: null,
    })
  })
})

describe('settle — pure, never throws (AC 20)', () => {
  const fixtures: SettleInput[] = [
    input({ snapshot: null }),
    input({
      snapshot: {
        status: 'RESOLVED',
        resolvedYes: true,
        yesPrice: 1,
        noPrice: 0,
      },
    }),
    input({
      snapshot: {
        status: 'RESOLVED',
        resolvedYes: false,
        yesPrice: 0,
        noPrice: 1,
      },
    }),
    input({
      snapshot: {
        status: 'RESOLVED',
        resolvedYes: null,
        yesPrice: 0.4,
        noPrice: 0.6,
      },
    }),
    input({
      snapshot: {
        status: 'CLOSED',
        resolvedYes: null,
        yesPrice: null,
        noPrice: null,
      },
    }),
    input({
      snapshot: {
        status: 'OPEN',
        resolvedYes: null,
        yesPrice: 0.5,
        noPrice: 0.5,
      },
    }),
    input({
      side: 'NO',
      snapshot: {
        status: 'OPEN',
        resolvedYes: null,
        yesPrice: null,
        noPrice: null,
      },
    }),
    input({ stakeUsd: 0, shares: 0 }),
  ]

  it.each(fixtures.map((f, i) => [i, f] as const))(
    'fixture %i never throws and always returns a well-formed SettleResult',
    (_i, fixture) => {
      let result: ReturnType<typeof settle> | undefined
      expect(() => {
        result = settle(fixture)
      }).not.toThrow()
      expect(result).toBeDefined()
      expect([
        'OPEN',
        'MARKET_CLOSED',
        'RESOLVED_WIN',
        'RESOLVED_LOSS',
      ]).toContain(result?.status)
    }
  )
})
