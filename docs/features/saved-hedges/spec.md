# Feature: saved-hedges

## Problem / user value

A user who found a hedge has no way to remember it or check how it's doing — every visit starts from zero. `saved-hedges` closes the core loop: save a proposed hedge with one tap (no account needed), come back later, and see a list of saved hedges with simulated P&L, plus a detail view per hedge.

## User stories

- As a visitor who just got a hedge proposal, I want to save it with one tap, so that I don't lose it when I close the app.
- As a returning visitor (same device/browser), I want to see all my saved hedges in a list with their current status, so that I can track how they're doing.
- As a returning visitor, I want to open one saved hedge and see its simulated P&L, so that I understand whether the hedge is paying off.
- As a returning visitor, I want to remove a hedge I no longer care about, so that my list stays relevant. _(scope pending — see Open Questions)_

## Acceptance criteria (testable)

### Anon identity (cookie)

1. Given no `anonId` cookie exists, when a client `POST`s `/api/hedges` with a valid body, then the response sets an httpOnly `anonId` cookie (a fresh uuid) and the saved hedge is stored against that `anonId`.
2. Given an `anonId` cookie already exists, when the client `POST`s again, then the existing cookie value is reused (not rotated).
3. Given no `anonId` cookie, when a client calls `GET /api/hedges`, then the response is `200 { ok: true, data: [] }` (empty list, not an error, no cookie minted on a read-only call).
4. Given no `anonId` cookie (or an `anonId` that owns nothing), when a client calls `GET /api/hedges/[id]`, then the response is `404`.

### POST /api/hedges — idempotent save

5. Valid `SaveHedgeRequest` + no existing row with that `id` → create a `SavedHedge` with `shares = stakeUsd / entryPrice` (Decimal math), `status = OPEN`, `settledPnlUsd = null`; response `200/201 { ok, data: SavedHedgeView }`.
6. Same `id` POSTed twice by the same `anonId` (double-click) → upserted in place, no duplicate row, no error.
7. Invalid body → `400` (already implemented/unchanged).
8. `id` exists but belongs to a _different_ `anonId` → `403` (ownership fixed at create; alternative in Open Questions).
9. `entryPrice`/`stakeUsd`/`shares`/`settledPnlUsd` stored/read via `Prisma.Decimal` (never raw float).

### GET /api/hedges — list

10. Caller's `anonId` owns N → `200 { ok, data: SavedHedgeView[] }`, all N, each `settle()`d, newest first (`createdAt desc`, matching `@@index([anonId, createdAt])`).
11. Zero owned → `200 { data: [] }` (not 404).
12. Only the caller's own rows returned (no cross-anon leakage).

### GET /api/hedges/[id] — detail

13. Owned `id` → `200 { ok, data: SavedHedgeView }`, settled.
14. Not found OR owned by a different `anonId` → `404` (identical shape both cases — never leak "exists but not yours").

### Lazy settlement — `settle(savedHedge, snapshot: MarketSnapshot | null)`

15. `snapshot === null` → `{ status:'OPEN', currentPrice:null, simulatedPnlUsd:null }` — never throws.
16. `snapshot.status==='RESOLVED'` and outcome matches saved `side` → `status:'RESOLVED_WIN'`, `simulatedPnlUsd = shares*1 - stakeUsd` (winning side pays $1/share).
17. `RESOLVED` and outcome opposite the saved side → `status:'RESOLVED_LOSS'`, `simulatedPnlUsd = -stakeUsd`.
18. `snapshot.status==='CLOSED'` with `resolvedYes` still null → `status:'MARKET_CLOSED'`, `currentPrice:null`, `simulatedPnlUsd:null` (no pre-resolution P&L).
19. `snapshot.status==='OPEN'` → `status:'OPEN'`, `currentPrice` = snapshot price for the saved `side` (`yesPrice`/`noPrice`), `simulatedPnlUsd` = `shares*currentPrice - stakeUsd` (mark-to-market).
20. `settle()` is pure (no DB/network inside) — unit-testable with hand-built fixtures for all four statuses + null snapshot.

