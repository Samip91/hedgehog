# Feature: retrieval

## Problem / user value

Once `parseRisk()` turns free text into a `HedgeSpec`, Hedgehog still has no
way to find which of the hundreds of synced Kalshi/Polymarket markets are
actually relevant to that risk. Without hybrid retrieval, rerank and propose
have nothing to work with — the pipeline dead-ends after parse. This feature
makes `retrieveCandidates()` real: it embeds the user's risk, combines vector
similarity with keyword and liquidity signal under hard safety filters, and
hands rerank a small, high-precision shortlist (≤15) of candidate markets —
plus a fixture-driven recall/MRR eval so future model or weight changes don't
silently regress match quality.

## User stories

- As a user, I want my plain-English risk ("I lose $500 if it rains at my
  beach wedding") to surface the actual weather market that hedges it, even
  though I never typed the word "rain" in a market-searchable way, so that
  the app finds relevant markets from meaning, not just keyword overlap.
- As the rerank stage (`feature: rerank`, not built yet), I want a short,
  pre-filtered, pre-scored list of at most 15 candidates instead of the full
  catalog, so that the large-model rerank call stays cheap and its context
  window isn't wasted on obviously-irrelevant or expired markets.
- As Hedgehog, I want closed/resolved markets, markets closing long after the
  user's risk deadline, illiquid markets, and (when parse is confident)
  wrong-domain markets excluded before scoring even starts, so a plausible-
  sounding but unhedgeable or untradeable market never reaches the user.
- As Hedgehog, I want retrieval to keep working with keyword-only scoring
  when the embedding API is down, so a NIM outage degrades match quality
  rather than breaking the request pipeline (`/api/hedge` must still respond
  with the request path never calling a market-data provider).
- As a developer swapping the embedding model or tuning the `0.60/0.25/0.15`
  weights, I want a single `pnpm evals` command reporting recall@15 and MRR
  against a frozen fixture set, so I know immediately whether a change
  regressed retrieval quality.

No conflict with Hedgehog's hard non-goals: retrieval only reads Postgres/
Redis (never a provider, never a real order) and introduces no UI or
accounts.

## Acceptance criteria (testable)

**`embedText` — query embedding**

1. `embedText(text)` POSTs to `${env.NVIDIA_BASE_URL}/embeddings` with
   `input: [text]`, `model: env.EMBEDDING_MODEL`, and **`input_type: 'query'`**
   (not `'passage'`, unlike `embedOneBatch`/`embedBatch`), reusing the
   existing `fetchJson`/`NimEmbeddingsResponseSchema` plumbing. Test: mock
   `fetchJson`, assert the request body's `input_type === 'query'`.
2. `embedText` validates the single returned vector's length against
   `env.EMBEDDING_DIM`, throwing `EmbeddingDimError` on mismatch (mirrors
   `embedOneBatch`'s per-vector check). Test: mock a wrong-length vector →
   rejects with `EmbeddingDimError`.
3. `embedText` throws (never silently returns a zero/partial vector) on any
   HTTP failure or schema mismatch — `retrieveCandidates` (AC 15–16) is the
   only place that catches it. Test: mock `fetchJson` to reject → `embedText`
   rejects, doesn't resolve.
4. `embedText` does not duplicate the NIM request/response-parsing logic
   already in `embedOneBatch` (reviewer-checkable — e.g. delegates to it or a
   shared helper rather than re-implementing the fetch+parse+sort).

**Hard filters (applied before scoring, regardless of score)**

5. Only markets with `status === 'open'` ever appear in the returned
   candidates. Test: a closed/resolved fixture market is never returned even
   when it would otherwise score highest.
6. When `spec.deadline` is non-null: a candidate's `closeTime` (if present)
   must be `<= deadline + 30 days`; a market with no `closeTime` is excluded
   while a deadline is set (the window can't be verified). When
   `spec.deadline` is null, no `closeTime` filter is applied. Test: fixture
   market closing 40 days after `deadline` is excluded; one closing 10 days
   after is retained; with `deadline: null`, both are eligible.
7. A market whose `liquidityUsd` is below the configured liquidity floor
   (value: see Open Questions) is excluded regardless of score. Test: a
   below-floor fixture market never appears in output.
8. When `spec.confidence === 'high'`, only markets whose `category` matches
   `spec.domain` are included; for `'medium'`/`'low'` confidence, domain is
   **not** a hard filter (it may still inform keyword scoring). Test:
   high-confidence weather query excludes a same-catalog crypto market;
   medium-confidence query does not.

**Hybrid scoring**

9. Every surviving candidate gets `cosine` (pgvector cosine similarity to the
   query embedding), `keyword` (term-overlap signal — see Open Questions),
   and a `liquidityBoost` normalized to `[0, 1]` (missing `liquidityUsd`
   treated as `0`, never `NaN`/`undefined`), combined as exactly
   `score = 0.60·cosine + 0.25·keyword + 0.15·liquidityBoost`. Test: unit
   test on the combine function with fixed inputs asserts the exact formula.
10. Candidates are sorted descending by `score` with a deterministic tie-break
    (repeated runs over the same fixture input produce the same order). Test:
    run scoring twice on identical fixture input → identical ordered output.

**Cross-provider dedupe + top-15 output**

11. When two candidates represent the same underlying real-world market
    across providers, only the higher-scoring one survives before the top-15
    cut (equivalence key: see Open Questions). Test: a fixture pair of
    near-duplicate Kalshi/Polymarket markets yields exactly one candidate in
    the output.
12. `retrieveCandidates` never returns more than 15 candidates.
13. `retrieveCandidates` returns fewer than 15 (not padded, not duplicated)
    when fewer than 15 candidates survive filters + dedupe. Test: the
    2-market fixture catalog returns ≤2 candidates for either eval case.

**pgvector query**

14. `retrieveCandidates` issues at most one raw vector-similarity query per
    call (`db.$queryRaw`, typed, `::vector`-cast per ADR 001's idiom),
    requesting the nearest ≤50 markets by cosine distance to the query
    embedding — it never loads the full `MarketSnapshot` table into JS to
    compute distances itself. Test: mock `db.$queryRaw`, assert it's called
    exactly once (when `embedText` succeeds) with a bound `LIMIT` ≤ 50.

**Degraded mode (embedding API down → keyword-only, never throws)**

15. If `embedText` throws/rejects for the query text, `retrieveCandidates`
    catches it, skips the pgvector cosine query entirely, and still resolves
    with up to 15 candidates ranked by keyword + liquidityBoost alone
    (`cosine === 0` on every returned candidate) — it never throws or
    rejects to the caller. Test: mock `embedText` to reject → function
    resolves with a non-empty array for a matching fixture query, and every
    candidate has `cosine === 0`.
16. The degraded keyword-only path still applies every hard filter from AC
    5–8 (status, closeTime window, liquidity floor, domain-when-high-
    confidence). Test: closed/below-floor fixture markets are still excluded
    when `embedText` is mocked to fail.

**Eval wiring (`evals/run.ts`)**

17. For every case in `evals/retrieval-cases.json`, the runner computes
    per-case recall@15 = `|expectedMarketIds ∩ top-15 externalIds| /
|expectedMarketIds|`; overall recall@15 is the average across all cases,
    computed against the fixture catalog with zero live network/DB calls in
    offline mode (mechanism: see Open Questions).
18. The runner also computes MRR — `1 / rank` of the first expected-id hit
    within the top-15 (`0` if no hit) per case, averaged across cases — and
    prints it as a report-only number (no pass/fail gate on MRR).
19. `pnpm evals` exits non-zero if overall retrieval recall@15 `< 0.85`, in
    addition to the existing parse gate, printing per-case pass/fail plus the
    overall recall@15 and MRR.
20. Both existing cases (`beach-wedding-rain`, `btc-60k`) pass under the
    implemented pipeline — each case's single expected `externalId` appears
    somewhere in that case's top-15 output.
21. Offline `pnpm evals` stays deterministic and zero-network for retrieval
    (no live NIM call, no live Postgres) per whichever DI/fixture mechanism
    the tech-lead selects (see Open Questions) — CI must be able to run it
    with no secrets.

## Scope

**In:**

- `embedText(text): Promise<number[]>` implementation in
  `src/server/pipeline/embed.ts` (NIM query embedding, `input_type: 'query'`,
  dim-checked, throws on failure).
- `retrieveCandidates(spec, rawPrompt): Promise<Candidate[]>` implementation
  in `src/server/pipeline/retrieve.ts`: hard filters (status, closeTime
  window, liquidity floor, domain-when-high-confidence), pgvector HNSW
  cosine top-50 via typed `$queryRaw`, keyword scoring, liquidity boost,
  hybrid combine, cross-provider dedupe, top-15 cut.
- The keyword-only degraded fallback when `embedText` fails.
- Whatever DI/fixture seam the tech-lead selects to keep `pnpm evals`
  deterministic and network-free for retrieval (per ADR-002 precedent).
- Wiring `evals/run.ts`: recall@15 ≥ 0.85 gate, MRR reported.
- Unit tests: `embedText` (happy path, dim mismatch, failure propagation),
  `retrieveCandidates` (each hard filter, the hybrid formula, dedupe,
  top-15 truncation/padding behavior, degraded mode).

**Out (non-goals):**

- Rerank, propose, and the `/api/hedge` route end-to-end — later features
  that consume `Candidate[]`; this slice only produces it.
- Any UI — Hedgehog is a mobile-first PWA, but no frontend work is in this
  slice (consistent with `parse`/`sync` precedent).
- Provisioning a live Postgres or applying the pgvector/HNSW migration
  (`prisma/sql/001_enable_pgvector.sql`) — operational, `feature: ship`,
  already authored per `sync-catalog`'s AC 21.
- Changing `HedgeSpecSchema`, the `Candidate` shape, or `HotMarket` — all
  fixed contracts this feature reads/produces against, not reshapes.
- Growing `evals/fixtures/catalog.json` beyond its current 2 markets — the
  recall@15 gate stays a smoke test this slice (mirrors `parse`'s precedent
  of not expanding `cases.json` mid-feature); whether to grow it is called
  out below for a human/tech-lead decision, not resolved here.
- Validating real embedding-model _quality_ (only `pnpm evals:live` against a
  real DB + NIM can do that) — offline CI only validates retrieval _logic_
  (filters, scoring, dedupe, ranking) against fixtures.
- Rate limiting / abuse protection on the retrieval call itself —
  `feature: hardening`, per the `sync-catalog` precedent.

## Open questions (for the tech-lead)

- **Offline-eval determinism (the hard one).** Hybrid retrieve needs pgvector
  cosine, which lives only in Postgres, and the sandbox has neither a
  provisioned DB nor NIM access; `evals/fixtures/catalog.json` currently has
  **no embedding vectors** despite the README's claim of "pre-computed
  embeddings" (stale/aspirational text — flag for correction regardless).
  Tech-lead must pick: (i) commit deterministic embedding vectors for the
  fixture catalog + a query-embed fixture and compute cosine in-process (no
  live DB), or (ii) a `retrieveCandidates(spec, prompt, deps?)` DI seam
  (mirroring ADR 002's `parseRisk(..., { chat })`) feeding a fixture-backed
  vector store + injectable `embed`. Tradeoff either way: a hand-authored/toy
  embedding validates retrieval _logic_, not real embedding _quality_ — that
  gap is closed later via `evals:live` against a real DB.
- **Eval is weak with only 2 fixture markets** — top-15 of a 2-market catalog
  trivially recalls the 1 expected id per case. Decide/record whether growing
  the fixture catalog is in scope or explicitly deferred (spec currently
  scopes it out).
- **Config knobs.** Top-50/top-15, the `0.60/0.25/0.15` weights, the liquidity
  floor, and the `deadline + 30d` window are only prose today. Decide:
  hardcoded module constants vs. `env.ts` entries. (PO recommends module
  constants for this slice unless there's a near-term tune-without-deploy need.)
- **Keyword score definition.** Precise, testable definition — term overlap
  between `HedgeSpec.location`/`asset`/`threshold`/`riskDescription` and the
  market's `searchText`? Exact vs. normalized/stemmed? Needed before the
  test-writer can assert exact keyword scores.
- **Keyword/candidate read path.** Does keyword scoring (and the degraded-mode
  candidate pool, since pgvector KNN is unavailable when `embedText` fails)
  read Postgres `searchText` directly or the Redis hot catalog
  (`readHotCatalog`)? Determines how the degraded-mode pool (AC 15) is
  assembled without a vector KNN query.
- **Cross-provider dedupe key.** The equivalence rule for AC 11 — normalized-
  question match, a provider-pair mapping, or an embedding-similarity
  threshold between candidates?
