# Current

> Every session (human or agent) reads this file first. Keep it to what's in
> flight right now. Move finished items to `done.md`, upcoming ones to `backlog.md`.

## In progress

- `feature: parse` — `parseRisk()`: NIM chat (`LLM_PARSE_MODEL`) → JSON-only
  `HedgeSpec`, Zod `safeParse` + one retry feeding the error back, degraded
  keyword-only fallback; injection-safe two-role prompt; `evals/run.ts` wired with
  a `parsePassRate ≥ 0.85` gate (offline via a committed DI fixture — ADR 002).
  Branch `feature/parse-hedgespec`. Code complete, reviewer **APPROVED** (2 rounds
  — 1 major + 2 minors fixed), full offline gate green (typecheck · lint · test
  115/115 · evals 100% · build w/ `SKIP_ENV_VALIDATION=1`). **Not merged** — run
  `/ship` (PR to `develop`). **Pending:** refresh `evals/fixtures/parse-responses.json`
  against live NIM via `pnpm evals:live` (offline fixture is hand-authored; sandbox
  can't reach NIM).

- `feature: providers-day1` — Kalshi + Polymarket clients + `http.ts` (retry +
  breaker) + normalizers, with fixtures and tests. Code complete + reviewed;
  offline gate green. **Pending:** run `pnpm verify:providers` locally to confirm
  500+ live markets (sandbox can't reach the provider APIs).

## Up next

- `feature: retrieval` — query embedding + hybrid retrieve (pgvector HNSW +
  keyword) + fixture recall@15 eval.

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
