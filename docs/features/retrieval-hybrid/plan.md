# Plan: retrieval (hybrid candidate retrieval)

## Branch

`feature/retrieval-hybrid`

## Approach

`retrieveCandidates(spec, rawPrompt)` becomes a small, deterministic pipeline around two I/O seams — a **query embedder** and a **vector source** — mirroring the DI precedent that `parseRisk(prompt, { chat })` set in ADR 002. The default seams touch NIM and Postgres; offline evals and unit tests inject in-process substitutes, so `pnpm evals` stays green in CI with **no NIM and no Postgres**.

Control flow (satisfies AC 5–16):

```
queryText = spec.riskDescription                       // the field the schema marks "what gets embedded"
try   q = await embed(queryText)                        // embedText → throws on any failure (AC 3)
      scored = await vectorTopK(q, VECTOR_TOP_K)         // ONE $queryRaw, ≤50, cosine set (AC 14)
catch (embed failed) →                                  // AC 15: degraded, never rethrow
      pool = await keywordPool()                         // Postgres findMany, no vector
      scored = pool.map(m => ({ market: m, cosine: 0 }))
survivors = scored.filter(s => passesHardFilters(s.market, spec))   // AC 5–8, applied identically both modes (AC 16)
cands     = survivors.map(s => scoreCandidate(s, spec, rawPrompt))  // keyword + liquidityBoost + exact combine (AC 9)
deduped   = dedupeByQuestionSignature(cands)            // keep higher score (AC 11), BEFORE the cut
return deduped.sort(byScoreThenStableId).slice(0, MAX_CANDIDATES)   // AC 10, 12, 13
```

Reused, do-not-reinvent: `embedOneBatch`'s fetch/parse/count/dim-check plumbing and `EmbeddingDimError`/`EmbeddingCountError` (`src/server/pipeline/embed.ts`); the `$executeRaw` `[...]::vector` + `::"Provider"` cast idiom from `writeEmbedding`/ADR 001 (mirror it on the read side with `<=>`); `fromProviderEnum` (`provider-enum.ts`) and the status-enum casing pattern from `sync.ts`'s `STATUS_TO_ENUM`; `NormalizedMarket` (`providers/types.ts`) as the `Candidate.market` shape (unchanged); the `vi.hoisted` + `@/server/db` / `@/server/http` mock style from `sync.test.ts` and `embed.test.ts`; the frozen-fixture + injected-seam offline eval mechanism from ADR 002.

## File map

**Create**

- `src/server/pipeline/retrieve.test.ts` — unit tests: each hard filter, the pure combine formula, dedupe, top-15 truncation / short-return, degraded mode, and the "one `$queryRaw`, LIMIT ≤ 50" assertion.
- `evals/lib/toy-embed.ts` — `toyEmbed(text): number[]` (deterministic bag-of-words hash) + `cosineSim(a, b)`; the offline query/market vector source (eval-only, no network).

**Modify**

- `src/server/pipeline/embed.ts` — implement `embedText`; extract a private `nimEmbed(texts, inputType)` (the current `embedOneBatch` body, `input_type` parametrized) that both `embedOneBatch` (`'passage'`) and `embedText` (`'query'`) delegate to (AC 4, no duplication).
- `src/server/pipeline/embed.test.ts` — add `embedText` cases (query `input_type`, dim mismatch, failure propagation).
- `src/server/pipeline/retrieve.ts` — implement `retrieveCandidates` + `RetrieveDeps`/`ScoredMarket` types + module constants + pure helpers (`passesHardFilters`, `keywordScore`, `liquidityBoost`, `combineScore`, `dedupeByQuestionSignature`, `questionSignature`) + default seams (`pgvectorTopK`, `loadOpenMarketPool`) + row→`NormalizedMarket` mappers (`deriveMarketUrl`, Decimal→number, status/provider casing).
- `evals/run.ts` — wire the retrieval loop: build an offline `RetrieveDeps` from `catalog.json` + `toyEmbed`, run each case, compute recall@15 (gate < 0.85) and MRR (report-only), print per-case pass/fail.
- `evals/README.md` — correct the stale "pre-computed embeddings" claim (catalog carries **no** vectors; offline cosine comes from the deterministic `toyEmbed`).
- `docs/tasks/current.md` — move `feature: parse` to done (merged); move `feature: retrieval` from "Up next" to "In progress" with this branch.

