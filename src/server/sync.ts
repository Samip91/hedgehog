/**
 * Cron sync (spec §5.4): fetch both providers in parallel (Promise.allSettled)
 * → normalize + filter → upsert MarketSnapshot → hash-diff → embed changed rows
 * → write hot catalog to Redis → record lastSyncAt. One provider failing sets a
 * `degraded:{provider}` flag and still syncs the other.
 *
 * The request path NEVER calls this or the providers — spec core principle.
 */
import { createHash } from 'node:crypto'
import { Prisma, type MarketStatus, type Provider } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/server/db'
import {
  buildHotMarket,
  degradedKey,
  redis,
  writeHotCatalog,
  type HotMarket,
} from '@/server/cache'
import { embedBatch } from '@/server/pipeline/embed'
import { providers } from '@/server/providers/registry'
import { toProviderEnum } from '@/server/providers/provider-enum'
import type { NormalizedMarket } from '@/server/providers/types'

export interface SyncResult {
  readonly fetched: number
  readonly upserted: number
  readonly embedded: number
  readonly degraded: string[]
}

/** Re-validated at the sync boundary — provider clients already normalize,
 * but a single bad row must never abort the whole run (spec AC 7). */
const NormalizedMarketSchema = z.object({
  provider: z.enum(['kalshi', 'polymarket']),
  externalId: z.string().min(1),
  question: z.string().min(1),
  eventTitle: z.string().optional(),
  searchText: z.string().min(1),
  category: z.string().optional(),
  yesPrice: z.number().min(0).max(1),
  noPrice: z.number().min(0).max(1),
  volumeUsd: z.number().optional(),
  liquidityUsd: z.number().optional(),
  closeTime: z.date().optional(),
  status: z.enum(['open', 'closed', 'resolved']),
  resolvedYes: z.boolean().optional(),
  url: z.string().min(1),
})

/** Explicit map (not `.toUpperCase()`) — mirrors the `toProviderEnum` casing
 * boundary pattern (see docs/PITFALLS.md); no `.toUpperCase()` in sync code. */
const STATUS_TO_ENUM: Record<NormalizedMarket['status'], MarketStatus> = {
  open: 'OPEN',
  closed: 'CLOSED',
  resolved: 'RESOLVED',
}

/** Sentinel textHash for a brand-new row: never matches a real sha256 digest,
 * so the row stays "dirty" until a successful embed advances it via
 * `writeEmbedding` — guarantees a failed first embed is retried, not lost. */
const NEW_ROW_HASH = ''

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** `existingHashByKey`/hash-diff lookup key — one shared format for both. */
function rowKey(provider: Provider, externalId: string): string {
  return `${provider}:${externalId}`
}

function toRawTrimmed(m: NormalizedMarket): Prisma.InputJsonValue {
  return {
    externalId: m.externalId,
    yesPrice: m.yesPrice,
    noPrice: m.noPrice,
  }
}

/** Scalar-only upsert payload — the `embedding` column is never touched here
 * (Prisma cannot write `Unsupported`; see ADR 001). `textHash` is deliberately
 * omitted from `update` so a mid-run embed failure leaves the previous hash
 * (and vector) intact, satisfying AC 13. */
function toUpsertData(m: NormalizedMarket) {
  return {
    question: m.question,
    eventTitle: m.eventTitle ?? null,
    searchText: m.searchText,
    category: m.category ?? null,
    yesPrice: new Prisma.Decimal(m.yesPrice),
    noPrice: new Prisma.Decimal(m.noPrice),
    volumeUsd:
      m.volumeUsd !== undefined ? new Prisma.Decimal(m.volumeUsd) : null,
    liquidityUsd:
      m.liquidityUsd !== undefined ? new Prisma.Decimal(m.liquidityUsd) : null,
    closeTime: m.closeTime ?? null,
    status: STATUS_TO_ENUM[m.status],
    resolvedYes: m.resolvedYes ?? null,
    rawTrimmed: toRawTrimmed(m),
  }
}

async function upsertMarket(m: NormalizedMarket): Promise<void> {
  const data = toUpsertData(m)
  await db.marketSnapshot.upsert({
    where: {
      provider_externalId: {
        provider: toProviderEnum(m.provider),
        externalId: m.externalId,
      },
    },
    create: {
      provider: toProviderEnum(m.provider),
      externalId: m.externalId,
      textHash: NEW_ROW_HASH,
      ...data,
    },
    update: data,
  })
}

/** The one place a vector is written — see ADR 001 for the exact shape.
 * `textHash` advances atomically with the embedding so a skipped/failed embed
 * never leaves a mismatched (hash, vector) pair. */
async function writeEmbedding(
  provider: NormalizedMarket['provider'],
  externalId: string,
  vector: number[],
  hash: string
): Promise<void> {
  const literal = `[${vector.join(',')}]`
  await db.$executeRaw`
    UPDATE "MarketSnapshot"
    SET embedding = ${literal}::vector, "textHash" = ${hash}
    WHERE provider = ${toProviderEnum(provider)}::"Provider" AND "externalId" = ${externalId}`
}

