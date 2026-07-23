# Plan: ui-ask-proposal

## Branch

`feature/ui-ask-proposal`

## Approach

The Ask screen already parses/matches/sizes a risk server-side; `AskForm.tsx` just drops the success payload. This slice fills the `data.ok === true` gap by rendering `HedgeProposal` inline, and — because it is the first UI slice — establishes copyable feature-slice patterns: a **pure state selector**, a **pure payoff transform that delegates to `computeHedge`** (never reimplements it), and **pure formatters**, with thin JSX around them.

Rendering is driven by one pure `selectView({ isPending, data, error })` returning a discriminated union covering every AC-1 state. `ProposalResult` calls it and renders exactly one branch, so "exactly one, never stale" (AC 1) comes from a single unit-tested source of truth. `AskForm` shrinks to rendering `<ProposalResult isPending data error />` in place of its two inline error `<p>` blocks — the amber/red copy + classes move verbatim, so error UX (AC 20–22) is byte-identical and the form stays enabled for edit/resubmit.

Reuse: `computeHedge`/`suggestedStake` (`src/shared/hedgeMath.ts`) for all payoff math + slider seed; `HedgeProposal`/`HedgeMatch`/`HedgeSpec` (`src/shared/proposal.ts`, `schemas.ts`) rendered directly (retire `src/features/hedge/types.ts`); `cn` (`src/lib/utils.ts`); `recharts@3` (installed); `useMutation` (wired). The result tree lives under the already-`'use client'` `AskForm`; Recharts component still marked `'use client'` defensively.

**Decisions:** Q1 = full component tests (Vitest jsdom _project_ + RTL + one Playwright smoke — ADR 006); Q3 = native `<input type="range">`; Q5 = retire `hedge/types.ts` (grep-confirmed: only its own barrel references it). **Recommendations for the user:** Q2 → diagram **A (2-outcome bar)**; Q4 → **coverage-input** unsized UX.

## File map

**New — `src/features/hedge/lib/` (pure `.ts`, node project):**

- `lib/selectView.ts` — pure `selectView(m)` → render union (AC 1/18/19/20/21).
- `lib/payoff.ts` — `stakeToPayoff(stakeUsd, price, exposureUsd)` (delegates to `computeHedge` — no new math; AC 8), `payoffToChartData(result)` (2-bar shape), `sliderBounds(seedStake)` (AC 9 range).
- `lib/format.ts` — `formatUsd`, `formatPrice` (0.24→24¢/%), `formatDate` (YYYY-MM-DD + ISO closeTime), null copy ("not specified"/"no deadline") (AC 5/12). `Intl.NumberFormat`.

**New — `src/features/hedge/components/` (`.tsx`):**

- `ProposalResult.tsx` (`'use client'`) — `{isPending,data,error}` → `selectView` → one branch (loading skeleton / amber / red / proposal body).
- `ParsedRiskCard.tsx` — AC 5/6.
- `BestMatchSized.tsx` (`'use client'`) — AC 7–11; owns `stakeUsd` state (init `best.stakeUsd`), `useMemo(stakeToPayoff)`, callouts + slider + diagram; first paint = server numbers (AC 7).
- `BestMatchUnsized.tsx` (`'use client'`) — AC 12–15; exposure `<input>`; positive → seed via `suggestedStake` → same slider+diagram path.
- `AlternativeCard.tsx` — compact (provider/question/side/price/relevance), no slider/diagram (AC 16).
- `NoHedge.tsx` — "No matching market found" (AC 18).
- `StakeSlider.tsx` (`'use client'`) — native range, `cn`-styled, `aria-valuetext` = formatted stake (AC 9, a11y).
- `PayoffDiagram.tsx` (`'use client'`) — Recharts 2-outcome bar (A), `ResponsiveContainer`, re-heights on drag no remount (AC 10).

**New — barrel/retirement:** `src/features/hedge/index.ts` rewritten to `export { ProposalResult }`; `src/features/hedge/types.ts` **deleted**.

**Modified:** `src/features/ask/components/AskForm.tsx` — replace the two inline error `<p>` blocks with `<ProposalResult isPending data error />` (form/textarea/button unchanged).

**Test infra (ADR 006):** `vitest.config.ts` → `test.projects` (node: `*.{test,spec}.ts` unchanged; jsdom: `*.{test,spec}.tsx` + `setupFiles: ['./vitest.setup.ts']`). `vitest.setup.ts` (root): jest-dom matchers, `afterEach(cleanup)`, `ResizeObserver` stub. `package.json` devDeps: `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`.

**Test files:** `lib/selectView.test.ts`, `lib/payoff.test.ts`, `lib/format.test.ts` (node); `components/ProposalResult.test.tsx`, `BestMatchSized.test.tsx`, `BestMatchUnsized.test.tsx` (jsdom); `e2e/ask-proposal.spec.ts` (Playwright, stubs `POST /api/hedge`).

