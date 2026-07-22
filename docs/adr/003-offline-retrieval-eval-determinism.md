# ADR 003: Deterministic offline retrieval evals via injected seams and a toy bag-of-words embedder

**Status:** Accepted
**Feature:** retrieval (`docs/features/retrieval-hybrid/`)

## Context

Hybrid retrieval needs pgvector cosine (Postgres-only) and a NIM query embedding,
but `pnpm evals` must be deterministic, secret-free, and green in CI with **no
Postgres and no NIM** (restated in the spec's Open Questions and
`docs/tasks/current.md`). `evals/fixtures/catalog.json` has **no** embedding vectors
despite the README's stale "pre-computed embeddings" claim. ADR 002 already
established a function-level DI seam (`parseRisk(prompt, { chat })`) + committed
fixtures as the house pattern; `evals/run.ts` is a plain `tsx` script that cannot
`vi.mock`.

## Decision

1. `retrieveCandidates(spec, rawPrompt, deps?: RetrieveDeps)` exposes three seams —
   `embed` (default `embedText`), `vectorTopK` (default `pgvectorTopK` via
   `$queryRaw`), `keywordPool` (default `loadOpenMarketPool` via Prisma `findMany`).
   The defaults are the only code that touches NIM/Postgres.
2. Offline evals inject all three from `evals/lib/toy-embed.ts`. **No vectors are
   committed**: a deterministic bag-of-words hash embedder (`toyEmbed`, 64-d,
   L2-normalized, FNV-1a bucketing) computes both the query vector and each market
   vector from `searchText` at eval time; `cosineSim` is the in-process cosine. This
   validates retrieval **logic** (filters, scoring, dedupe, ranking), explicitly not
   embedding **quality** — closed later by `evals:live` against a real DB + NIM.
3. Retrieval eval cases carry no `HedgeSpec`; the runner synthesizes a permissive
   minimal spec (`deadline: null`, `confidence: 'low'`) so recall is ranking-driven;
   filter behavior is covered by unit tests.
4. Config knobs (top-50/top-15, weights, liquidity floor, deadline window) are
   exported **module constants** in `retrieve.ts`, not `env` vars — no
   tune-without-deploy need, and it keeps evals' `SKIP_ENV_VALIDATION=1` path clean.

Chosen over committing hand-authored 1024-d vectors (would drift from fixture text,
bloat the repo) and over an env-gated fetch shim (a real DI seam is shared by the tsx
runner _and_ vitest units, eliminating divergence — same reasoning as ADR 002).

## Consequences

- Positive: hermetic, secret-free CI evals; the same seams serve unit tests (inject
  fixed `ScoredMarket[]` / throwing `embed`); no new env vars; no live DB/NIM
  dependency; self-refreshing fixtures (vectors derived from text).
- Negative / accepted: `toyEmbed` can't demonstrate semantic ("hybrid beats keyword")
  wins — that's `evals:live`'s job; the 2-market catalog keeps recall@15 a smoke test
  until the deferred catalog-growth follow-up.
- Follow-ups: grow `catalog.json` with distractors + a cross-provider duplicate pair;
  persist `url`/slug on `MarketSnapshot` for faithful deep links; consider
  embedding-threshold paraphrase dedupe.
