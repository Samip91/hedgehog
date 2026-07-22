# Current

> Every session (human or agent) reads this file first. Keep it to what's in
> flight right now. Move finished items to `done.md`, upcoming ones to `backlog.md`.

## In progress

- `feature: rerank` — LLM rerank (large model, `LLM_RERANK_MODEL`) over the top-15
  `Candidate[]` → up to 3 `RankedMatch` (correct YES/NO `side`, `relevance`
  high/partial/weak, one-sentence reasoning); subset-only mapping, one
  retry-on-invalid, injection-safe two-role prompt, `[]`-only degraded fallback
  (guardrail). Headline: extracted the shared `nim-chat.ts` client out of `parse.ts`
  (ADR 004) — behavior-preserving, `parse.test.ts` green unmodified. Branch
  `feature/rerank-llm`. Code complete, reviewer **APPROVED** (1 round + a missing-
  fixture loud-error fix), full offline gate green (typecheck · lint · test 169/169 ·
  evals: parse 100%, retrieval recall@15 100%, rerank 100% · build w/
  `SKIP_ENV_VALIDATION=1`). **Not merged** — run `/ship` (PR to `develop`).

- `feature: providers-day1` — Kalshi + Polymarket clients + `http.ts` (retry +
  breaker) + normalizers, with fixtures and tests. Code complete + reviewed;
  offline gate green. **Pending:** run `pnpm verify:providers` locally to confirm
  500+ live markets (sandbox can't reach the provider APIs).

## Up next

- `feature: propose` — hedge math wiring + `/api/hedge` end-to-end (consumes
  `RankedMatch[]` from `rerank`). Then `feature: ui-ask-proposal`.

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
