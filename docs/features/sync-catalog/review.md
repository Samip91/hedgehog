# Reviewer report — feature `sync` (branch `feature/sync-catalog`)

Reviewed `spec.md` (AC 1–21), `plan.md`, ADR-001, `PITFALLS.md`, the implementation, and the tests. Baseline is green (73/73 tests pass). The pgvector write path, dim invariant, Decimal usage, casing boundary, and Zod-skip behavior are all sound. One acceptance criterion is demonstrably not met, plus two minor robustness/maintainability issues.

## Findings (ranked)

### 1. BLOCKER — embedding degradation is never written to Redis, so `/api/health` can never surface it (AC 13 gap)

`src/server/sync.ts:223-228` and `src/app/api/health/route.ts:23-24`

On an `embedBatch` failure, `runSync` does `degraded.push('embedding')` (in-memory `SyncResult` only). It never calls `redis.set(degradedKey('embedding'), '1')`, and on the success path it never `redis.del(degradedKey('embedding'))`. But `/api/health` sources `degraded` from Redis only (AC 18) and explicitly reads `degradedKey('embedding')`. Because that key is written nowhere, the `'embedding'` flag is always `null`.

Failure scenario: NIM is down. Cron runs. `runSync` returns `degraded: ['embedding']` (correct, logged by the cron route). On-call polls `GET /api/health` → response is `degraded: []`. The outage is invisible on the exact endpoint AC 13 and the "Embedding failure signal" Resolved decision require it to surface. Provider degradation, by contrast, correctly persists in Redis (AC 17).

Also a test-net hole: `sync.test.ts` only asserts in-memory `result.degraded`; the route test hand-feeds `mget` a fixed array. Neither exercises the writer→Redis→route path for embedding.

Fix: in the `catch`, `await redis.set(degradedKey('embedding'), '1')`; on the embed-success path, `await redis.del(degradedKey('embedding'))` (symmetric with the provider flags). Add a test asserting the Redis set/clear for embedding.

### 2. MINOR — `embedBatch` never asserts `vectors.length === texts.length`; a dropped NIM entry silently misassigns vectors to rows

`src/server/pipeline/embed.ts:42-96`

The code defends against response _order_ but not response _count_. If NIM returns one fewer entry, `results.push(...vectors)` shifts every subsequent vector by one relative to the input texts, so `vectors[i]` for `dirtyRows[i]` is off-by-one, corrupting retrieval while `embedded` still reports the full count. The dim-check doesn't catch it (all vectors are the right length). Requires NIM to violate its 1:1 contract, so minor, but the guard is cheap and the plan promises "aligned 1:1 with input order."

Fix: after parsing each batch, throw if `parsed.data.data.length !== batch.length` (or verify the sorted `index` sequence is contiguous `0..n-1`).

### 3. MINOR — `sync.test.ts` re-implements `buildHotMarket` inside the cache mock; it can drift from the real helper

`src/server/sync.test.ts:52-63`

The cache mock hand-rolls a conditional-spread `buildHotMarket`. It matches today, but if `cache.ts`'s helper/`HotMarket` shape changes, this mock won't track it and the catalog assertions keep passing against a stale shape. The real shape is covered by `cache.test.ts` (AC 14), so blast radius is limited. Not a blocker — worth a comment or a shared test helper.

### Note (not a defect) — AC 6 is only asserted at the mocked-unit level

`sync.test.ts` honestly documents that `db` is mocked, so row-count/no-dupes/`updatedAt` are guaranteed by `@@unique` + Prisma `upsert`/`@updatedAt` at integration level. Acceptable given no live DB in the unit suite.

## Acceptance criteria

| AC                                                               | Status                                     |
| ---------------------------------------------------------------- | ------------------------------------------ |
| 1 Promise.allSettled                                             | Covered                                    |
| 2 degraded = rejected names                                      | Covered                                    |
| 3 single rejection never throws                                  | Covered                                    |
| 4 toProviderEnum boundary, no toUpperCase                        | Covered                                    |
| 5 Decimal for money/prob                                         | Covered                                    |
| 6 upsert key (provider,externalId)                               | Covered (unit-level; integration deferred) |
| 7 malformed row skipped                                          | Covered                                    |
| 8 rawTrimmed bounded                                             | Covered                                    |
| 9 textHash = sha256                                              | Covered                                    |
| 10 embed only new/changed                                        | Covered                                    |
| 11 bounded batches                                               | Covered                                    |
| 12 embedded = re-embedded count                                  | Covered                                    |
| 13 embed throw → intact + degraded + **/api/health surfaces it** | **PARTIAL / GAP (Finding 1)**              |
| 14 catalog shape, no embedding                                   | Covered                                    |
| 15 atomic pipelined write                                        | Covered                                    |
| 16 LAST_SYNC advances in degraded mode                           | Covered                                    |
| 17 degradedKey set/clear                                         | Covered                                    |
| 18 /api/health triple, Redis only                                | Covered                                    |
| 19 pre-first-sync null/0/[]                                      | Covered                                    |
| 20 no auth/db/provider                                           | Covered                                    |
| 21 pgvector + HNSW authored                                      | Covered                                    |

