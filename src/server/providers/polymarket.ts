import type { FetchOpts, MarketProvider, NormalizedMarket } from './types'

/**
 * Polymarket market-data client (no auth required for market data) — spec §5.3.
 *
 * TODO(feature: providers-day1):
 *  - GET https://gamma-api.polymarket.com/markets?active=true&closed=false
 *      &limit=200&order=volume&ascending=false
 *  - `outcomePrices` / `outcomes` are JSON-encoded strings inside JSON — parse
 *    defensively.
 *  - Skip non-binary markets (increment a counter/log).
 *  - Prices already 0–1.
 */
export const polymarketProvider: MarketProvider = {
  name: 'polymarket',

  async fetchOpenMarkets(_opts?: FetchOpts): Promise<NormalizedMarket[]> {
    throw new Error(
      'polymarket.fetchOpenMarkets: not implemented (providers-day1)'
    )
  },

  async fetchMarket(_externalId: string): Promise<NormalizedMarket> {
    throw new Error('polymarket.fetchMarket: not implemented (providers-day1)')
  },
}
