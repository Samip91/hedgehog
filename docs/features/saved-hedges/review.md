# Review: `saved-hedges`

Branch `feature/saved-hedges`. Gate verified locally: `pnpm test` → **344 passed (31 files)**, `pnpm typecheck` clean, `pnpm lint` clean, `SKIP_ENV_VALIDATION=1 pnpm build` succeeds (all `/api/hedges*` and pages compiled). DB-integration deferral and `SKIP_ENV_VALIDATION` accepted per task.

## Verdict-affecting findings

None. No blockers, no majors. The security-critical splits (cookie mint discipline, 403-vs-404, ownership) are implemented and tested correctly.

## Focus-area verification

1. **Cookie identity (AC 1–4).** `getAnonId()` only reads via async `cookies()`, returns `null` when absent — never mints. Minting confined to POST, set on the _response_ via `setAnonCookie` (`httpOnly, sameSite:'lax', path:'/', maxAge≈1yr`), id = `crypto.randomUUID()`, not JS-readable. GET/DELETE never set a cookie. anonId read only from the cookie store, never the body — no spoof path. Tested (httpOnly asserted; GET sets no cookie).
2. **403 vs 404 (AC 8, 14, 22).** POST foreign id → 403 before upsert (test asserts `upsert` not called). GET/DELETE route through `loadOwned`, collapsing missing and foreign to `null` → identical `notFound()` body. Byte-identical shape for missing/foreign/no-cookie asserted. No existence leak, no id enumeration. Ownership compare guards `anonId !== null`.
3. **Idempotent upsert (AC 5, 6, 9).** findUnique guard rejects foreign before upsert; `update` clause is content-only — never `anonId`/`createdAt` (no hijack on re-POST). `shares = stakeUsd.div(entryPrice)` via `Prisma.Decimal`, never float. TOCTOU reachable only via a v4-UUID guess — accepted (ADR 007/plan Q4).
4. **`settle()` (AC 15–20).** All branches traced: null→OPEN/null/null; RESOLVED+match→WIN `shares-stakeUsd`; opposite→LOSS `-stakeUsd`; RESOLVED+`resolvedYes===null`→MARKET_CLOSED; CLOSED→MARKET_CLOSED; OPEN→mark-to-market with null-side-price fallback (no NaN). Winning-side `resolvedYes ? 'YES':'NO'` maps YES+true / NO+false to WIN. Pure (no db/network). Exhaustively tested incl. NaN guard + never-throws sweep.
5. **Request-path-no-providers.** grep confirms `src/app/api/hedges/**` and `src/server/hedges/**` import no provider client / no `fetch()`. Settlement reads only DB `MarketSnapshot`.
6. **Decimal↔number boundary.** `view.ts` is the sole coercion point (`Number(...)`); `settle` number-only; writes via `new Prisma.Decimal`/`.div`. `SavedHedgeView` is all-numbers — no Decimal out, no float into DB.
7. **N+1 (AC 10).** One `savedHedge.findMany` + one batched `marketSnapshot.findMany` over distinct pairs, Map-joined. Test asserts exactly one snapshot query for a multi-row list.
8. **Formatter relocation.** `formatUsd`/`formatPrice` in `src/shared/format.ts`, re-exported from `src/features/hedge/lib/format.ts`. `hedges` imports from `@/shared/format`; no `hedge`↔`hedges` barrel cycle. The three ui-ask-proposal tests are green.
9. **Frontend states (AC 23–33).** `SaveHedgeButton` disabled on `stakeUsd<=0` (never POSTs 0); navigates only on `res.ok` — a 403/`ok:false` shows inline error, no nav; errors go idle+inline+retry; pending-disable guards double-tap. List loading/empty(verbatim AC-27 copy)/populated/error; detail loading/404(`NOT_FOUND`→NotFound)/populated with `currentPrice===null`→"pending", `pnl===null`→"—". No `dangerouslySetInnerHTML`.
10. **`prompt` provenance.** From mutation `variables` (submitted string), immune to later textarea edits.
11. **Types/test quality.** No `any`, no `!`, no `process.env`, no `dangerouslySetInnerHTML` in feature/server/route files. Readonly props; barrels public-surface-only. Tests substantive (403/404 shape, every settle branch, navigate-on-success, no-nav-on-failure, disabled-when-unsized).

## Minor observations (non-blocking)

- `src/app/hedge/[id]/page.tsx` component still named `HedgeProposalPage` though it renders `SavedHedgeDetail` — cosmetic naming drift.
- `SavedHedgeCard` two-tap remove has no cancel/timeout once "Confirm remove" shows — acceptable baseline UX, not a spec requirement.
- `getAnonId` returns `''` (not `null`) if a cookie were ever empty — not reachable in practice (server only sets a UUID).

## Acceptance criteria

AC 1–36: **all met**, each with a corresponding substantive test.

VERDICT: APPROVE
