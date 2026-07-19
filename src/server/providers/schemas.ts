import { z } from 'zod'

/**
 * Zod schemas for the RAW provider payloads. Unknown extra keys are stripped
 * (zod's default), so these tolerate the providers adding fields; a shape
 * mismatch on the fields we depend on surfaces as a SchemaMismatchError.
 *
 * NOTE: field sets reflect the providers' public docs at time of writing and
 * must be confirmed against a live response (run `pnpm tsx scripts/verify-providers.ts`).
 */

// ── Kalshi ──────────────────────────────────────────────────────────────────
// Verified against the live trade-api/v2 response (2026): prices are STRING
// dollar amounts already in 0–1 (e.g. "0.24"), not integer cents.
const numeric = z.union([z.string(), z.number()]).optional()
export const KalshiMarketSchema = z.object({
  ticker: z.string(),
  event_ticker: z.string().optional(),
  title: z.string(),
  yes_sub_title: z.string().optional(),
  status: z.string().optional(),
  yes_bid_dollars: numeric,
  yes_ask_dollars: numeric,
  last_price_dollars: numeric,
  liquidity_dollars: numeric,
  volume_fp: numeric,
  close_time: z.string().optional(),
})
export type KalshiMarket = z.infer<typeof KalshiMarketSchema>

export const KalshiMarketsResponseSchema = z.object({
  markets: z.array(KalshiMarketSchema),
  cursor: z.string().optional(),
})

export const KalshiSingleMarketResponseSchema = z.object({
  market: KalshiMarketSchema,
})

// ── Polymarket (gamma) ──────────────────────────────────────────────────────
export const PolymarketMarketSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  question: z.string(),
  slug: z.string().optional(),
  // JSON-encoded strings inside the JSON — parsed defensively downstream.
  outcomes: z.string(),
  outcomePrices: z.string(),
  volume: z.union([z.string(), z.number()]).optional(),
  liquidity: z.union([z.string(), z.number()]).optional(),
  endDate: z.string().optional(),
  active: z.boolean().optional(),
  closed: z.boolean().optional(),
  category: z.string().optional(),
})
export type PolymarketMarket = z.infer<typeof PolymarketMarketSchema>

export const PolymarketMarketsResponseSchema = z.array(PolymarketMarketSchema)
