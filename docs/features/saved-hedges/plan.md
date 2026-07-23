# Plan: saved-hedges

## Branch

`feature/saved-hedges`

## Approach

Close the loop: a one-tap save on a proposal, a device-scoped list, and a per-hedge detail with lazily-computed simulated P&L. Identity is a single httpOnly `anonId` cookie (ADR 007); settlement is **lazy/on-read** off our own DB `MarketSnapshot` — the request path never touches a provider.

Three thin layers, each already scaffolded:

1. **Pure core (server, node-tested):** `settle(input)` (ACs 15–19) + `savedHedgeToView(row, snapshot)` (Decimal→number) in `src/server/hedges/` — pure, fixture-driven, no DB/network inside. `settle` operates on plain numbers; the Decimal→number coercion is isolated in the mapper (mirrors `retrieve.ts`).
2. **Route handlers:** fill the four 501 stubs. Reuse `db`, the Decimal-upsert idiom + `toProviderEnum` from `sync.ts`, and a new `src/server/anon.ts` cookie helper. POST mints the cookie on the _response_; GET only reads (AC 3).
3. **Feature-slice UI:** the `hedges` slice owns server state (fetchers + TanStack hooks + `HEDGES_QUERY_KEYS`) + components. The **save button lives in the `hedge` slice** (proposal render tree, consumes `HedgeMatch`/`HedgeSpec`/`prompt`) but calls the `hedges` slice's `useSaveHedge` via its barrel — one-directional, no cycle. Pages fetch **client-side via TanStack** (conventions: server state → TanStack; cookie auto-sent same-origin).

**Cross-slice boundary:** `SaveHedgeButton` (presentational, in `hedge`) builds the request via a pure `toSaveHedgeRequest()` mapper in `hedges/lib` (uppercases provider, Zod-validates before POST) and fires `useSaveHedge()` from the `hedges` barrel.

**Threading `prompt`:** `SaveHedgeRequest.prompt` is the _original_ user text, not in `HedgeProposal`. Source it from the mutation's own `variables` (`useRequestHedge().variables` = the submitted string) — stays paired with `data`, immune to later textarea edits. `AskForm` passes `variables` → `ProposalResult` (new `prompt` prop) → `BestMatch*` → `SaveHedgeButton`.

## File map

**New — server core:** `src/server/anon.ts` (`ANON_COOKIE='anonId'`, `getAnonId()` async read-only, `setAnonCookie(res, id)`); `src/server/hedges/settle.ts` (pure `settle(SettleInput)→{status,currentPrice,simulatedPnlUsd}`); `src/server/hedges/view.ts` (`savedHedgeToView(row, snapshot|null)` Decimal→number + settle); `settle.test.ts`, `view.test.ts` (node).

**Modify — routes:** `src/app/api/hedges/route.ts` (POST + GET list); `src/app/api/hedges/[id]/route.ts` (GET detail + DELETE); `route.test.ts` files (node, mock `@/server/db` + `next/headers`).

**New — `hedges` slice:** `api/index.ts` (`saveHedge`/`fetchSavedHedges`/`fetchSavedHedge`/`deleteSavedHedge`); `lib/toSaveHedgeRequest.ts` (+ test); `hooks/{useSaveHedge,useSavedHedges,useSavedHedge,useDeleteSavedHedge}.ts` (TanStack; mutations invalidate `HEDGES_QUERY_KEYS.list()`); `components/{SavedHedgeCard,SavedHedgesList,SavedHedgeDetail,StatusBadge}.tsx` (+ jsdom tests); extend `index.ts` barrel.

**New — `hedge` slice:** `components/SaveHedgeButton.tsx` (+ jsdom test).

