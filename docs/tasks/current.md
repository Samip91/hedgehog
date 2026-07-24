# Current

> Every session (human or agent) reads this file first. Keep it to what's in
> flight right now. Move finished items to `done.md`, upcoming ones to `backlog.md`.

## In progress

- `feature: saved-hedges` — anon httpOnly-cookie identity, idempotent save
  (`POST /api/hedges`, client-uuid upsert, 403 on foreign re-save), list
  (`GET /api/hedges`) + detail (`GET /api/hedges/[id]`, 404 no-existence-leak) +
  DELETE, and **lazy on-read settlement** (pure `settle()` off DB `MarketSnapshot` —
  RESOLVED win/loss + OPEN mark-to-market; ADR 007). UI: a "Save this hedge" button
  on the proposal (navigate to `/hedge/[id]`), the `/hedges` list + `/hedge/[id]`
  detail pages, confirm-delete. Backend + frontend built in parallel. Branch
  `feature/saved-hedges`. Code complete, reviewer **APPROVED (1 round)**, full
  offline gate green (typecheck · lint · test 344/344 · evals · build w/
  `SKIP_ENV_VALIDATION=1`). **Not merged** — run `/ship` (PR to `develop`, no AI
  attribution). Settlement uses last-synced DB prices (may be stale); a fresh live
  price is deferred to `feature: live-price`. Integration pending (DB unprovisioned).

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
