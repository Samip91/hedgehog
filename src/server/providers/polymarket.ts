import { fetchJson, SchemaMismatchError } from '@/server/http'
import {
  PolymarketMarketsResponseSchema,
  type PolymarketMarket,
} from './schemas'
import {
  buildNormalizedMarket,
  buildSearchText,
  clamp01,
  parseJsonStringArray,
  payloadPreview,
  round4,
  toNumber,
} from './normalize'
import type { FetchOpts, MarketProvider, NormalizedMarket } from './types'

const BASE = 'https://gamma-api.polymarket.com'
const PAGE_LIMIT = 200

/** Non-binary markets and malformed price/outcome strings are skipped. */
function normalizeOne(m: PolymarketMarket): NormalizedMarket | null {
  if (m.closed === true || m.active === false) return null

  const outcomes = parseJsonStringArray(m.outcomes)
  const prices = parseJsonStringArray(m.outcomePrices)
  if (!outcomes || !prices || outcomes.length !== 2 || prices.length !== 2) {
    return null // skip non-binary (spec §5.3)
  }

  const yesIdx = outcomes.findIndex(o => o.toLowerCase() === 'yes')
  const idx = yesIdx >= 0 ? yesIdx : 0
  const yesRaw = Number(prices[idx])
  const noRaw = Number(prices[idx === 0 ? 1 : 0])
  if (!Number.isFinite(yesRaw) || !Number.isFinite(noRaw)) return null

  const yesPrice = round4(clamp01(yesRaw))

  return buildNormalizedMarket(
    {
      provider: 'polymarket',
      externalId: m.id,
      question: m.question,
      searchText: buildSearchText(m.question, m.category),
      yesPrice,
      noPrice: round4(clamp01(noRaw)),
      status: 'open',
      url: `https://polymarket.com/market/${m.slug ?? m.id}`,
    },
    {
      category: m.category,
      volumeUsd: toNumber(m.volume),
      liquidityUsd: toNumber(m.liquidity),
      closeTime: m.endDate ? new Date(m.endDate) : undefined,
    }
  )
}

function parseResponse(raw: unknown): PolymarketMarket[] {
  const parsed = PolymarketMarketsResponseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new SchemaMismatchError(
      'polymarket markets response',
      payloadPreview(raw)
    )
  }
  return parsed.data
}

/** Validate + normalize a raw Polymarket markets response. Pure; unit-tested. */
export function normalizePolymarketMarkets(raw: unknown): NormalizedMarket[] {
  return parseResponse(raw)
    .map(normalizeOne)
    .filter((m): m is NormalizedMarket => m !== null)
}

export const polymarketProvider: MarketProvider = {
  name: 'polymarket',

  async fetchOpenMarkets(opts?: FetchOpts): Promise<NormalizedMarket[]> {
    const params = new URLSearchParams({
      active: 'true',
      closed: 'false',
      limit: String(opts?.limit ?? PAGE_LIMIT),
      order: 'volume',
      ascending: 'false',
    })
    const raw = await fetchJson<unknown>(`${BASE}/markets?${params}`, {
      timeoutMs: 5000,
      retries: 2,
    })
    return normalizePolymarketMarkets(raw)
  },

  async fetchMarket(externalId: string): Promise<NormalizedMarket> {
    const raw = await fetchJson<unknown>(`${BASE}/markets/${externalId}`, {
      timeoutMs: 5000,
      retries: 2,
    })
    // The single-market endpoint returns one object; wrap it for the array parser.
    const normalized = normalizePolymarketMarkets([raw])
    if (normalized.length === 0) {
      throw new Error(
        `polymarket market ${externalId} is not a usable binary market`
      )
    }
    return normalized[0] as NormalizedMarket
  },
}
