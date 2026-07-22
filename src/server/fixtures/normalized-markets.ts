/**
 * Small `NormalizedMarket[]` fixture set for `sync.test.ts` — hand-built
 * (not derived from the raw provider JSON fixtures) so tests can freely
 * clone + mutate a single market's `question`/`searchText` across runs
 * (spec AC 10/12) without perturbing the others.
 */
import type { NormalizedMarket } from '@/server/providers/types'

export const kalshiMarkets: NormalizedMarket[] = [
  {
    provider: 'kalshi',
    externalId: 'K-RAIN-MIA',
    question: 'Will it rain in Miami on March 21?',
    eventTitle: 'Miami Weather',
    searchText: 'Will it rain in Miami on March 21? Miami Weather weather',
    category: 'weather',
    yesPrice: 0.24,
    noPrice: 0.76,
    volumeUsd: 1200,
    liquidityUsd: 8000,
    closeTime: new Date('2026-03-21T00:00:00Z'),
    status: 'open',
    url: 'https://kalshi.com/markets/K-RAIN-MIA',
  },
  {
    provider: 'kalshi',
    externalId: 'K-BTC-60K',
    question: 'Will BTC be below $60k at close?',
    searchText: 'Will BTC be below $60k at close? crypto',
    category: 'crypto',
    yesPrice: 0.31,
    noPrice: 0.69,
    volumeUsd: 5000,
    status: 'open',
    url: 'https://kalshi.com/markets/K-BTC-60K',
  },
]

export const polymarketMarkets: NormalizedMarket[] = [
  {
    provider: 'polymarket',
    externalId: 'P-FED-CUT',
    question: 'Will the Fed cut rates in Q3?',
    searchText: 'Will the Fed cut rates in Q3? economics',
    category: 'economics',
    yesPrice: 0.55,
    noPrice: 0.45,
    volumeUsd: 30000,
    liquidityUsd: 12000,
    status: 'open',
    url: 'https://polymarket.com/event/P-FED-CUT',
  },
]

/**
 * Malformed row (spec AC 7): `yesPrice`/`noPrice` fall outside the [0,1]
 * probability range the sync-boundary `NormalizedMarketSchema` enforces, so
 * `runSync()` must skip it (counted in `fetched`, absent from `upserted`)
 * without aborting the rest of the run.
 */
export const malformedMarket: NormalizedMarket = {
  provider: 'kalshi',
  externalId: 'K-MALFORMED',
  question: 'Malformed price market',
  searchText: 'Malformed price market',
  yesPrice: 1.5,
  noPrice: -0.5,
  status: 'open',
  url: 'https://kalshi.com/markets/K-MALFORMED',
}

/**
 * All rows fail the sync-boundary schema (round-3 hardening, Finding 1):
 * `rawRows.length > 0 && validRows.length === 0` for this provider — a
 * schema break, not a healthy-but-empty fetch — so `runSync()` must flag the
 * provider degraded and must NOT wipe the last-good hot catalog.
 */
export const allMalformedMarkets: NormalizedMarket[] = [
  { ...malformedMarket, externalId: 'K-BAD-1' },
  { ...malformedMarket, externalId: 'K-BAD-2' },
]

/**
 * Duplicate `(provider, externalId)` within a single fetch (round-3
 * hardening, Finding 2). The second entry has different content so a test
 * can assert dedup keeps the FIRST occurrence, not just drop-and-forget.
 */
const duplicateBaseMarket: NormalizedMarket = {
  provider: 'kalshi',
  externalId: 'K-RAIN-MIA',
  question: 'Will it rain in Miami on March 21?',
  eventTitle: 'Miami Weather',
  searchText: 'Will it rain in Miami on March 21? Miami Weather weather',
  category: 'weather',
  yesPrice: 0.24,
  noPrice: 0.76,
  volumeUsd: 1200,
  liquidityUsd: 8000,
  closeTime: new Date('2026-03-21T00:00:00Z'),
  status: 'open',
  url: 'https://kalshi.com/markets/K-RAIN-MIA',
}

export const duplicateExternalIdMarkets: NormalizedMarket[] = [
  duplicateBaseMarket,
  {
    ...duplicateBaseMarket,
    question: 'duplicate row for the same externalId — must be ignored',
    searchText: 'duplicate row for the same externalId — must be ignored',
  },
]
