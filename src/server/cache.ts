import 'server-only'
import { Redis } from '@upstash/redis'
import { z } from 'zod'
import { env } from '@/config/env'

/** Upstash Redis client — hot catalog + rate-limit counters (spec §5, §8). */
export const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
})

/** Versioned key for the warm catalog so a bad sync can't poison readers. */
export const CATALOG_KEY = 'catalog:v1'
export const LAST_SYNC_KEY = 'sync:lastAt'
export const degradedKey = (provider: string) => `degraded:${provider}`

/**
 * Redis-cached market shape (spec §5, retrieval read-side contract — mirrors
 * `evals/fixtures/catalog.json`). Deliberately has NO embedding field: vectors
 * stay in Postgres and are read via pgvector `$queryRaw`, never cached in Redis.
 */
export interface HotMarket {
  readonly provider: 'kalshi' | 'polymarket'
  readonly externalId: string
  readonly searchText: string
  readonly yesPrice: number
  readonly noPrice: number
  readonly category?: string
  readonly status: string
  readonly closeTime?: string // ISO
  readonly volumeUsd?: number
  readonly liquidityUsd?: number
}

export const HotMarketSchema = z.object({
  provider: z.enum(['kalshi', 'polymarket']),
  externalId: z.string().min(1),
  searchText: z.string().min(1),
  yesPrice: z.number(),
  noPrice: z.number(),
  category: z.string().optional(),
  status: z.string().min(1),
  // Enforced ISO so a malformed value can't slip into the cache. Note the
  // tradeoff: `readHotCatalog` fails open to `[]` for the *whole* array on a
  // parse failure, so one non-ISO `closeTime` blanks the entire read —
  // acceptable since the only writer is `toHotMarket`'s `.toISOString()`.
  closeTime: z.string().datetime().optional(),
  volumeUsd: z.number().optional(),
  liquidityUsd: z.number().optional(),
})

/**
 * Writes the full catalog + last-sync timestamp atomically (one pipelined
 * call) so readers never observe a half-written array (spec AC 14–16).
 */
export async function writeHotCatalog(
  markets: readonly HotMarket[],
  at: Date
): Promise<void> {
  await redis
    .multi()
    .set(CATALOG_KEY, markets)
    .set(LAST_SYNC_KEY, at.toISOString())
    .exec()
}

/** Build a `HotMarket`, omitting undefined optionals (exactOptionalPropertyTypes;
 * mirrors `buildNormalizedMarket`'s required/optional split so both call sites
 * that assemble a `HotMarket` — this module and `sync.ts` — share one shape. */
export function buildHotMarket(
  required: Pick<
    HotMarket,
    'provider' | 'externalId' | 'searchText' | 'yesPrice' | 'noPrice' | 'status'
  >,
  optional: {
    category?: string | undefined
    closeTime?: string | undefined
    volumeUsd?: number | undefined
    liquidityUsd?: number | undefined
  }
): HotMarket {
  return {
    ...required,
    ...(optional.category !== undefined ? { category: optional.category } : {}),
    ...(optional.closeTime !== undefined
      ? { closeTime: optional.closeTime }
      : {}),
    ...(optional.volumeUsd !== undefined
      ? { volumeUsd: optional.volumeUsd }
      : {}),
    ...(optional.liquidityUsd !== undefined
      ? { liquidityUsd: optional.liquidityUsd }
      : {}),
  }
}

/** `[]` if the catalog has never been written or is malformed (fail open). */
export async function readHotCatalog(): Promise<HotMarket[]> {
  const raw = await redis.get<unknown>(CATALOG_KEY)
  if (raw === null || raw === undefined) return []
  const parsed = z.array(HotMarketSchema).safeParse(raw)
  return parsed.success ? parsed.data.map(m => buildHotMarket(m, m)) : []
}

/** `null` if sync has never run. */
export async function readLastSyncAt(): Promise<string | null> {
  const raw = await redis.get<string>(LAST_SYNC_KEY)
  return raw ?? null
}
