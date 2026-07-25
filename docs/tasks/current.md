# Current

> Every session (human or agent) reads this file first. Keep it to what's in
> flight right now. Move finished items to `done.md`, upcoming ones to `backlog.md`.

## In progress

- `feature: hardening` — production-safety pass, four concerns: (1) generalized
  per-IP rate limiter (`checkRateLimit(bucket,ip,limit,window)`) applied to `hedges`
  GET/POST, `hedges/[id]` GET/DELETE, `health` (fail-open, `Retry-After`; `/api/hedge`
  behavior byte-identical; cron stays bearer-authed); (2) global security headers +
  a pragmatic static CSP via `next.config.ts` (Recharts-safe, dev-gated
  `unsafe-eval`/`ws:`); (3) a small structured JSON logger (`src/server/log.ts`,
  `LOG_LEVEL`, redacts cookie/creds/prompt) wired into 500 paths + degraded signals,
  no response change; (4) a hand-rolled PWA service worker (offline app-shell,
  network-first pages/API, cache-first static, versioned + prod-only) + generated
  maskable/apple-touch/favicon icons. ADR 008. Branch `feature/hardening`. Code
  complete, reviewer **APPROVED (1 round)**, full offline gate green (typecheck · lint ·
  test 429/429 · evals · build w/ `SKIP_ENV_VALIDATION=1`). **Not merged** — run
  `/ship` (PR to `develop`, no AI attribution). Follow-ups (deferred): nonce-based CSP;
  `@upstash/ratelimit` sliding window; map infra errors to codes vs logging raw
  `.message`; the SW offline + installability (AC 18/22) verified via the prod-only
  `e2e/offline.spec.ts` + a manual DevTools check (can't run headless in sandbox).

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