**Modify — proposal tree + pages:** `ProposalResult.tsx` (+`prompt` prop, thread down); `BestMatchSized.tsx` (render `<SaveHedgeButton>` w/ current `stakeUsd`); `BestMatchUnsized.tsx` (render inside `hasExposure` block); `AskForm.tsx` (pass `variables` as `prompt`); `src/app/hedges/page.tsx` (`<SavedHedgesList>`, empty-state copy moves into the list's empty branch — AC 27); `src/app/hedge/[id]/page.tsx` (RSC shell `await params` → `<SavedHedgeDetail id={id} />`); `docs/tasks/current.md`. (`error.tsx` for both pages already exists, reused.)

## Sequencing

1. Server core (`settle`+`view`+tests, `anon.ts`) — blocks routes.
2. Routes (POST→GET list→GET detail→DELETE) + route tests — parallel to 3.
3. `hedges` slice server-state (`api/`, `lib/toSaveHedgeRequest`, hooks) — parallel to 2.
4. UI components (cards/list/detail/badge; then `SaveHedgeButton`).
5. Wire-in (prop threading + the two pages).
6. Component tests + `current.md`.

## Resolved / recommended open questions

**Q4 — idempotency/ownership (RESOLVED).** `anonId` fixed at create; guard 403 with a findUnique before upsert (plain upsert can't express 403 and would overwrite a foreign row):

```ts
const existing = await db.savedHedge.findUnique({
  where: { id },
  select: { anonId: true },
})
if (existing && existing.anonId !== anonId) return 403
await db.savedHedge.upsert({
  where: { id },
  create: {
    id,
    anonId /* Decimal fields, shares, status:'OPEN', settledPnlUsd:null */,
  },
  update: {/* content fields only — never anonId/createdAt */},
})
```

`upsert` handles the same-anon double-click race atomically.

**Q1 — settlement source (RECOMMEND: DB `MarketSnapshot` only).** Join by `(provider,externalId)`. RESOLVED_WIN/LOSS from `resolvedYes`+`side`; MARKET_CLOSED from `status==='CLOSED'`; OPEN mark-to-market off snapshot `yesPrice`/`noPrice`; missing snapshot → OPEN+null. Accept stale prices; live/fresh price deferred to `feature: live-price`. **Edge:** `RESOLVED` with `resolvedYes===null` → treat as MARKET_CLOSED (null P&L), never throw.

**Q2 — save UX (RECOMMEND: sized-only button, navigate on success).** One reusable `SaveHedgeButton` in `BestMatchSized` (always) and inside `BestMatchUnsized`'s `hasExposure` block; **disabled when `stakeUsd <= 0`** (never POSTs `stakeUsd:0`, AC 24). On success → `router.push('/hedge/[id]')` (reuses detail; strongest "saved" signal). Failure → idle + inline error, retryable, no nav (AC 25). _User confirms: navigate vs inline toast._

**Q3 — DELETE (RECOMMEND: implement now).** Add `DELETE` (404 on foreign/missing) + a small confirm-delete affordance invalidating `HEDGES_QUERY_KEYS.list()`. Cheap, baseline UX. _User confirms now vs defer_ — if declined, drop the DELETE handler, `useDeleteSavedHedge`, the affordance, ACs 21–22.

## Design details

- **Cookie helper:** `getAnonId()` async `cookies()` read-only; POST mints `crypto.randomUUID()` via `NextResponse.cookies.set(ANON_COOKIE, id, { httpOnly:true, sameSite:'lax', path:'/', maxAge })` when absent, reuses otherwise; GET never mints (AC 3).
- **POST flow:** validate `SaveHedgeRequestSchema` (already 400s) → ensure anon → findUnique ownership guard (403 foreign) → `db.savedHedge.upsert` (Decimal via `new Prisma.Decimal`, `toProviderEnum`, `shares = Decimal(stakeUsd).div(entryPrice)`, `status:'OPEN'`, `settledPnlUsd:null`) → load its snapshot → `savedHedgeToView` → `ok(view)`.
- **GET list:** `findMany({ where:{anonId}, orderBy:{createdAt:'desc'} })` → one batched `MarketSnapshot.findMany({ where:{ OR: distinct (provider,externalId) pairs } })` → Map keyed `${provider}:${externalId}` → `savedHedgeToView` each → `ok(views)`. Empty (not 404) when no cookie/none.
- **GET detail:** `findUnique({where:{id}})` → 404 if missing OR `anonId` mismatch (AC 14, no existence leak) → settle → view.
- **`settle()` (ACs 15–19):** null snapshot → OPEN/null/null; `status RESOLVED` + `resolvedYes` matches side → RESOLVED_WIN, pnl = `shares*1 - stakeUsd`; opposite → RESOLVED_LOSS, pnl = `-stakeUsd`; `RESOLVED` + `resolvedYes===null` OR `status CLOSED` → MARKET_CLOSED/null/null; `status OPEN` → OPEN, currentPrice = side price, pnl = `shares*currentPrice - stakeUsd`.
- **Pages:** client fetch via TanStack; `/hedge/[id]` is an RSC shell that `await params` then renders the client `<SavedHedgeDetail>`.

## Key risks & mitigations

- Cookie can't be set on GET (AC 3) — only POST mints via `NextResponse.cookies.set`; GET reads.
- 404-vs-403 — POST foreign-id → 403 (caller minted the UUID; collision = bug/attack); GET/DELETE foreign/missing → 404 (no existence leak). Documented.
- Decimal precision — `shares` via `Decimal.div`; settle math in `number` only at the read boundary; `settledPnlUsd` never persisted (lazy — view always from live `settle()`).
- N+1 on list — one `findMany` for hedges + one batched snapshot `findMany` (Map join). One extra query.
- RSC vs client + per-request cookie — client fetch sends cookie same-origin; `/hedge/[id]` RSC shell only awaits params.
- Provider casing — client mapper uppercases + Zod-validates before POST; server uses `toProviderEnum` at the DB boundary.
- DB unprovisioned — code + node-unit + mocked-route + jsdom-component tests; integration deferred (like `sync`). Missing snapshot → settle OPEN+null, never throws (AC 15).

## Tests & seams

No new evals. Gate unchanged.

- **Unit (node):** `settle` all four statuses + null + `RESOLVED`/`resolvedYes===null` edge; `savedHedgeToView` Decimal→number; `toSaveHedgeRequest` casing + Zod.
- **Route (node, mock `@/server/db` + `next/headers`):** POST happy/mint/reuse/idempotent/invalid-400/foreign-403; GET list happy/empty/no-cross-anon/no-mint; GET detail owned-200/foreign-or-missing-404; DELETE owned-200/foreign-404.
- **Component (jsdom, ADR 006):** `SaveHedgeButton` pending/success(navigate)/error(retry,no-nav)/disabled-unsized; `SavedHedgeCard`; `SavedHedgesList` loading/empty/populated/error; `SavedHedgeDetail` loading/404/populated.

See ADR: `docs/adr/007-anon-cookie-lazy-settlement.md`.
