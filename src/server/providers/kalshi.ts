import { fetchJson, SchemaMismatchError } from '@/server/http'
import {
  KalshiMarketsResponseSchema,
  KalshiSingleMarketResponseSchema,
  type KalshiMarket,
} from './schemas'
import {
  buildNormalizedMarket,
  buildSearchText,
  centsToProbability,
  payloadPreview,
  round4,
} from './normalize'
import type { FetchOpts, MarketProvider, NormalizedMarket } from './types'

const BASE = 'https://api.elections.kalshi.com/trade-api/v2'
const PAGE_LIMIT = 200
const MAX_PAGES = 5

/** Yes price in cents: bid/ask midpoint, falling back to last_price. */
function yesCents(m: KalshiMarket): number | null {
  if (m.yes_bid !== undefined && m.yes_ask !== undefined) {
    return (m.yes_bid + m.yes_ask) / 2
  }
  return m.last_price ?? null
}

function normalizeOne(m: KalshiMarket): NormalizedMarket | null {
  const cents = yesCents(m)
  if (cents === null) return null
  const yesPrice = round4(centsToProbability(cents))

  return buildNormalizedMarket(
    {
      provider: 'kalshi',
      externalId: m.ticker,
      question: m.title,
      // Kalshi titles are ambiguous without the parent event (spec §5.2).
      searchText: buildSearchText(
        m.event_ticker,
        m.title,
        m.subtitle,
        m.category
      ),
      yesPrice,
      noPrice: round4(1 - yesPrice),
      status: 'open',
      url: `https://kalshi.com/markets/${m.ticker}`,
    },
    {
      eventTitle: m.event_ticker,
      category: m.category,
      volumeUsd: m.volume,
      liquidityUsd: m.liquidity,
      closeTime: m.close_time ? new Date(m.close_time) : undefined,
    }
  )
}

function parseResponse(raw: unknown) {
  const parsed = KalshiMarketsResponseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new SchemaMismatchError(
      'kalshi markets response',
      payloadPreview(raw)
    )
  }
  return parsed.data
}

/** Validate + normalize a raw Kalshi markets response. Pure; unit-tested. */
export function normalizeKalshiMarkets(raw: unknown): NormalizedMarket[] {
  return parseResponse(raw)
    .markets.map(normalizeOne)
    .filter((m): m is NormalizedMarket => m !== null)
}

export const kalshiProvider: MarketProvider = {
  name: 'kalshi',

  async fetchOpenMarkets(opts?: FetchOpts): Promise<NormalizedMarket[]> {
    const out: NormalizedMarket[] = []
    let cursor: string | undefined

    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({
        status: 'open',
        limit: String(PAGE_LIMIT),
      })
      if (cursor) params.set('cursor', cursor)

      const raw = await fetchJson<unknown>(`${BASE}/markets?${params}`, {
        timeoutMs: 5000,
        retries: 2,
      })
      const { markets, cursor: next } = parseResponse(raw)
      for (const m of markets) {
        const n = normalizeOne(m)
        if (n) out.push(n)
      }

      cursor = next
      if (!cursor) break
      if (opts?.limit !== undefined && out.length >= opts.limit) break
    }

    return opts?.limit !== undefined ? out.slice(0, opts.limit) : out
  },

  async fetchMarket(externalId: string): Promise<NormalizedMarket> {
    const raw = await fetchJson<unknown>(`${BASE}/markets/${externalId}`, {
      timeoutMs: 5000,
      retries: 2,
    })
    const parsed = KalshiSingleMarketResponseSchema.safeParse(raw)
    if (!parsed.success) {
      throw new SchemaMismatchError('kalshi single market', payloadPreview(raw))
    }
    const normalized = normalizeOne(parsed.data.market)
    if (!normalized) {
      throw new Error(`kalshi market ${externalId} has no usable price`)
    }
    return normalized
  },
}
