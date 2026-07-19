import { fetchJson, SchemaMismatchError } from '@/server/http'
import {
  KalshiMarketsResponseSchema,
  KalshiSingleMarketResponseSchema,
  type KalshiMarket,
} from './schemas'
import {
  buildNormalizedMarket,
  buildSearchText,
  clamp01,
  payloadPreview,
  round4,
  toNumber,
} from './normalize'
import type { FetchOpts, MarketProvider, NormalizedMarket } from './types'

const BASE = 'https://api.elections.kalshi.com/trade-api/v2'
const PAGE_LIMIT = 200
const MAX_PAGES = 10

/**
 * Yes probability (0–1). Prices arrive as string dollars already in 0–1: use the
 * bid/ask midpoint when two-sided, else last_price. Fully illiquid markets (all
 * quotes 0) return null and are dropped.
 */
function yesProbability(m: KalshiMarket): number | null {
  const bid = toNumber(m.yes_bid_dollars) ?? 0
  const ask = toNumber(m.yes_ask_dollars) ?? 0
  if (bid > 0 && ask > 0) return (bid + ask) / 2
  const last = toNumber(m.last_price_dollars) ?? 0
  return last > 0 ? last : null
}

function normalizeOne(m: KalshiMarket): NormalizedMarket | null {
  const prob = yesProbability(m)
  if (prob === null) return null
  const yesPrice = round4(clamp01(prob))

  return buildNormalizedMarket(
    {
      provider: 'kalshi',
      externalId: m.ticker,
      question: m.title,
      // Kalshi titles are ambiguous without the parent event (spec §5.2).
      searchText: buildSearchText(m.event_ticker, m.title, m.yes_sub_title),
      yesPrice,
      noPrice: round4(1 - yesPrice),
      // We request ?status=open, so every returned market is open.
      status: 'open',
      url: `https://kalshi.com/markets/${m.ticker}`,
    },
    {
      eventTitle: m.event_ticker,
      // volume_fp ≈ traded contract count (~USD notional at $1/contract); firm up in sync.
      volumeUsd: toNumber(m.volume_fp),
      liquidityUsd: toNumber(m.liquidity_dollars),
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
