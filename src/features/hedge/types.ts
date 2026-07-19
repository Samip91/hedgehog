import type { HedgeSpec } from '@/shared/schemas'

/** Display model for a market match on the Proposal screen (spec §2, screen 2). */
export interface MarketMatchView {
  readonly provider: 'kalshi' | 'polymarket'
  readonly externalId: string
  readonly question: string
  readonly yesPrice: number
  readonly noPrice: number
  readonly liquidityUsd: number | null
  readonly closeTime: string | null
  readonly side: 'YES' | 'NO'
  readonly relevance: 'high' | 'partial' | 'weak'
  readonly reasoning: string
  readonly url: string
}

export interface ProposalView {
  readonly id: string
  readonly prompt: string
  readonly spec: HedgeSpec
  readonly best: MarketMatchView | null
  readonly alternatives: readonly MarketMatchView[]
}
