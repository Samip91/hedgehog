# Current

> Every session (human or agent) reads this file first. Keep it to what's in
> flight right now. Move finished items to `done.md`, upcoming ones to `backlog.md`.

## In progress

- `feature: providers-day1` — Kalshi + Polymarket clients + `http.ts` (retry +
  breaker) + normalizers, with fixtures and tests. Code complete + reviewed;
  offline gate green. **Pending:** run `pnpm verify:providers` locally to confirm
  500+ live markets (sandbox can't reach the provider APIs).

## Up next

- `feature: sync` — pgvector migration + HNSW, cron sync, `/api/health`,
  degraded flags, hash-diff embed → Redis hot catalog.

## Notes

- DB is not provisioned yet — Prisma migrations authored, not applied.
- No git remote configured yet — add one before `/ship` can push.
