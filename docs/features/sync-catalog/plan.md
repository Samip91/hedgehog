# Plan: sync (hot catalog + health)

## Branch

`feature/sync-catalog` (already created)

## Approach

`runSync()` is the single orchestrator that ties together five pure-ish stages behind I/O seams that already exist in the codebase. The design deliberately keeps each stage as a small, individually testable unit and lets `runSync` be thin glue:

1. **Fetch (per provider, isolated).** Iterate `providers` from `src/server/providers/registry.ts` and call `fetchOpenMarkets()` under `Promise.allSettled` (AC 1–3). Each provider client already wraps `fetchJson`/retry internally (see `kalshi.ts`), so sync adds no HTTP logic — it only classifies `fulfilled` vs `rejected`. A rejected settle pushes the provider `name` into `degraded` and sets `degradedKey(name)` in Redis; a fulfilled settle clears (`del`) that key (AC 17).

2. **Normalize + validate at the boundary.** The provider clients already return `NormalizedMarket[]`. Sync re-validates each with a Zod `NormalizedMarketSchema` (new, colocated) so a single bad row is skipped-and-counted, not thrown (AC 7). `fetched` counts the raw provider output length before the skip filter (AC 7).

3. **Hash-diff.** `textHash = sha256(searchText)` via Node's built-in `node:crypto` (no new dependency) for every market (AC 9). Load existing `{externalId, textHash}` for this provider's rows in one `db.marketSnapshot.findMany({ select })` and diff: a market is "dirty" if new or hash changed (AC 10, 12).

4. **Upsert.** Convert to the Prisma payload using `toProviderEnum` at exactly one place (AC 4), money/prob as `Prisma.Decimal` (AC 5), keyed on the `@@unique([provider, externalId])` via `db.marketSnapshot.upsert` (AC 6). `rawTrimmed` is a small hand-picked subset, never the raw body (AC 8). The `embedding` column is **not** touched here (Prisma cannot write `Unsupported`).

5. **Embed dirty rows only.** `embedBatch(searchTexts)` in bounded batches, then write each returned vector to the `embedding` column via `$executeRaw` (the only way to write an `Unsupported("vector")` column — see ADR). If `embedBatch` throws, catch it, add `'embedding'` to `degraded`, and skip the vector writes so existing embeddings/`textHash` stay intact (AC 13).

6. **Hot catalog write.** Build the full embedding-free array in memory, then set `CATALOG_KEY` + `LAST_SYNC_KEY` in one Upstash pipeline so readers never see a half-written catalog (AC 14–16).

