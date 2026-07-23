# ADR 007: Anonymous cookie identity + lazy on-read settlement

**Status:** Accepted (Q1–Q3 user-confirmed)
**Feature:** saved-hedges (`docs/features/saved-hedges/`)

## Context

`saved-hedges` needs a persistent per-user identity with **no accounts/auth**, and a
simulated P&L for each saved hedge. Two forces shape the design: (1) the core principle
that **the request path never calls a provider** (`docs/architecture.md`,
`docs/PITFALLS.md`) — so P&L cannot fetch a live price on read; and (2) there is **no
background worker** (cron-only) to pre-settle hedges. The `SavedHedge` contract
(`prisma/schema.prisma`) already carries a client-UUID `id`, an `anonId`, and
`status`/`settledPnlUsd` columns; the routes are stubbed at 501.

## Decision

**Identity: one httpOnly `anonId` cookie.** A new `src/server/anon.ts` owns the cookie.
`getAnonId()` (async `cookies()`, Next 16) only _reads_; `POST /api/hedges` mints a fresh
`crypto.randomUUID()` on the **response** (`NextResponse.cookies.set`, `httpOnly,
sameSite:'lax', path:'/', maxAge ≈ 1yr`) when absent, and reuses it otherwise. Reads
(`GET`) never mint (AC 3). Ownership is fixed at create: same-anon re-POST is an
idempotent upsert; foreign-anon POST → 403; foreign/missing on GET/DELETE → 404 (no
existence leak).

**Settlement: lazy, on-read, off DB `MarketSnapshot` only.** A pure
`settle(hedge, snapshot|null)` computes `{status, currentPrice, simulatedPnlUsd}` at read
time from the last-synced snapshot joined by `(provider, externalId)`. Nothing is
persisted back: the stored `status`/`settledPnlUsd` stay `OPEN`/`null` for the row's life;
the _view_ always reflects live `settle()` output. `RESOLVED_WIN/LOSS` derive from
`resolvedYes`+`side`; `OPEN` is mark-to-market off snapshot price; a missing snapshot (or
`RESOLVED` with `resolvedYes===null`) yields `OPEN`/`MARKET_CLOSED` with `null` P&L,
never a throw.

## Consequences

- **Positive:** zero-friction identity, no auth surface; request path stays provider-free
  and DB-only; settlement is a pure, exhaustively unit-testable function (no worker, no
  settlement-history schema); ships fully testable without a provisioned DB (unit +
  mocked-route + component).
- **Negative / accepted:** an anon identity is device/browser-scoped and lost if the
  cookie is cleared (no cross-device history — acceptable for a no-account PWA); P&L can
  be **stale** (only as fresh as the last cron sync; `CLOSED`/`RESOLVED` transitions lag)
  and is `null` when a snapshot is missing; recomputing on every read is a tiny cost paid
  for statelessness; the persisted `status`/`settledPnlUsd` columns are effectively
  vestigial under lazy settlement.
- **Upgrade path:** `feature: live-price` can swap the snapshot price for a fresh
  single-market read behind the same `settle()` seam; a future account system can adopt
  existing `anonId` rows by re-keying; a background settlement job (if ever added) can
  persist into the already-present `status`/`settledPnlUsd` columns without touching the
  read path.