## Verdict

The design is otherwise solid — the `$executeRaw` vector write is genuinely parameterized, the dim invariant is enforced, the `NEW_ROW_HASH` + `textHash`-omitted-from-`update` scheme correctly retries a failed first embed and never leaves a corrupt `(hash, vector)` pair, and the catalog write is atomic and embedding-free. But AC 13's requirement that embedding degradation surface on `/api/health` is not met and is untested.

VERDICT: CHANGES REQUESTED

Ranked, confirmed:

1. BLOCKER — `degradedKey('embedding')` never set/cleared in Redis; `/api/health` can never report embedding degradation (AC 13) — `src/server/sync.ts:223-228`.
2. MINOR — `embedBatch` doesn't guard `vectors.length === texts.length` — `src/server/pipeline/embed.ts:42-96`.
3. MINOR — duplicated `buildHotMarket` in `sync.test.ts` cache mock can drift — `src/server/sync.test.ts:52-63`.

---

## Re-review (round 2) — after fixes

All three findings verified fixed against a green run (76/76 total, +3 new tests):

- **Finding 1 (BLOCKER, AC 13) — fixed.** `sync.ts` now `redis.set(degradedKey('embedding'),'1')` on `embedBatch` throw and `redis.del(...)` on success (symmetric with provider flags). Writer→Redis→route round-trip closes, so an embedding outage now surfaces as `degraded:['embedding']` on `/api/health`. New tests assert set-on-throw and del-on-success (and that `set` is not called on the success path). The `del` also fires on the zero-dirty-rows case, but a row that failed to embed keeps a stale `textHash` and stays dirty → re-flags next cycle, so `/api/health` cannot flap "healthy" during a real outage. If `writeEmbedding`'s `$executeRaw` throws after a successful `embedBatch`, control reaches `catch` and the flag is set — correct.
- **Finding 2 (MINOR) — fixed.** `embed.ts` throws `EmbeddingCountError` when `parsed.data.data.length !== texts.length`, before the sort/flatten, so no off-by-one misalignment is possible; empty-input path unaffected. New test covers the short-batch case.
- **Finding 3 (MINOR) — fixed safely.** The cache mock delegates to the real `buildHotMarket` via `importOriginal`; `server-only`/`@/config/env`/`@upstash/redis` are neutralized so no real Redis/HTTP runs under test.

No new issues. All previously-passed criteria untouched.

VERDICT: APPROVE

---

## Round 3 — post-merge-prep hardening (second external review)

A second review raised 5 findings; 4 were actioned (the 5th, a loop-style nit, was
intentionally left). Fixes confined to `src/server/sync.ts` + `src/server/cache.ts`
(+ tests). Reviewer re-checked the diff against 6 verification points — all clean.

- **Finding 1 (MEDIUM) — silent hot-catalog wipe.** `runSync` wrote the catalog on
  any fulfilled provider regardless of how many rows survived Zod, so a 200 +
  schema-break (`valid=[]`) silently overwrote the catalog with `[]` and set no
  degraded flag. **Fixed:** per-provider raw→valid filtering; a provider returning
  rows that all fail validation is now flagged degraded; catalog write guarded by
  `shouldWriteCatalog = anyProviderOk && !(fetched > 0 && valid.length === 0)` —
  preserves the last good catalog on an all-malformed run, still writes `[]` on a
  genuinely empty fetch. `fetched` still = raw count (AC 7).
- **Finding 2 (LOW) — dedup.** Valid rows deduped by `(provider, externalId)`
  (first-wins) before upsert/embed, so a duplicate `externalId` can't double-embed
  or inflate `upserted`/`embedded`.
- **Finding 3 (LOW) — accurate `embedded`.** Now incremented per successful
  `writeEmbedding`; a mid-loop write failure reports the count that actually landed
  (not 0) while still setting `degraded:['embedding']`.
- **Finding 5 (NIT) — `closeTime`.** `HotMarketSchema.closeTime` →
  `z.string().datetime().optional()` (documented whole-array fail-open tradeoff).
- **Finding 4 (NIT) — loop style.** Not changed (churn, no benefit).

Gate re-run green: typecheck · lint · test **84/84** · evals · build (`SKIP_ENV_VALIDATION=1`).

VERDICT: APPROVE (round 3)
