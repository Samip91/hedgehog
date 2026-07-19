/** Normalized market shape shared by all providers — spec §5.1. */
export interface NormalizedMarket {
  readonly provider: 'kalshi' | 'polymarket'
  readonly externalId: string
  readonly question: string
  readonly eventTitle?: string
  /** question + eventTitle + category → embedded. */
  readonly searchText: string
  readonly category?: string
  /** 0–1 */
  readonly yesPrice: number
  readonly noPrice: number
  readonly volumeUsd?: number
  readonly liquidityUsd?: number
  readonly closeTime?: Date
  readonly status: 'open' | 'closed' | 'resolved'
  readonly resolvedYes?: boolean
  /** Deep link to the live market. */
  readonly url: string
}

export interface FetchOpts {
  readonly limit?: number
}

export interface MarketProvider {
  readonly name: string
  fetchOpenMarkets(opts?: FetchOpts): Promise<NormalizedMarket[]>
  fetchMarket(externalId: string): Promise<NormalizedMarket>
}
