# Current

> Every session (human or agent) reads this file first. Keep it to what's in
> flight right now. Move finished items to `done.md`, upcoming ones to `backlog.md`.

## In progress

- `feature: retrieval` — query embedding (`embedText`, NIM `input_type: 'query'`)
  - hybrid retrieve (pgvector HNSW cosine top-50 via typed `$queryRaw` + keyword +
    liquidity boost, hard filters, cross-provider dedupe, top-15) + degraded
    keyword-only fallback when the embedding API is down; `evals/run.ts` wired with
    a `recall@15 ≥ 0.85` gate + report-only MRR, deterministic/offline via an
    injected-seam + toy-embedder (ADR 003). Branch `feature/retrieval-hybrid`. Code
    complete, reviewer **APPROVED** (1 round + a report-only-MRR min-rank fix), full
    offline gate green (typecheck · lint · test 139/139 · evals: parse 100%,
    retrieval recall@15 100% / MRR 1.0 · build w/ `SKIP_ENV_VALIDATION=1`).
    **Not merged** — run `/ship` (PR to `develop`). Follow-ups (deferred, backlogged):
    grow `evals/fixtures/catalog.json` beyond 2 markets so recall@15/MRR discriminate;
    persist `url`/slug on `MarketSnapshot` for faithful deep links.

- `feature: providers-day1` — Kalshi + Polymarket clients + `http.ts` (retry +
  breaker) + normalizers, with fixtures and tests. Code complete + reviewed;
  offline gate green. **Pending:** run `pnpm verify:providers` locally to confirm
  500+ live markets (sandbox can't reach the provider APIs).

## Up next

- `feature: rerank` — LLM rerank + relevance labels, consuming `Candidate[]`
  from `retrieveCandidates()`.

## Notes

- DB is not provisioned yet — Prisma migrations authored, not applied. The
  pgvector + HNSW migration (`prisma/sql/001_enable_pgvector.sql`) is authored,
  not applied. Apply it against a real Postgres before the sync integration check.
- Remote `origin` = `git@github.com:Samip91/hedgehog.git`. `/ship` merges via a
  GitHub **PR** to `develop` — the branch-guard hook blocks local `develop`/`main`
  commits (never `--no-verify`). Enable "auto-delete head branches" in repo settings
  to auto-clean merged branches (`origin/feature/sync-catalog` is still lingering).
- Deferred out of `feature: sync`: market lifecycle CLOSED/RESOLVED transitions
  (stale DB rows are harmless — the hot catalog only carries the latest fetch).
- LLM chat client lives local to `parse.ts`; extract a shared `nim-chat.ts` when
  `feature: rerank` adds the second chat caller (ADR 002).
