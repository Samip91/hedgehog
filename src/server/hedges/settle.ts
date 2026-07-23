/**
 * Lazy, on-read settlement (ADR 007; spec ACs 15–19). Pure — no DB/network —
 * so it's exhaustively unit-testable with hand-built fixtures. Operates on
 * plain `number`s; Decimal→number coercion happens one layer up in
 * `savedHedgeToView` (mirrors `retrieve.ts`'s boundary pattern).
 */

export type SettleSide = 'YES' | 'NO'
export type SettleMarketStatus = 'OPEN' | 'CLOSED' | 'RESOLVED'
export type SettleHedgeStatus =
  'OPEN' | 'MARKET_CLOSED' | 'RESOLVED_WIN' | 'RESOLVED_LOSS'

/** The saved hedge's own numbers, plus the joined `MarketSnapshot`'s
 * settlement-relevant fields (or `null` when no snapshot exists yet). */
export interface SettleInput {
  readonly side: SettleSide
  readonly stakeUsd: number
  readonly shares: number
  readonly snapshot: {
    readonly status: SettleMarketStatus
    readonly resolvedYes: boolean | null
    readonly yesPrice: number | null
    readonly noPrice: number | null
  } | null
}

export interface SettleResult {
  readonly status: SettleHedgeStatus
  readonly currentPrice: number | null
  readonly simulatedPnlUsd: number | null
}

const OPEN_NULL: SettleResult = {
  status: 'OPEN',
  currentPrice: null,
  simulatedPnlUsd: null,
}

const MARKET_CLOSED_NULL: SettleResult = {
  status: 'MARKET_CLOSED',
  currentPrice: null,
  simulatedPnlUsd: null,
}

/** Never throws — a missing/malformed snapshot degrades to `OPEN`/`null` or
 * `MARKET_CLOSED`/`null`, never an exception (spec AC 15, AC 20). */
export function settle(input: SettleInput): SettleResult {
  const { side, stakeUsd, shares, snapshot } = input

  if (snapshot === null) return OPEN_NULL

  if (snapshot.status === 'RESOLVED') {
    if (snapshot.resolvedYes === null) return MARKET_CLOSED_NULL
    const winningSide: SettleSide = snapshot.resolvedYes ? 'YES' : 'NO'
    if (winningSide === side) {
      return {
        status: 'RESOLVED_WIN',
        currentPrice: null,
        simulatedPnlUsd: shares * 1 - stakeUsd,
      }
    }
    return {
      status: 'RESOLVED_LOSS',
      currentPrice: null,
      simulatedPnlUsd: -stakeUsd,
    }
  }

  if (snapshot.status === 'CLOSED') return MARKET_CLOSED_NULL

  // OPEN — mark-to-market off the last-synced snapshot price for the saved side.
  const currentPrice = side === 'YES' ? snapshot.yesPrice : snapshot.noPrice
  if (currentPrice === null) return OPEN_NULL

  return {
    status: 'OPEN',
    currentPrice,
    simulatedPnlUsd: shares * currentPrice - stakeUsd,
  }
}