No change to `Candidate` / `HedgeSpec` / `HotMarket` / `NormalizedMarket` (fixed contracts), `src/config/env.ts` (no new vars — knobs are module constants), `prisma/schema.prisma`, or the `package.json` `evals` script (already `SKIP_ENV_VALIDATION=1 tsx --conditions=react-server`).

## Resolved open questions

**1 — Offline-eval determinism → DI seams + a deterministic toy embedder, no committed vectors, no DB.** `retrieveCandidates(spec, rawPrompt, deps: RetrieveDeps = {})` exposes three optional seams:

```ts
export interface ScoredMarket {
  readonly market: NormalizedMarket
  readonly cosine: number
}
export interface RetrieveDeps {
  embed?: (text: string) => Promise<number[]> // default: embedText (NIM)
  vectorTopK?: (q: number[], k: number) => Promise<ScoredMarket[]> // default: pgvectorTopK ($queryRaw)
  keywordPool?: () => Promise<NormalizedMarket[]> // default: loadOpenMarketPool (Prisma findMany)
}
```

Offline `evals/run.ts` loads `catalog.json` → `NormalizedMarket[]` and injects all three from `evals/lib/toy-embed.ts`. `toyEmbed` is a **bag-of-words hashing embedding**: lowercase → `text.match(/[a-z0-9]+/g)` → for each token, `v[fnv1a(token) % 64] += 1` → L2-normalize (all-zero stays zero). `cosineSim` = dot of normalized vectors (0 for a zero vector). The query shares surface tokens with the relevant market's `searchText`, so the expected market ranks at cosine rank 1 — validates **filter/scoring/dedupe/ranking logic**, explicitly **not** real embedding quality (`evals:live`'s job). **No vectors committed to `catalog.json`** — both query and market vectors derive from `searchText` at eval time, so nothing goes stale. Unit tests bypass `toyEmbed` and inject fixed `ScoredMarket[]` / throwing `embed`.

Retrieval cases carry no `HedgeSpec`, so the runner synthesizes a **permissive minimal spec** per case: `{ riskDescription: prompt, domain: 'other', direction: 'happens', exposureUsd: null, deadline: null, location: null, asset: null, threshold: null, confidence: 'low', clarificationNeeded: null }`. With `deadline: null` and `confidence: 'low'`, only status + liquidity-floor filters bite (both fixtures pass), so recall is ranking-driven; domain/confidence/closeTime filters are covered by unit tests.

