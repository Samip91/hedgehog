# Current

> Every session (human or agent) reads this file first. Keep it to what's in
> flight right now. Move finished items to `done.md`, upcoming ones to `backlog.md`.

## In progress

- `feature: sync` — cron sync, hash-diff embed → Redis hot catalog, `/api/health`,
  degraded flags, pgvector HNSW index (authored). Branch `feature/sync-catalog`.
  Code complete, reviewer **APPROVED** (3 rounds — 1 blocker + 2 minors, then a
  4-finding hardening pass incl. a silent catalog-wipe guard), full offline gate
  green (typecheck · lint · test 84/84 · evals · build w/
  `SKIP_ENV_VALIDATION=1` per CI). **Not committed/merged** — run `/ship` to
  squash-merge into `develop`. **Integration pending:** AC 5 (Decimal-on-wire)
  and AC 6 (no-dupe/`updatedAt`) are unit-mocked only — need a live Postgres +
  pgvector run to confirm end-to-end (see `docs/features/sync-catalog/review.md`).

- `feature: providers-day1` — Kalshi + Polymarket clients + `http.ts` (retry +
  breaker) + normalizers, with fixtures and tests. Code complete + reviewed;
  offline gate green. **Pending:** run `pnpm verify:providers` locally to confirm
  500+ live markets (sandbox can't reach the provider APIs).

## Up next

- `feature: parse` — HedgeSpec parse prompt (few-shots, retry-on-invalid) + evals.

## Notes

- DB is not provisioned yet — Prisma migrations authored, not applied. The
  pgvector + HNSW migration (`prisma/sql/001_enable_pgvector.sql`) is authored,
  not applied. Apply it against a real Postgres before the sync integration check.
- No git remote configured yet — add one before `/ship` can push.
- Deferred out of `feature: sync`: market lifecycle CLOSED/RESOLVED transitions
  (stale DB rows are harmless — the hot catalog only carries the latest fetch).
