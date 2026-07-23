# ADR 005: Fixed-window per-IP rate limit on `/api/hedge`, fail-open

**Status:** Accepted
**Feature:** propose (`docs/features/propose-hedge/`)

## Context

`POST /api/hedge` spends NVIDIA NIM tokens (parse + rerank) and Postgres/pgvector reads
on every call. AC 9 requires 10 req / 10 min per IP, request 11 rejected before any
token. We already run an Upstash Redis client (`src/server/cache.ts`). A full limiter
framework (`@upstash/ratelimit`, sliding window, global middleware) is backlog #9
`hardening`, not now.

## Decision

Add `src/server/rate-limit.ts` reusing the existing `redis` client. Fixed window on
`ratelimit:hedge:${ip}`: the window start is created **atomically with its TTL** via
`SET key 1 NX EX 600`, and subsequent requests `INCR`; allow while `count <= 10`. Scope
strictly to `/api/hedge`, checked as the handler's first step. On any Redis error,
**fail-open**.

IP comes from headers only (`x-forwarded-for` first hop → `x-real-ip` → `'unknown'`) —
Next 16 route handlers have no `NextRequest.ip`.

## Consequences

- Positive: no new dependency; blocks abusive bursts before LLM spend; a tiny surface
  backlog #9 can generalize; the limiter can never be the sole cause of a failed hedge.
- Negative / accepted: fixed windows allow a boundary burst (≤2× across two adjacent
  windows); fail-open lifts the limit during a Redis outage (bounded token exposure);
  `'unknown'`-IP requests share one bucket. (Window init is atomic via `SET NX EX`, so
  no untimed-orphan/permanent-block path exists — the counter always carries a TTL.)
- Upgrade path: backlog #9 swaps in a sliding-window / `@upstash/ratelimit` limiter and,
  if needed, flips to fail-closed — the `checkHedgeRateLimit` seam and its call site
  stay the same.
