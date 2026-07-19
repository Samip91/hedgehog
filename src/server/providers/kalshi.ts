import type { FetchOpts, MarketProvider, NormalizedMarket } from './types'

/**
 * Kalshi market-data client (no auth required for market data) — spec §5.2.
 *
 * TODO(feature: providers-day1):
 *  - GET https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=200
 *    (cursor-paginated, 3–5 pages).
 *  - Prices arrive in cents (1–99) → divide by 100; use yes_bid/yes_ask midpoint,
 *    fall back to last_price.
 *  - searchText = eventTitle + " — " + title + subtitle (titles are ambiguous
 *    without their parent event).
 *  - Zod-validate the payload; throw SchemaMismatchError on drift.
 */
export const kalshiProvider: MarketProvider = {
  name: 'kalshi',

  async fetchOpenMarkets(_opts?: FetchOpts): Promise<NormalizedMarket[]> {
    throw new Error('kalshi.fetchOpenMarkets: not implemented (providers-day1)')
  },

  async fetchMarket(_externalId: string): Promise<NormalizedMarket> {
    throw new Error('kalshi.fetchMarket: not implemented (providers-day1)')
  },
}
