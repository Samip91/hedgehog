/** Display model for a saved hedge (spec §3, screen 3). */
export interface SavedHedgeView {
  readonly id: string
  readonly prompt: string
  readonly question: string
  readonly side: 'YES' | 'NO'
  readonly entryPrice: number
  readonly currentPrice: number | null
  readonly stakeUsd: number
  readonly simulatedPnlUsd: number | null
  readonly status: 'OPEN' | 'MARKET_CLOSED' | 'RESOLVED_WIN' | 'RESOLVED_LOSS'
}
