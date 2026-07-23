# Review: `ui-ask-proposal`

## Gate status (verified, not assumed)

- `pnpm test` → **269 passed / 22 files**. Split confirmed isolated: `--project node` = 245 tests, setup 0ms (never loads `vitest.setup.ts`/jsdom); `--project jsdom` = 24 tests, setup ~500ms. Extension-split globs (`.ts` vs `.tsx`) are mutually exclusive and `e2e/` lives outside `src/**`, so the backend suite provably never touches jsdom. The infra change did not regress the backend gate.
- `pnpm typecheck` clean, `pnpm lint` clean.
- No `dangerouslySetInnerHTML` anywhere in `src/`. No `any` / non-null `!` in the hedge slice. `src/features/hedge/types.ts` retired (confirmed absent; typecheck passes, so no dangling refs).

## Focus-area findings

1. **Test-infra isolation — SOLID.** `vitest.config.ts` uses `test.projects` (correct for pinned `vitest@4.1.10`), node include unchanged, jsdom scoped to `.tsx` + setup. Coverage still scoped to `shared/**`+`server/**`. No risk to the gate.
2. **Client `computeHedge` reuse (AC 8) — SOLID, no drift.** `stakeToPayoff` is a pure one-line delegate to `computeHedge`. Zero hand-rolled shares/payout/net/coverage arithmetic in the components — every payoff number flows through `stakeToPayoff`. AC-8 test imports the real `computeHedge` as oracle and asserts `toEqual` across a price×stake sweep including 0.
3. **XSS / text-only (AC 2) — SOLID.** `reasoning`/`riskDescription`/`clarificationNeeded`/`question` all render as `{value}` text nodes. `ProposalResult.test.tsx` injects `<script>`/`<img onerror>` payloads and asserts they appear as literal text with no parsed elements. `match.url` is never rendered (no href sink).
4. **State selection (AC 1) — SOLID.** `selectView` precedence `isPending → error → idle → !ok(amber) → best===null(no-hedge) → sized/unsized` guarantees exactly one branch; "resubmit doesn't show stale proposal" is unit- and component-tested.
5. **Sized vs unsized (AC 7/12–15) — SOLID, no crash path.** Sized first paint recomputes from `best.stakeUsd`/`best.price`/`spec.exposureUsd` — traced to the server (`propose.ts`): same `suggestedStake`→`computeHedge`, so client output is byte-identical to the serialized `best.*` fields. No input can reach `computeHedge` with an invalid price (`HedgeMatch.price` is Zod `gt(0).lt(1)`) or negative stake (`parseExposure` + `>0` guard + `clampStake` floor at 0). Negative/0/cleared exposure guarded three ways and tested.
6. **Slider bounds + no-remount (AC 9/10) — SOLID.** `sliderBounds`/`clampStake` never emit negative/NaN (seed 0 → `{0,1,1}`). `PayoffDiagram` node identity stable across a drag (node-identity test).
7. **Code-quality extraction — behavior preserved.** `MatchSummary`/`PayoffCallouts`/`AlternativesList` shared by both best-match cards; AC 11 (alternatives in sized), AC 17 (empty → `null`), and callout fields still tested and green.
8. **Conventions — SOLID.** Barrel exports only `ProposalResult` + props type. `'use client'` on the interactive components only; pure presentational ones omit it. `cn()` used, readonly props, TanStack mutation untouched, no fixed widths breaking 390px.
9. **Test quality — meaningful.** Slider-drag asserts recomputed numbers via the `computeHedge` oracle; unsized reveal/hide asserts DOM presence/absence; e2e stubs `/api/hedge` and drives submit + slider with a before/after assertion. No vacuous tests.

## Non-blocking notes

- **AC 7 wording nuance.** The card recomputes on first paint (`useMemo(stakeToPayoff)`) rather than reading `best.netIfBadOutcome` directly, but verified deterministically identical to the server output (same fn, same inputs incl. the liquidity-capped `best.stakeUsd`) — no observable drift.
- **Unsized seed ignores the liquidity cap.** `BestMatchUnsized` seeds via `suggestedStake(exposureUsd, best.price)` (no cap), matching AC 14; entered exposure is UI-local, nothing to reconcile.
- **Fractional slider seed vs `step`.** A seed like `333.33` with `step:7` isn't step-aligned; cosmetic, no numeric impact.

## Acceptance criteria

All 22 met. AC 1,2,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,20,21 have direct automated coverage; AC 19 holds by contract (`best===null ⇒ alternatives:[]`); AC 3 and AC 22 are review-verified (`max-w-md`/grid/`w-full`; form disabled only on `isPending`/empty prompt, so re-enables after either error path).

VERDICT: APPROVE