The catalog mirrors the already-committed `evals/fixtures/catalog.json` shape (that's the retrieval read-side contract), minus embeddings — reuse that as the fixture reference so producer and consumer agree.

`GET /api/health` reads Redis only (`readHotCatalog` length, `LAST_SYNC_KEY`, and `degradedKey` for each known name), never Postgres/providers (AC 18–20).

Reused utilities (do not reinvent): `providers`/`getProvider` (registry), `toProviderEnum` (provider-enum), `redis` + the three key constants (cache), `db` singleton, `ok`/`err` envelope (shared/schemas), `round4`/`toNumber`/`payloadPreview` (normalize), the `fixtures/*.json` + `describe/it/vi` test style.

## File map

**Create / modify (implementation)**

- `src/server/pipeline/embed.ts` — _modify_: implement `embedBatch`; leave `embedText` as its `feature: retrieval` stub (its doc tag).
- `src/server/sync.ts` — _modify_: implement `runSync`; keep the exported `SyncResult` shape unchanged.
- `src/server/cache.ts` — _modify_: add `writeHotCatalog`, `readHotCatalog`, `readLastSyncAt`, and a `HotMarket` type + Zod schema; reuse the existing keys (add no new key).
- `src/server/pipeline/embed-client.ts` — _create_ (optional, see ADR fallback): NIM embeddings POST wrapper with an injectable `fetchImpl`. Only if we don't extend `fetchJson`.
- `src/server/http.ts` — _modify_ (ADR-preferred): add optional `method?`/`body?` to `FetchJsonOptions` (backward-compatible, GET default) so `embedBatch` can POST through the existing retry/breaker.
- `src/app/api/health/route.ts` — _create_: `GET` returning `ok({ lastSyncAt, catalogSize, degraded })`, Redis-only, no auth, `dynamic = 'force-dynamic'`.
- `prisma/sql/001_enable_pgvector.sql` — _modify_: uncomment/author the HNSW index (`vector_cosine_ops`, `vector(1024)`), keep as authored-only (AC 21).

**Create — tests / fixtures**

- `src/server/sync.test.ts` — orchestration ACs (1–3, 6, 7, 10, 12, 13, 16, 17).
- `src/server/pipeline/embed.test.ts` — batching + dim invariant (AC 11, 13).
- `src/server/cache.test.ts` — catalog shape has no embedding, atomic write (AC 14, 15).
- `src/app/api/health/route.test.ts` — pre-first-sync + populated (AC 18–20).
- `src/server/fixtures/normalized-markets.json` — small `NormalizedMarket[]` incl. one malformed row (AC 7) and one that will be mutated across runs (AC 10).

No schema.prisma change: `embedding`, `textHash`, `rawTrimmed`, and `@@unique` already exist.

## Sequencing

**Serial foundation (blocks the rest):**

1. `src/server/cache.ts` helpers + `HotMarket` schema — everything downstream imports the catalog shape.
2. `src/server/http.ts` POST support (ADR decision) — unblocks `embedBatch`.

**Then parallelizable across two backend-web3-engineer instances:**

- **Track A (embedding + SQL):** `embed.ts` (`embedBatch`) + `prisma/sql/001_enable_pgvector.sql`. Depends on step 2, not on sync.
- **Track B (route):** `src/app/api/health/route.ts` — depends only on step 1 (cache helpers).

**Serial join:**

- `src/server/sync.ts` — depends on Track A (`embedBatch` + vector-write helper) and step 1. Build last.

**Tests** follow each unit and can be written in parallel by the test-writer once signatures land; `sync.test.ts` last.

## Design details per file

**`src/server/cache.ts`**

```ts
export interface HotMarket {
  provider: 'kalshi' | 'polymarket'; externalId: string; searchText: string
  yesPrice: number; noPrice: number; category?: string
  status: string; closeTime?: string   // ISO
  volumeUsd?: number; liquidityUsd?: number
}                                       // NOTE: no embedding field (AC 14)
export const HotMarketSchema = z.object({...})
export async function writeHotCatalog(markets: HotMarket[], at: Date): Promise<void>
export async function readHotCatalog(): Promise<HotMarket[]>   // [] if unset (AC 19)
export async function readLastSyncAt(): Promise<string | null> // null if unset
```

`writeHotCatalog` uses a single pipeline: `redis.multi().set(CATALOG_KEY, markets).set(LAST_SYNC_KEY, at.toISOString()).exec()` (AC 15, 16). `readHotCatalog` parses with `z.array(HotMarketSchema).catch([])` so a poisoned key degrades to empty rather than 500.

**`src/server/pipeline/embed.ts`**

```ts
const BATCH_SIZE = 64 // exported const (AC 11)
export async function embedBatch(texts: string[]): Promise<number[][]>
```

Chunk `texts` into `BATCH_SIZE` slices, POST each to NIM `/embeddings` (`model: env.EMBEDDING_MODEL`, `input_type: 'passage'`), flatten in order. Assert each returned vector `.length === env.EMBEDDING_DIM`; throw a typed error on mismatch (dim invariant, PITFALLS). Returns `number[][]` aligned 1:1 with `texts`. Input/fetch injectable for tests.

**`src/server/sync.ts`** — control flow:

```
results = await Promise.allSettled(providers.map(p => p.fetchOpenMarkets()))
for each settle: fulfilled → collect markets, redis.del(degradedKey(name))
                 rejected  → degraded.push(name), redis.set(degradedKey(name),'1')
valid   = markets.map(validate).filter(ok)        // fetched = raw length
existing= db.marketSnapshot.findMany({ where:{provider in...}, select:{externalId,textHash} })
dirty   = valid.filter(new || hash changed)
for each valid: db.marketSnapshot.upsert(toRow(m))    // Decimal, toProviderEnum, no embedding
try {
  vectors = await embedBatch(dirty.map(d => d.searchText))
  for (d, v) of zip: await writeEmbedding(provider, externalId, v, textHash)  // $executeRaw
  embedded = dirty.length
} catch { degraded.push('embedding'); embedded = 0 }   // (AC 13)
await writeHotCatalog(valid.map(toHotMarket), new Date())   // if ≥1 provider produced
return { fetched, upserted, embedded, degraded }
```

`writeEmbedding` (private helper) is the vector-write seam — see ADR for the exact `$executeRaw` shape.

**`src/app/api/health/route.ts`**

```ts
export const dynamic = 'force-dynamic'
export async function GET() {
  const [catalog, lastSyncAt] = await Promise.all([
    readHotCatalog(),
    readLastSyncAt(),
  ])
  const names = [...providers.map(p => p.name), 'embedding']
  const flags = await redis.mget<(string | null)[]>(...names.map(degradedKey))
  const degraded = names.filter((_, i) => Boolean(flags[i]))
  return NextResponse.json(
    ok({
      lastSyncAt: lastSyncAt ?? null,
      catalogSize: catalog.length,
      degraded,
    })
  )
}
```

No auth, no `db`, no provider call (AC 18–20). Returns `null`/`0`/`[]` cleanly pre-first-sync (AC 19).

## Key risks & mitigations

1. **pgvector write via Prisma `Unsupported` column (highest risk).** Prisma `create/update/upsert` cannot set `embedding`. Mitigation: write it in a separate `$executeRaw` after upsert, formatting the vector as a pgvector literal string cast `::vector`, with the enum arg cast `::"Provider"`. See ADR for the exact statement and injection-safety note. This is the load-bearing detail the engineers must not improvise.
2. **Embedding-dim invariant.** A model returning a non-1024 vector corrupts the HNSW index silently. Mitigation: `embedBatch` throws on `length !== env.EMBEDDING_DIM`; the throw routes into the `'embedding'` degraded path (AC 13) rather than a partial write.
3. **Decimal conversion.** Passing raw `number` risks a `Float` round-trip. Mitigation: wrap `yesPrice/noPrice/volumeUsd/liquidityUsd` in `Prisma.Decimal(...)` in the `toRow` mapper; the values are already `round4`-normalized by the providers.
4. **Catalog atomicity.** Incremental writes could expose a half-catalog to retrieval. Mitigation: build full array, single pipelined `set` of `CATALOG_KEY`+`LAST_SYNC_KEY` (AC 15). Degraded-mode requirement: even when one provider is down, the catalog is written from whatever ≥1 provider returned, and `LAST_SYNC_KEY` still advances (AC 16) — retrieval stays warm.
5. **Idempotency.** Re-running must not duplicate rows or re-embed unchanged text. Mitigation: `@@unique([provider, externalId])` upsert (AC 6) + hash-diff gating embeds (AC 10, 12). Verified by the twice-run test.
6. **HTTP POST reuse gap.** `fetchJson` is GET-only (no `method`/`body`) — embeddings need POST. Decided in the ADR (extend `fetchJson`); do not fork retry logic ad hoc.

## Tests & evals (seams for the test-writer)

Everything is unit-testable with no live DB/Redis by injecting collaborators:

- **`runSync`:** `vi.mock` the four modules (`registry`, `db`, `embed`, `cache`) — matches `http.ts` seam style. Fixtures drive `fetchOpenMarkets`. Assert: allSettled isolation (AC 1–3), twice-run row count + `embedded=0` then `1` after mutating a fixture `question` (AC 6, 10, 12), malformed row skipped with `fetched` intact (AC 7), `embedBatch` throw → `degraded:['embedding']` and no vector write (AC 13), degradedKey set/cleared (AC 17).
- **`embedBatch`:** inject `fetchImpl`; assert ≥2 batches for `>BATCH_SIZE` inputs (AC 11), order preserved, dim-mismatch throws.
- **`cache`:** mock `redis`; assert written JSON has no `embedding` key (AC 14) and exactly one pipelined write (AC 15).
- **`/api/health`:** mock `redis`; empty → `{null,0,[]}` (AC 19), populated → correct triple (AC 18); assert `db` and providers never imported/called (AC 20).
- **Grep-checkable (reviewer):** no `.toUpperCase()` in sync code (AC 4); `HotMarket` type has no `embedding` (AC 14).

## Deferred (keep the slice small)

- Market lifecycle CLOSED/RESOLVED transitions — spec Resolved decision, out of scope; stale DB rows are harmless because the hot catalog only carries the latest fetch.
- Applying the migration / provisioning Neon+Upstash / Vercel cron schedule — `feature: ship`.
- `embedText`, hybrid retrieval, rerank — `feature: retrieval`.

See ADR: `docs/adr/001-pgvector-embedding-write-path.md`.
