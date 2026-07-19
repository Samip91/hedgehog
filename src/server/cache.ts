import { Redis } from '@upstash/redis'
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

// TODO(feature: sync): readHotCatalog / writeHotCatalog helpers (no embeddings
// in the cached payload — ids, searchText, prices, filter fields only).
