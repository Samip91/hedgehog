# ADR 006: UI component-test infrastructure — Vitest jsdom project + RTL + Playwright smoke

**Status:** Accepted
**Feature:** ui-ask-proposal (Q1 = full component tests, decided by user)

## Context

This is the first UI slice with real interaction (slider drag, exposure input, live
payoff). Today `vitest.config.ts` runs a **single node project**,
`include: ['src/**/*.{test,spec}.ts']` — `.tsx` is excluded and no Testing Library/DOM
env exists. 206 backend unit tests depend on `environment: 'node'` and must not
regress. The user decided on **full component tests** (Q1a), which requires a DOM env +
`@testing-library/react`, while the backend suite stays on node. Recharts (already a
dep) renders SVG and uses `ResizeObserver`, which a DOM shim must provide.

## Decision

Adopt **Vitest `projects`** in the existing `vitest.config.ts` (no separate workspace
file — removed in Vitest 4):

- **node project** — `environment: 'node'`, `include: ['src/**/*.{test,spec}.ts']`
  (unchanged). All 206 existing tests stay here, untouched.
- **jsdom project** — `environment: 'jsdom'`, `include: ['src/**/*.{test,spec}.tsx']`,
  `setupFiles: ['./vitest.setup.ts']`. Add devDeps `@testing-library/react`,
  `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`. `vitest.setup.ts`
  wires jest-dom matchers, `afterEach(cleanup)`, and a `ResizeObserver` stub for Recharts.

The `.ts`/`.tsx` include globs are mutually exclusive, so environment selection is by
file extension — backend tests never load jsdom. Coverage stays scoped to
`shared/**`+`server/**` (UI is behavior-tested, not coverage-gated). Keep **one
Playwright smoke** (`e2e/ask-proposal.spec.ts`) for the happy path; it stubs
`POST /api/hedge` via `page.route` so it runs offline/deterministically in the sandbox.
**jsdom** is chosen over happy-dom for broader RTL/SVG/`ResizeObserver` compatibility on
this first setup.

## Consequences

- Positive: real component tests for the interactive states the user asked for; backend
  suite provably isolated on node (extension-split globs); zero runtime deps added (all
  dev-only); a reusable jsdom project + `vitest.setup.ts` every future UI slice inherits;
  the first e2e seeded.
- Negative / accepted: four dev dependencies + jsdom's cost; Recharts SVG can't be
  meaningfully asserted in jsdom (mitigated: unit-test the transform, assert numeric DOM,
  smoke via Playwright); the offline e2e stubs the API, so it doesn't exercise the live
  pipeline.
- Upgrade path: if suite runtime grows, swap jsdom → happy-dom (setup file is the only
  touch-point); the Playwright smoke can graduate to a live CI-with-services job without
  changing the component-test layer.