**2 — Eval catalog growth → DEFERRED (spec scopes it out).** The 2-market catalog makes recall@15 a smoke test. Backlog follow-up: grow `catalog.json` to ~10–15 markets with same-domain distractors + a cross-provider near-duplicate pair. Not this slice (mirrors parse's "don't grow `cases.json` mid-feature").

**3 — Config knobs → module constants in `retrieve.ts`** (matches `BATCH_SIZE` in `embed.ts`; keeps env surface + CI secrets untouched, decisive since evals run `SKIP_ENV_VALIDATION=1`). Exported for tests:
`VECTOR_TOP_K = 50`, `MAX_CANDIDATES = 15`, `WEIGHT_COSINE = 0.6`, `WEIGHT_KEYWORD = 0.25`, `WEIGHT_LIQUIDITY = 0.15`, `LIQUIDITY_FLOOR_USD = 1_000`, `LIQUIDITY_FULL_BOOST_USD = 500_000`, `DEADLINE_WINDOW_DAYS = 30`, `DEGRADED_POOL_SIZE = 200`.

**4 — Keyword score → token coverage of the query by the market, in [0,1].** Query tokens = `tokenize( [riskDescription, location, asset, threshold, rawPrompt].filter(Boolean).join(' ') )`; market tokens = `tokenize(market.searchText)`; `tokenize(s) = new Set((s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(t => t.length >= 2))`. Then `keyword = queryTokens.size === 0 ? 0 : |queryTokens ∩ marketTokens| / queryTokens.size`. Coverage (not Jaccard) so a verbose market isn't penalized; no stemming (exactly assertable). Empty query set → `0`, never NaN. Uses `rawPrompt` so literal user terms the normalized restatement dropped still count.

**5 — Read path.**

- **Normal:** a single `pgvectorTopK` `$queryRaw` returns the nearest ≤50 **open** rows with all scalar columns + `searchText` + a computed `cosine`. Keyword scoring runs over those same 50 rows — no second read (AC 14).
- **Degraded (embed failed):** `loadOpenMarketPool` reads Postgres via `db.marketSnapshot.findMany({ where: { status: 'OPEN' }, orderBy: { liquidityUsd: 'desc' }, take: DEGRADED_POOL_SIZE, select: <scalars> })` — bounded, Prisma omits the `Unsupported` embedding column. **Not** Redis: `HotMarket` lacks `question`/`url`, can't build a valid `NormalizedMarket`; degraded is a NIM outage, not a Postgres outage. Full hard-filter set applied in JS uniformly for both modes (AC 16).

**6 — Cross-provider dedupe → normalized question-token signature.** `questionSignature(question)` = tokenize (`/[a-z0-9]+/g`, len ≥ 2), drop a tiny stopword set (`will,the,a,an,in,on,of,to,this,be,is,at,by`), dedupe, **sort**, join. Equal signatures dedupe; higher `score` survives (tie-break `provider` then `externalId`). Numeric tokens kept, so "below 60000" ≠ "below 70000". Tradeoff (documented): catches same-significant-token duplicates, not free paraphrases; embedding-threshold dedupe is a later refinement.

## Design details

**`embedText` (AC 1–4).** Extract `embedOneBatch` body into `async function nimEmbed(texts, inputType: 'passage' | 'query')` (identical fetch/parse/count-check/index-sort/dim-check, only `input_type` parametrized). Then `embedOneBatch` delegates with `'passage'` (unchanged behavior); `embedText(text)` calls `nimEmbed([text], 'query')`, takes `vectors[0]` with an explicit undefined check (no `!`, throw `EmbeddingCountError`), returns it (dim-checked inside `nimEmbed`; throws propagate).

**`pgvectorTopK` (`$queryRaw`, ADR 001 read-side idiom).**

```ts
const literal = `[${queryVector.join(',')}]`
const rows = await db.$queryRaw`
  SELECT provider, "externalId", question, "eventTitle", "searchText", category,
         "yesPrice", "noPrice", "volumeUsd", "liquidityUsd", "closeTime",
         status, "resolvedYes", 1 - (embedding <=> ${literal}::vector) AS cosine
  FROM "MarketSnapshot"
  WHERE embedding IS NOT NULL AND status = 'OPEN'::"MarketStatus"
  ORDER BY embedding <=> ${literal}::vector
  LIMIT ${VECTOR_TOP_K}`
```

`<=>` = cosine distance; similarity = `1 - distance`. Raw rows validated through a `VectorRowSchema` (Zod at the boundary) coercing `Decimal`→`number`, then mapped to `ScoredMarket` via the shared `snapshotToNormalized` mapper.

**Row → `NormalizedMarket` mapper (shared by both default seams).** `fromProviderEnum(provider)`; `MarketStatus`→lowercase via `{ OPEN:'open', CLOSED:'closed', RESOLVED:'resolved' }`; `Decimal`→`number`; `closeTime: Date|null → Date|undefined`; `null`→`undefined`; `url = deriveMarketUrl(provider, externalId)`. **Known gap (deferred):** `MarketSnapshot` persists no `url`/slug, so the derived URL is best-effort — invisible to this slice (URLs not eval-tested; rerank/propose out of scope). Persisting `url`/slug is a follow-up.

**`scoreCandidate`/`combineScore` (AC 9, 10).** `liquidityBoost(m) = m.liquidityUsd == null ? 0 : clamp(m.liquidityUsd / LIQUIDITY_FULL_BOOST_USD, 0, 1)`. `combineScore(cosine, keyword, boost) = 0.6*cosine + 0.25*keyword + 0.15*boost` — pure, unit-tested with fixed inputs. `Candidate` = `{ market, cosine, keyword, score }` (boost intermediate). Sort: `score` desc, tie-break `provider` asc then `externalId` asc (total order on the `@@unique` key → identical output across runs).

**Hard filters (AC 5–8), applied identically both modes.**

- status: `market.status === 'open'`.
- closeTime window: `spec.deadline` non-null → require `closeTime` present and `<= deadline + DEADLINE_WINDOW_DAYS days` (missing closeTime excluded); null → no filter.
- liquidity floor: exclude only when `liquidityUsd` is present **and** `< LIQUIDITY_FLOOR_USD` (unknown liquidity is not "below floor"; gets boost 0).
- domain: only when `confidence === 'high'`, require `market.category === spec.domain`; medium/low → not a hard filter.

**Eval runner (`evals/run.ts`).** Load `catalog.json` → `NormalizedMarket[]`; build offline `deps`. Per case: `cands = await retrieveCandidates(specForCase(c.prompt), c.prompt, deps)`; `top = cands.map(x => x.market.externalId)`; `recall = |expected ∩ top| / |expected|`; `rank` = 1-based index of first hit, `rr = rank ? 1/rank : 0`. Per-case pass = `recall === 1`; print `·/✗` + recall + rr. `overallRecall = mean`; gate `< 0.85`; MRR report-only. Replaces the structural-only loop + "not yet wired" TODO.

## Tests & evals — AC → seam map

All unit tests: no NIM, no Postgres (`vi.mock('@/server/db')`/`@/server/http`/`@/config/env`, `vi.hoisted`).

- **AC 1–3** — `embedText`: `body.input_type === 'query'`, `input: [text]`; wrong-length → `EmbeddingDimError`; `fetchJson` rejects → rejects.
- **AC 4** — structural: both delegate to `nimEmbed`.
- **AC 5,6,7,8,16** — inject `keywordPool`(throwing `embed`) or `vectorTopK` fixtures; closed / 40-days-past / no-closeTime-with-deadline / below-floor / high-conf wrong-category never appear, both modes.
- **AC 9** — `combineScore(0.5,0.4,0.2)` exact; `liquidityBoost(undefined) === 0`.
- **AC 10** — identical fixtures twice → identical order.
- **AC 11** — same-signature pair → one survives (higher score).
- **AC 12,13** — 20 survivors → 15; 2-market fixtures → ≤2, not padded.
- **AC 14** — mock `db.$queryRaw`; called exactly once, `LIMIT ≤ 50`.
- **AC 15** — `embed` rejects → resolves non-empty, every `cosine === 0`, never throws.
- **AC 17–21** — `pnpm evals` offline: recall@15 ≥ 0.85 gate + MRR; both cases pass; zero network/DB.

## Key risks & mitigations

1. **`$queryRaw` typing / Unsupported column.** Never `SELECT embedding` into JS; use it only inside `<=>`/`1 - (…)`/`IS NOT NULL`. Validate rows via `VectorRowSchema` (Zod), coerce `Decimal`→`number`, cast `::vector`/`::"MarketStatus"` per ADR 001. Real pgvector behavior is an `evals:live`/integration concern (DB unprovisioned).
2. **Row→`NormalizedMarket`.** Single shared mapper; URL gap documented/deferred.
3. **Degraded correctness.** Identical `passesHardFilters` both modes; try/catch wraps **only** `embed` — a Postgres failure propagates (degraded is for NIM outages).
4. **Offline fidelity.** `toyEmbed` validates logic only; model quality is `evals:live`. README corrected.
5. **Request-path-reads-DB (do NOT flag).** Retrieval reads Postgres + calls NIM embed on the request path — allowed; PITFALLS' "never call providers" = market-data providers only (same carve-out as parse/ADR 002).
6. **Determinism.** Total-order tie-break on `(provider, externalId)`; deterministic `toyEmbed`; module constants; offline injects all seams (never opens a DB connection).

**Deferred:** grow eval catalog (Q2); persist `url`/slug on `MarketSnapshot`; embedding-threshold dedupe; push closeTime/liquidity into KNN SQL; extract a shared NIM client. None block this slice.

See ADR: `docs/adr/003-offline-retrieval-eval-determinism.md`.
