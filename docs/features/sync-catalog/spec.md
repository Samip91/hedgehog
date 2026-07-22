# Feature: sync

## Problem / user value

Hedgehog's core principle is "the request path never calls providers" — every
other feature (retrieval, propose, health checks) depends on Postgres + Redis
already holding a fresh, normalized catalog of open markets. Without this
feature there is no data for `/api/hedge` to read and no way to know whether
the catalog is stale or a provider is down. This feature builds the
cron-triggered sync loop that keeps that catalog warm and exposes its health.

## User stories

- As the retrieval pipeline (`feature: retrieval`), I want a hot Redis catalog
  of open markets with current prices and filter fields, so that hybrid
  retrieval never calls a provider on the request path.
- As the sync job, I want to fetch both providers in parallel and let one
  provider's failure never block the other's markets from updating, so a
  Kalshi outage doesn't stale out Polymarket data (and vice versa).
- As the embedding pipeline, I want to re-embed only markets whose
  `searchText` changed, so a ~2-minute cron cycle doesn't re-embed hundreds of
  unchanged rows every run and blow latency/cost budgets.
- As Postgres, I want every fetched market upserted idempotently keyed on
  `(provider, externalId)`, so repeated cron runs update rather than
  duplicate rows.
- As an on-call developer, I want a `GET /api/health` endpoint reporting last
  sync time, catalog size, and degraded providers, so I can tell at a glance
  whether the catalog is fresh before debugging deeper.

## Acceptance criteria (testable)

**Fetch + degraded handling**

1. `runSync()` fetches every provider in `providers` (from
   `src/server/providers/registry.ts`) via `Promise.allSettled` — never
   `Promise.all`. Test: mock one provider's `fetchOpenMarkets` to reject; the
   run still completes and the other provider's markets are upserted.
2. `SyncResult.degraded` contains the `name` of each provider whose
   `fetchOpenMarkets` rejected or threw; it is `[]` when both succeed.
3. A single provider rejecting never causes `runSync()` itself to throw/reject
   (the cron route's existing try/catch is a last resort, not the primary
   error path).

**Normalize + upsert** 4. Each `NormalizedMarket` is converted to a `MarketSnapshot` upsert payload
using `toProviderEnum` (per `src/server/providers/provider-enum.ts`) at
exactly that boundary — no `.toUpperCase()` calls elsewhere in sync code
(reviewer-checkable via grep). 5. Money/probability fields (`yesPrice`, `noPrice`, `volumeUsd`,
`liquidityUsd`) are written as `Decimal`, never through an intermediate
`Float`/`number` DB column. 6. Upsert key is `(provider, externalId)` (the schema's `@@unique`). Test:
running `runSync()` twice against the same fixture set results in the same
row count and an updated `updatedAt`, not duplicate rows. 7. A market whose normalized payload fails Zod validation is skipped (logged,
counted, not thrown) and does not abort the rest of the run. Test: one
malformed fixture market among many valid ones — run completes, valid rows
upserted, `fetched` still reflects the raw provider count. 8. `rawTrimmed` stores only a small, bounded debug subset (e.g. ticker/id and
raw price fields) — never the full provider response body.

**Hash-diff embedding** 9. `textHash = sha256(searchText)` is computed for every normalized market. 10. `embedBatch` is called only with the `searchText` of markets that are new
(no existing row) or whose computed hash differs from the stored
`textHash`. Test: run sync twice with unchanged fixtures — second run's
`embedBatch` input is empty; then mutate one market's `question` — second
run's `embedBatch` input contains exactly that one market. 11. `embedBatch` is called in bounded batches (a defined batch-size constant),
not as one call for 500+ markets at once. 12. `SyncResult.embedded` equals the count of rows actually re-embedded (hash
changed/new), not `fetched` or `upserted`. 13. If `embedBatch` throws for a batch, previously-upserted rows keep their
existing `embedding`/`textHash` (no partial/corrupt write), the run still
completes, and `SyncResult.degraded` includes an `'embedding'` entry so
`/api/health` can surface it.

**Redis hot catalog** 14. `writeHotCatalog(markets)` writes to `CATALOG_KEY` (`cache.ts`) an array of
objects containing only `provider`, `externalId`, `searchText`,
`yesPrice`, `noPrice`, `category`, `status`, `closeTime`,
`volumeUsd`/`liquidityUsd` — **no embedding vectors** (reviewer-checkable:
the written shape has no `embedding`/vector field). 15. The catalog write is all-or-nothing per run (readers never observe a
half-written array) — e.g. build the full array then set the key once,
rather than mutating incrementally. 16. After a run (degraded or not, as long as at least one provider produced
markets), `LAST_SYNC_KEY` is set to the run's completion timestamp (ISO
string) and readable via a `readHotCatalog()`/timestamp helper. 17. `degradedKey(provider)` is set truthy immediately after that provider's
fetch fails, and cleared on the next run where that provider succeeds.
Test: fail → flag set; next run succeeds → flag cleared.

