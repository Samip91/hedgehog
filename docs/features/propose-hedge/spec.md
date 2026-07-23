# Feature: propose

## Problem / user value

Turns the reranked market match(es) into a concrete, sized hedge with real payoff numbers, and composes the four pipeline stages (`parse → retrieve → rerank → propose`) behind `POST /api/hedge` for the first time. Without this, a user's plain-English risk never becomes an actionable "stake $X on side Y; if the bad thing happens you get $Z back" recommendation — the app's entire value proposition.

## User stories

- As a user describing a risk in plain English, I want to submit it once and get back a proposed hedge (market, side, suggested stake, payoff if the bad outcome happens vs. doesn't), so I can decide whether to act on it.
- As a user whose risk has no dollar exposure stated, I want to still see the matched market and its price, so I can size a stake myself even though the system can't size it for me.
- As a user whose risk has no matching market, I want an honest "no hedge found" result rather than a fabricated or low-quality match dressed up as a real proposal.
- As a developer/operator, I want a hard cap on `/api/hedge` calls per IP, so a single client can't run up LLM spend.

## Acceptance criteria (testable)

1. `POST /api/hedge` with a valid `{prompt}` runs `parseRisk → retrieveCandidates → rerank → buildProposal` in sequence and returns `200 { ok:true, data: HedgeProposal }`.
2. `buildProposal` selects `price = side === 'YES' ? market.yesPrice : market.noPrice` per match before calling `computeHedge`/`suggestedStake` — verified by a unit test for both sides.
3. When `spec.exposureUsd` is a positive number: `stakeUsd = suggestedStake(exposureUsd, price, market.liquidityUsd)` (liquidity cap applied when present), then `computeHedge({stakeUsd, price, exposureUsd})` supplies `shares`, `payoutIfWin`, `netIfBadOutcome`, `netIfGoodOutcome`, `coverageRatio`, `coveragePct` — all present and finite per match.
4. When `spec.exposureUsd` is `null`: the above payoff fields are `null` (`sized: false`); `price` is still returned so a client can size it itself.
5. When `rerank` returns `[]`, `buildProposal` returns `{ best: null, alternatives: [] }` inside a `200` response — "no hedge found" is a valid, honest outcome, not an error.
6. `best` = the first `RankedMatch` (already relevance-sorted by `mapMatches`); `alternatives` = the remaining (0–2) matches, in the same order.
7. Any propagated infra failure not covered by a documented degraded path (e.g. retrieve's Postgres failure per PITFALLS) returns `500 { ok:false, error }` — never a partial or fabricated proposal.
8. An out-of-range side-price from upstream data does not crash the request or leak `NaN`/`Infinity` into a `200` response — the affected match is **dropped** (tech-lead Q2), so every returned match has `price ∈ (0,1)` and finite payoff fields.
9. `/api/hedge` enforces 10 requests / 10 minutes per client IP; request 11 in the window returns `429 { ok:false, error }` _before_ any pipeline stage (and no LLM tokens) runs.
10. `POST /api/hedge` writes nothing to `SavedHedge` — verified by a route test asserting no Prisma `create`/`upsert` call on the happy path (Q1 decision).
11. `buildProposal(spec, matches)` is pure — no network/DB calls — unit-testable with in-memory fixtures only, consistent with `hedgeMath`.
12. Unit tests cover: YES-side pricing, NO-side pricing, sized case, unsized (`exposureUsd: null`) case, empty-matches case, liquidity-cap-applied case, best/alternatives ordering preserved from rerank input, and invalid-price drop.
13. Route tests (mocked pipeline `deps`/modules) cover: `400` bad body (existing, unchanged), `200` happy path, `200` empty-matches case, `429` rate-limited (no pipeline stage runs), `500` on a propagated DB error surfaced through retrieve.

## Scope

**In:**

- Compose `parse → retrieve → rerank → buildProposal` on `POST /api/hedge`.
- Implement `buildProposal`'s per-match payoff wiring, reusing `hedgeMath` as-is (no new math).
- Define and return the `HedgeProposal` response shape (`spec`, `best`, `alternatives`, each match carrying its payoff breakdown) inline in the `/api/hedge` response.
- Wire the `/api/hedge`-specific 10/10min-per-IP rate limiter (scoped narrowly to this route).
- Unit tests for `buildProposal`; route tests for `/api/hedge`; rate-limit tests.
- Correct `requestHedge()`'s return type in `src/features/ask/api/index.ts` from `ApiResponse<{hedgeId:string}>` to `ApiResponse<HedgeProposal>` — small, load-bearing, nothing depends on the old shape yet.

**Out (non-goals):**

- Persisting a `SavedHedge` row / returning a `hedgeId` — `feature: saved-hedges` (backlog #8); needs anon-cookie identity that doesn't exist yet, and `/api/hedges` (POST) is already scaffolded for it. (Q1 decision.)
- Implementing `GET`/`DELETE /api/hedges/[id]` and the real `/hedge/[id]` page — depend on persistence; remain `501` stubs.
- The Proposal screen UI (stake slider, payoff diagram) — `feature: ui-ask-proposal`, next.
- General rate-limiting/hardening beyond `/api/hedge` — backlog #9 `hardening`.
- A `propose` eval — this stage makes no LLM call; correctness rides on `hedgeMath.test.ts` plus new unit/route tests.

## Resolved decisions (PO + tech-lead, user-approved)

- **Q1 persistence:** compute-and-return inline; write nothing to `SavedHedge`. Only cost: fix `requestHedge()`'s stale return type (verified safe — `AskForm.tsx` reads only `data.ok`/`error`).
- **Q2 invalid price:** DROP the affected match (not return with nulled payoff), so `sized:false` unambiguously means "no exposure given."
- **Q3 rate-limit:** narrow `/api/hedge`-only fixed-window (10/10min per IP) on the existing Upstash `redis`, checked first, fail-open. See ADR 005.
- **Q4 response type:** shared Zod schema in `src/shared/proposal.ts` (not extending UI `MarketMatchView`).
