import 'server-only'
import type { MarketSnapshot, Provider } from '@prisma/client'
import { db } from '@/server/db'

/**
 * The `MarketSnapshot` joined to a saved hedge's (provider, externalId) — the
 * same composite key used at sync time (`sync.ts`). `null` when no snapshot
 * has synced yet. Shared by the single-row routes (`POST /api/hedges`,
 * `GET /api/hedges/[id]`); the list route batches this itself instead.
 */
export function findSnapshot(
  provider: Provider,
  externalId: string
): Promise<MarketSnapshot | null> {
  return db.marketSnapshot.findUnique({
    where: { provider_externalId: { provider, externalId } },
  })
}