function toHotMarket(m: NormalizedMarket): HotMarket {
  return buildHotMarket(m, {
    category: m.category,
    closeTime: m.closeTime?.toISOString(),
    volumeUsd: m.volumeUsd,
    liquidityUsd: m.liquidityUsd,
  })
}

interface DirtyRow {
  readonly market: NormalizedMarket
  readonly hash: string
}

export async function runSync(): Promise<SyncResult> {
  const degraded: string[] = []
  const collectedValid: NormalizedMarket[] = []
  let anyProviderOk = false
  let fetched = 0

  // Never Promise.all — one provider rejecting must not block the other's
  // markets from updating (spec AC 1–3).
  const settled = await Promise.allSettled(
    providers.map(p => p.fetchOpenMarkets())
  )

  // Filter raw → valid PER fulfilled provider (not globally after the loop)
  // so an all-malformed provider response can be told apart from a healthy
  // one before the catalog write decision below (Finding 1).
  for (const [i, provider] of providers.entries()) {
    const result = settled[i]
    if (!result) continue
    if (result.status === 'fulfilled') {
      anyProviderOk = true
      const rawRows = result.value
      fetched += rawRows.length
      const validRows = rawRows.filter(
        m => NormalizedMarketSchema.safeParse(m).success
      )
      collectedValid.push(...validRows)

      // A fulfilled fetch that returned rows but none survived validation is
      // a schema break (provider changed shape), not a healthy sync — flag
      // it degraded rather than silently clearing the flag. A provider with
      // one malformed row among otherwise-valid rows still has
      // validRows.length > 0, so it correctly stays un-flagged (AC 7).
      if (rawRows.length > 0 && validRows.length === 0) {
        degraded.push(provider.name)
        await redis.set(degradedKey(provider.name), '1')
      } else {
        await redis.del(degradedKey(provider.name))
      }
    } else {
      degraded.push(provider.name)
      await redis.set(degradedKey(provider.name), '1')
    }
  }

  // Dedup by (provider, externalId) within this run (Finding 2) — a
  // duplicate externalId in one fetch must not double-embed or inflate
  // upserted/embedded counts. Keeps the first occurrence.
  const seenKeys = new Set<string>()
  const valid: NormalizedMarket[] = []
  for (const m of collectedValid) {
    const key = rowKey(toProviderEnum(m.provider), m.externalId)
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    valid.push(m)
  }

  const providerEnums = [...new Set(valid.map(m => toProviderEnum(m.provider)))]
  const existing =
    providerEnums.length > 0
      ? await db.marketSnapshot.findMany({
          where: { provider: { in: providerEnums } },
          select: { provider: true, externalId: true, textHash: true },
        })
      : []
  const existingHashByKey = new Map<string, string>()
  for (const row of existing) {
    existingHashByKey.set(rowKey(row.provider, row.externalId), row.textHash)
  }

  const dirtyRows: DirtyRow[] = []
  for (const market of valid) {
    await upsertMarket(market)
    const hash = sha256(market.searchText)
    const key = rowKey(toProviderEnum(market.provider), market.externalId)
    if (existingHashByKey.get(key) !== hash) {
      dirtyRows.push({ market, hash })
    }
  }
  const upserted = valid.length

  // Called unconditionally (even with an empty `dirtyRows`) so embedBatch's
  // input directly reflects hash-diff output — `embedBatch([])` makes zero
  // HTTP calls (chunk of an empty array yields zero batches).
  // Incremented per successful `writeEmbedding` (Finding 3) rather than
  // assigned `dirtyRows.length` after the loop, so `embedded` reflects
  // writes that actually landed: an `embedBatch` throw leaves it at 0 (the
  // loop never runs), and a mid-loop `writeEmbedding` throw leaves it at the
  // count of rows written before the throw — never inflated.
  let embedded = 0
  try {
    const vectors = await embedBatch(dirtyRows.map(r => r.market.searchText))
    for (const [i, row] of dirtyRows.entries()) {
      const vector = vectors[i]
      if (!vector) continue
      await writeEmbedding(
        row.market.provider,
        row.market.externalId,
        vector,
        row.hash
      )
      embedded++
    }
    // Symmetric with the provider flags (AC 17): clear on success so a
    // previous outage doesn't stay stuck flagged on /api/health.
    await redis.del(degradedKey('embedding'))
  } catch {
    // Previously-upserted rows (and any row not yet written this run) keep
    // their existing embedding/textHash — no partial/corrupt write (spec
    // AC 13). `embedded` already reflects whatever wrote before the throw.
    degraded.push('embedding')
    // Persist so /api/health (Redis-only) can surface the outage — AC 13's
    // "Embedding failure signal" resolved decision requires this, not just
    // the in-memory SyncResult.degraded.
    await redis.set(degradedKey('embedding'), '1')
  }

  // Writes normally with valid data; writes `[]` only on a genuinely empty
  // fetch (`fetched === 0`, markets legitimately all closed); preserves the
  // last good catalog on an all-malformed run instead of silently wiping it
  // (Finding 1).
  const shouldWriteCatalog =
    anyProviderOk && !(fetched > 0 && valid.length === 0)
  if (shouldWriteCatalog) {
    await writeHotCatalog(valid.map(toHotMarket), new Date())
  }

  return { fetched, upserted, embedded, degraded }
}