**Bookkeeping:** `docs/tasks/done.md` add `feature: propose` (PR #7); `current.md` promote `ui-ask-proposal` to In progress. `docs/adr/006-ui-component-test-infra.md`.

## Design details

**`selectView` (pure)** — precedence encodes AC 1 (isPending beats stale data):

```
type ProposalView =
  | { kind:'idle' } | { kind:'loading' }
  | { kind:'error'; tone:'red'|'amber'; message:string }
  | { kind:'no-hedge'; spec } | { kind:'sized'; spec; best; alternatives }
  | { kind:'unsized'; spec; best; alternatives }
selectView({isPending,data,error}):
  isPending → loading;  error → error(red,"Something went wrong. Please try again.")
  data===undefined → idle;  !data.ok → error(amber, data.error.message)
  best===null → no-hedge;  best.sized ? sized : unsized
```

**`stakeToPayoff`** returns `computeHedge({stakeUsd,price,exposureUsd})` unchanged — its job is to FORBID reimplementation in components (AC 8 test asserts equality across a stake sweep incl. 0). `payoffToChartData` → `[{label:'If it happens',net:netIfBadOutcome},{label:"If it doesn't",net:netIfGoodOutcome}]`.

**`sliderBounds(seedStake)`** → `{min:0, max:max(1,ceil(seedStake*2)), step:max(1,round(max/100))}`, value clamped `[0,max]`. Sized seed = `best.stakeUsd`; unsized seed = `suggestedStake(enteredExposure, best.price)`. `stakeUsd:0` flows safely through `computeHedge`.

**No-remount (AC 10):** `stakeUsd` state in the card, `payoff = useMemo(...,[stake,price,exposure])`, `PayoffDiagram` keyed stably → bars re-height, no remount. **Unsized:** UI-local `exposure` (never sent to server); ≤0/empty hides slider+diagram (AC 13/15); positive → identical sized path (AC 14). **Layout:** nests in `max-w-md`, `rounded-2xl border`, 390px-safe; all text `{value}` (no `dangerouslySetInnerHTML`, AC 2); loading skeleton fixed-min-height (AC 4).

## Recommendations (user decides)

- **Q2 diagram → A (2-outcome bar).** Honest primary read, maps 1:1 to the two callouts, re-heights on drag with no axis/sampling work. B (stake-vs-net curve) needs per-render sampling + "you are here" marker + axis formatting — a clean fast-follow, not this slice.
- **Q4 unsized → coverage-input.** Reuses the ENTIRE sized path (slider/diagram/`stakeToPayoff`/callouts) for one controlled input + a positive guard → full parity (coverage %, net-if-bad) with zero new math. Stake-only alt can't show coverage/net-if-bad and diverges the two branches. Entered exposure stays UI-local.

## Sequencing

1. **Test infra first** (highest risk): add devDeps + `vitest.setup.ts` + `projects`; run `pnpm test` and confirm the **206 node tests still pass** BEFORE any UI.
2. Pure lib (`selectView`/`payoff`/`format`) + `.ts` tests (TDD, node).
3. Leaf components (`StakeSlider`, `PayoffDiagram`, `ParsedRiskCard`, `AlternativeCard`, `NoHedge`) — parallel.
4. Composed (`BestMatchSized`, `BestMatchUnsized`, `ProposalResult`).
5. Wire-up: swap the `<p>` blocks in `AskForm`; rewrite `hedge/index.ts`; delete `hedge/types.ts`.
6. Component tests (jsdom) + Playwright e2e.
7. Docs + ADR.

## Tests

- **Unit (node):** `selectView` (every branch, isPending-beats-stale, undefined, amber vs red); `stakeToPayoff`===`computeHedge` sweep incl. 0 (AC 8) + `sliderBounds`; `format` null/currency/percent/date.
- **Component (jsdom, RTL+user-event):** `ProposalResult` renders exactly one state, no stale card (AC 1,18–21); `BestMatchSized` first paint = server numbers, slider change updates payoff, no remount (AC 7–9); `BestMatchUnsized` no payoff before input, positive reveals slider+diagram, clear/0 hides without throw (AC 12–15). Assert on text/number DOM, not SVG internals.
- **e2e (Playwright smoke):** 390px Pixel-7, `page.route('**/api/hedge', canned sized HedgeProposal)`, type→submit→assert cards; drag slider→assert a number changes.
- Gate: `typecheck · lint · test · evals · build`. No new evals (frontend-only).

## Risks & mitigations

- **Regressing 206 backend tests via jsdom (top risk):** Vitest _projects_, not a global env switch; node project include unchanged; `.ts`/`.tsx` globs mutually exclusive → backend never loads jsdom. Verify `pnpm test` right after the config change. Confirm `test.projects` is correct for pinned `vitest@4.1.10` (workspace files removed in v4).
- **Recharts in jsdom (ResizeObserver / zero-size container):** stub `ResizeObserver` in setup; unit-test `payoffToChartData`, assert numeric DOM (not SVG); diagram render reviewer- + e2e-verified.
- **Recharts SSR:** `'use client'` on chart + stateful cards (already under client `AskForm`).
- **Number/null formatting:** centralized in `format.ts` (unit-tested); no ad-hoc `toFixed` in JSX.
- **Slider perf/remount:** stake state in card, memoized transform, stably-keyed diagram (AC 10).
- **a11y native range:** `<label>` + `aria-valuetext` (justifies native, no Radix).
- **Single source of payoff math:** components call `stakeToPayoff` only; AC-8 equality test locks it to `computeHedge`.
- **e2e can't reach live NIM/DB in sandbox:** the smoke stubs `POST /api/hedge` via `page.route`; a live-pipeline e2e is a separate CI-with-services job, out of this slice.

See ADR: `docs/adr/006-ui-component-test-infra.md`.
