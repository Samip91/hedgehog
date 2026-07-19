/**
 * Cron sync (spec §5.4): fetch both providers in parallel (Promise.allSettled)
 * → normalize + filter → upsert MarketSnapshot → hash-diff → embed changed rows
 * → write hot catalog to Redis → record lastSyncAt. One provider failing sets a
 * `degraded:{provider}` flag and still syncs the other.
 *
 * The request path NEVER calls this or the providers — spec core principle.
 */
export interface SyncResult {
  readonly fetched: number
  readonly upserted: number
  readonly embedded: number
  readonly degraded: string[]
}

export async function runSync(): Promise<SyncResult> {
  throw new Error('runSync: not implemented (feature: sync)')
}
