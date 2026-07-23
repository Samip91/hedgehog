# Current

> Every session (human or agent) reads this file first. Keep it to what's in
> flight right now. Move finished items to `done.md`, upcoming ones to `backlog.md`.

## In progress

- `feature: ui-ask-proposal` — Proposal screen (parsed-risk card, best-match
  sized/unsized cards, native stake slider re-running client-side `computeHedge`,
  Recharts 2-outcome payoff diagram, compact alternatives, no-hedge/error states)
  rendering the `HedgeProposal` inline from `feature: propose`. First **frontend**
  slice — also stood up the UI test infra (Vitest jsdom project + Testing Library,
  isolated from the 206 backend node tests — ADR 006) + first Playwright e2e.
  Branch `feature/ui-ask-proposal`. Code complete, reviewer **APPROVED (1 round)**,
  full offline gate green (typecheck · lint · test 269/269 · evals · build w/
  `SKIP_ENV_VALIDATION=1`). **Not merged** — run `/ship` (PR to `develop`, no AI
  attribution). Deferred: slider/diagram on alternatives; live price refresh; a
  live-pipeline e2e (the smoke stubs `/api/hedge`).

- `feature: providers-day1` — Kalshi + Polymarket clients + `http.ts` (retry +
  breaker) + normalizers, with fixtures and tests. Code complete + reviewed;
  offline gate green. **Pending:** run `pnpm verify:providers` locally to confirm
  500+ live markets (sandbox can't reach the provider APIs).

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
