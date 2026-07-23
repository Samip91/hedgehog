# Feature: ui-ask-proposal

## Problem / user value

The pipeline (`feature: propose`) can already turn a plain-English risk into a sized `HedgeProposal`, but the Ask screen throws it away — `AskForm.tsx` has no branch for `data.ok === true`. Without this screen, a user gets nothing back for their risk description: no market, no stake, no payoff. This feature renders the proposal inline, so a user can go from typing a risk to seeing "stake $X on YES at 24¢; if it rains you get $Z back" in one screen, with a slider to explore other stake sizes.

## User stories

- As a user who just described a risk, I want to see, without leaving the page, what the app understood about my risk, so I can tell if it got it right.
- As a user with a sized proposal, I want to see the matched market, the suggested stake, and the payoff in both outcomes, so I can decide whether to act on it.
- As a user with a sized proposal, I want to drag a slider to try a different stake and see the payoff update live, so I can size the hedge the way I want.
- As a user whose risk had no stated dollar exposure, I want to see the matched market and its price and be able to enter my own exposure to size a stake, so the system doesn't force a number on me it doesn't have.
- As a user with up to two additional matches, I want to see them presented more compactly than the best match, so I can compare without the primary recommendation getting lost.
- As a user whose risk has no matching market, I want an honest "no hedge found" message, not an error or a fabricated result.
- As a user whose request failed, I want a clear, non-technical error message and the ability to try again.

## Acceptance criteria (testable)

**General**

1. On submit, as `useRequestHedge()` transitions `isPending → data`, exactly one of {loading / parsed-risk+best-sized / parsed-risk+best-unsized / parsed-risk+no-hedge / error} renders — never more than one, never a stale previous result left on screen during a new pending mutation.
2. All proposal text (`spec.riskDescription`, `spec.clarificationNeeded`, `HedgeMatch.reasoning`, `HedgeMatch.question`) is rendered as text content (`{value}` in JSX), never via `dangerouslySetInnerHTML` or any HTML-parsing path (review/grep-verified).
3. Usable at 390px width without horizontal scroll; renders inside the existing `max-w-md` column.

**1. Loading** 4. Given `isPending`, the submit button shows the staged copy and a skeleton occupies the proposal area (no layout jump when real content arrives).

**2. Parsed-risk card** 5. Given `data.ok`, a card shows `spec.riskDescription`, `spec.domain`, `spec.exposureUsd` (currency, or "not specified" when `null`), `spec.deadline` (date, or "no deadline" when `null`). 6. Given `spec.clarificationNeeded` non-null, it renders as a distinct visible callout; given `null`, no callout.

**3. Best match — sized (`best !== null && best.sized === true`)** 7. Card shows `provider`, `question`, `side`, `price` (% or ¢), and the initial payoff numbers (`stakeUsd`, `payoutIfWin`, `netIfBadOutcome`, `netIfGoodOutcome`, `coveragePct`) exactly as returned by the server (no client recompute on first paint). 8. Dragging the stake slider updates the displayed payoff + diagram by calling client-side `computeHedge({ stakeUsd: <slider>, price: best.price, exposureUsd: spec.exposureUsd })` — unit-tested: the slider transform equals `computeHedge` across a range of stakes. 9. Slider initial value = `best.stakeUsd`; range `[0, upperBound]` (deterministic, documented); `stakeUsd: 0` must not throw; never negative. 10. A Recharts payoff diagram renders the two outcomes for the current slider value and updates on drag without remount/flicker. 11. `alternatives` render below the best match even in the sized case.

**4. Best match — unsized (`best !== null && best.sized === false`)** 12. Given `spec.exposureUsd === null`, the card shows `provider`, `question`, `side`, `price`, `reasoning`, but fabricates no payoff numbers (no `computeHedge` with a guessed exposure). 13. A labeled exposure input is shown; until a positive value is entered, the slider and diagram do not render (or render disabled with microcopy) — no NaN/divide-by-zero. 14. Once a positive exposure is entered, a slider (seeded via `suggestedStake(enteredExposure, best.price)`) and the diagram appear, driven by client-side `computeHedge` as in the sized case. 15. Entering `0`/negative/cleared removes/disables slider+diagram without throwing.

**5. Alternatives** 16. Given `alternatives.length > 0`, each renders more compactly than `best`: at least `provider`, `question`, `side`, `price`, `relevance` — no slider/diagram on alternatives. 17. Given `alternatives.length === 0`, no alternatives section (never an empty box implying loading).

**6. No hedge found (`best === null`)** 18. Given `data.ok && best === null`, the parsed-risk card still renders, followed by an explicit "No matching market found" message — distinct from the error state, not an empty card. 19. Given `best === null`, `alternatives` is `[]` per contract — no alternatives section.

**7. Error** 20. Given `!data.ok`, the existing amber inline message renders; no proposal card alongside. 21. Given a network/mutation `error`, the existing red inline message renders. 22. Both error paths leave the form re-enabled for edit + resubmit without reload.

## Scope

**In:**

- Fill the `data.ok === true` branch of `AskForm.tsx` (or a component it renders) with all six render states.
- A `src/features/hedge/` slice with `components/`: parsed-risk card, best-match (sized) card w/ slider + Recharts payoff diagram, best-match (unsized) card w/ exposure input, compact alternative card, no-hedge empty state.
- A pure `.ts` transform module wrapping slider → `computeHedge` (the thing AC 8 unit-tests), colocated in the slice.
- Retire `src/features/hedge/types.ts` (`ProposalView`/`MarketMatchView`) — render directly off `@/shared/proposal`.
- One native `<input type="range">` stake slider, house-styled (no new dep — pending Q3).
- One Recharts payoff diagram component.
- Tests per the agreed strategy (Q1): at minimum unit tests for the slider transform + render-state selection.

**Out (non-goals):**

- Saving a hedge, `hedgeId`, `/hedge/[id]`, `/hedges` — `feature: saved-hedges`.
- Live single-market price refresh on the card — deferred (the one allowed request-path provider read).
- Slider/diagram on `alternatives` — `best` only; alternatives are comparison-only.
- Broad shadcn adoption — only the components this screen needs.
- Auth/accounts; real order placement; inline structured-edit of the parsed risk.

## Open questions (with recommendations) — for tech-lead + user

1. **Test strategy.** (a) add `@testing-library/react` + jsdom → real component tests; (b) thin `.tsx` + pure `.ts` unit tests for the slider transform + state selection + ONE Playwright smoke e2e; (c) pure-logic units only, defer e2e. **Rec: (b)** — lightest infra, tests the logic most likely to break, seeds the first e2e. Trade-off: JSX/markup is reviewer-verified, not test-verified.
2. **Payoff diagram design.** A: simple 2-outcome chart ("bad happens → net +$X" vs "doesn't → net −$stake"). B: continuous stake-vs-net curve as the slider sweeps. **Rec: A** — simplest honest read, pairs with the numeric callouts; B adds curve-sampling/axis complexity.
3. **Slider.** Native styled `<input type="range">` (no dep, house style) vs Radix (new dep, richer a11y). **Rec: native.**
4. **Unsized UX (`sized:false`).** **Rec:** show market+price+reasoning, add a "how much are you protecting? ($)" input; once positive, seed the slider via `suggestedStake` and drive the same `computeHedge` path (gives coverage numbers, one extra input step).
5. **Stale `hedge/types.ts`.** **Rec: retire** (grep-confirm nothing references it), render off `@/shared/proposal`.
