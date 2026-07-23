# Current

> Every session (human or agent) reads this file first. Keep it to what's in
> flight right now. Move finished items to `done.md`, upcoming ones to `backlog.md`.

## In progress

- `feature: propose` — wires the 4-stage pipeline (`parse → retrieve → rerank →
buildProposal`) behind `POST /api/hedge`: sized `HedgeProposal` (payoff math via
  `hedgeMath`, invalid-price matches dropped, `.finite()` schema backstop), a narrow
  `/api/hedge`-only fixed-window rate limiter (10/10min per IP, atomic `SET NX EX`
  init, fail-open — ADR 005), and the `requestHedge()` client return-type fix. Branch
  `feature/propose-hedge`. Code complete, reviewer **APPROVED** (1 round + 2 minors
  fixed — rate-limit orphan guard + schema backstop), full offline gate green
  (typecheck · lint · test 206/206 · evals unchanged · build w/ `SKIP_ENV_VALIDATION=1`).
  **Not merged** — run `/ship` (PR to `develop`, no AI attribution in the body).
  First end-to-end pipeline composition; persistence deferred to `feature: saved-hedges`.

- `feature: providers-day1` — Kalshi + Polymarket clients + `http.ts` (retry +
  breaker) + normalizers, with fixtures and tests. Code complete + reviewed;
  offline gate green. **Pending:** run `pnpm verify:providers` locally to confirm
  500+ live markets (sandbox can't reach the provider APIs).

## Up next

- `feature: ui-ask-proposal` — Proposal screen (stake slider, payoff diagram)
  rendering the `HedgeProposal` from `feature: propose`.

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