**`/api/health`** 18. `GET /api/health` returns `200` with an `ok()`-enveloped body containing
`lastSyncAt` (ISO string or `null`), `catalogSize` (number), and
`degraded` (`string[]`), sourced from Redis only — it must not query
Postgres or call a provider. 19. `GET /api/health` returns `200` with `lastSyncAt: null`, `catalogSize: 0`,
`degraded: []` when Redis has never been populated (pre-first-sync) — it
does not 500. 20. `GET /api/health` requires no auth (unlike `/api/cron/sync`) and returns
quickly (no long-running work in the handler).

**Schema / migration (authoring only)** 21. A raw-SQL migration enabling the `pgvector` extension
(`prisma/sql/001_enable_pgvector.sql` or equivalent) and an HNSW index on
`MarketSnapshot.embedding` is authored and matches `EMBEDDING_DIM`
(`vector(1024)`) — authored/committed only, **not applied** to a
provisioned database as part of this feature.

## Scope

**In:**

- `runSync()` implementation in `src/server/sync.ts` (fetch, normalize,
  filter, upsert, hash-diff embed, degraded tracking, `SyncResult`).
- Real `embedBatch` implementation in `src/server/pipeline/embed.ts`
  (`embedText` stays a stub — that's `feature: retrieval`, per its doc tag).
- `readHotCatalog`/`writeHotCatalog` helpers in `src/server/cache.ts`, built
  on the existing `CATALOG_KEY`/`LAST_SYNC_KEY`/`degradedKey` constants
  (reuse, don't add new keys).
- `GET /api/health` route.
- Authored (not applied) pgvector-enable + HNSW-index migration SQL.
- Tests: fixture-driven unit/integration tests for all of the above, reusing
  `providers-day1` fixtures where possible.

**Out (non-goals):**

- Provisioning Neon/Upstash or configuring the Vercel cron schedule —
  `feature: ship` owns actual deployment.
- Applying the pgvector/HNSW migration to a live database — same reason;
  `current.md` already notes migrations are "authored, not applied."
- Query-time embedding (`embedText`), hybrid retrieval, and rerank —
  `feature: retrieval` / `feature: rerank`; this feature only produces the
  data they'll read.
- Any UI, including an admin/status page — `/api/health` is JSON-only, no
  frontend work in this slice.
- Market lifecycle cleanup (transitioning a `MarketSnapshot` to
  `CLOSED`/`RESOLVED` once a provider stops listing it as open) — deferred;
  see Resolved decisions.
- Alerting/paging on degraded state — `/api/health` reports; wiring
  alerts/notifications is separate, unscoped work.
- Broader rate limiting/headers hardening — that's `feature: hardening`.

## Resolved decisions

- **Market lifecycle:** OUT OF SCOPE. When a provider stops returning a market
  as open, its `MarketSnapshot` row is left as-is this slice (no CLOSED/RESOLVED
  transition). Tracked as a follow-up (`feature: retrieval`/settlement will
  revisit). The hot catalog only ever contains markets from the latest fetch,
  so stale DB rows do not leak into retrieval.
- **Embedding failure signal:** a total/per-batch `embedBatch` failure surfaces
  as `degraded: ['embedding']` in `SyncResult.degraded` and on `/api/health`,
  reusing the same `string[]` channel as provider degradation (AC 13).
- **`degradedKey` persistence:** no TTL — the flag is cleared only by a
  subsequent successful fetch of that provider (AC 17).