### DELETE /api/hedges/[id] _(scope pending — Open Questions)_

21. Owned `id` → row deleted, `200 { ok, data: { id } }`.
22. Not found / different `anonId` → `404` (no existence leak, matching AC 14).

### UI — save button

23. On a `sized` best-match, tapping "Save this hedge" → client `crypto.randomUUID()`, POST `SaveHedgeRequest` (provider upper-cased, current slider `stakeUsd`); on success → saved confirmation + link/navigation to `/hedge/[id]` (UX in Open Questions).
24. On an `unsized` best-match with no exposure entered (`stakeUsd` not positive) → save button disabled/hidden with a hint (never POSTs `stakeUsd: 0`).
25. Save failure (network/500) → button returns to idle + inline error, retryable, no navigation.
26. Double-tap → one logical save (button disabled while pending); server idempotent upsert (AC 6) makes it safe regardless.

### UI — `/hedges` list page

27. Zero saved → existing empty state (unchanged copy/CTA).
28. N saved → N cards (question, side, stake, status badge, P&L or "—" when null), each linking to `/hedge/[id]`.
29. Fetch in flight → loading state (skeleton, consistent with `ProposalResult`).
30. Fetch fails → sibling `error.tsx` / inline error (not blank).

### UI — `/hedge/[id]` detail page

31. Valid owned `id` → renders question, side, entry price, current price (or "pending"), stake, status, simulated P&L.
32. 404 `id` → clear "not found" state (via `error.tsx`/inline) — not a crash.
33. Fetch in flight → loading state.

### Tests

34. `settle()` unit tests for ACs 15–19 (pure, fixture-driven).
35. Each route (POST / GET list / GET detail / DELETE if adopted) tested mocking `db` + `cookies()`: happy path, missing/foreign `anonId`, invalid body (POST), 404, idempotent re-POST.
36. Save button, list page, detail page component-tested (jsdom infra from `ui-ask-proposal`): loading/empty/populated/error/save-success/save-failure.

## Scope

**In:** POST/GET-list/GET-detail `/api/hedges` (+ cookie mint/read, ownership, idempotent Decimal upsert); pure `settle()` off DB `MarketSnapshot`; save button on the `sized` best-match; `/hedges` list page; `/hedge/[id]` detail page; unit + mocked-route + component tests.

**Out (non-goals):** real accounts/auth (anon cookie is the whole identity model); the live `/api/markets/[key]` route (`feature: live-price`) — OPEN mark-to-market uses DB `MarketSnapshot` only (may be stale); a background settlement job (settlement is lazy/on-read); provisioning the DB / applying migrations (ships as code + unit/mocked tests, integration deferred like `sync`); real order placement; `DELETE` + delete affordance tentatively in (ACs 21–22) pending confirmation.

## Open questions (with recommendations) — tech-lead + user

1. **Settlement data source.** Rec: `settle()` reads DB `MarketSnapshot` only (request-path-safe, self-contained). RESOLVED_WIN/LOSS from `resolvedYes`+`side`; MARKET_CLOSED from `status`; OPEN currentPrice/pnl mark-to-market off the snapshot's last-synced `yesPrice`/`noPrice`. Accept: stale prices (sync defers CLOSED/RESOLVED), and unprovisioned-DB/missing-row → OPEN + null P&L. Live/fresh price deferred to `feature: live-price`.
2. **Save UX.** Rec: "Save this hedge" on the `sized` best-match only; on success **navigate to `/hedge/[id]`** (reuses detail, strongest "saved" signal). Unsized not saveable until an exposure makes it effectively sized. (Confirm: navigate vs toast; unsized-disabled vs saveable.)
3. **DELETE + affordance.** Rec: implement now (ACs 21–22 + a small confirm-delete button, invalidating query keys) — route stubbed for it, cheap, baseline UX. (Confirm now vs defer.)
4. **Idempotency/ownership.** Rec: `anonId` fixed at **create**; same-anon re-POST = idempotent update; different-anon re-POST = `403`. (Confirm 403 vs silent claim.)
