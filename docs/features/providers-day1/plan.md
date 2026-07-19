# Plan: providers-day1

## Branch

`feature/providers-day1`

## Approach

Build bottom-up: harden HTTP first (pure, fully unit-testable), then the two
clients on top of it, each isolated behind the existing `MarketProvider`
interface (`src/server/providers/types.ts`). Reuse the existing `NormalizedMarket`
shape and `registry.ts`. Prices/liquidity stay `number` here; Decimal conversion
happens later at the DB boundary (`provider-enum.ts` already exists for casing).

## File map

- `src/server/http.ts` — implement `fetchJson` (timeout via `AbortController`,
  per-status retry, exp backoff + jitter) and `CircuitBreaker` (replace stubs).
- `src/server/http.test.ts` — new. Fake timers; retry policy + breaker states.
- `src/server/providers/schemas.ts` — new. Zod schemas for raw Kalshi/Polymarket
  payloads + `SchemaMismatchError`.
- `src/server/providers/normalize.ts` — new. Shared helpers (cents→prob, build
  searchText, binary/open filter).
- `src/server/providers/kalshi.ts` — implement `fetchOpenMarkets`/`fetchMarket`.
- `src/server/providers/polymarket.ts` — implement, defensive JSON-string parsing.
- `src/server/providers/*.test.ts` — new. Fixture-based: happy path, schema
  mismatch, timeout, retry, non-binary skip.
- `src/server/providers/fixtures/*.json` — trimmed recorded payloads.
- `scripts/verify-providers.ts` — new. Live smoke: fetch both, print counts.

## Sequencing

1. `http.ts` + tests (no network) → gate green.
2. Verify live endpoint shapes (WebFetch/curl) → finalize Zod schemas + fixtures.
3. Kalshi + Polymarket clients (independent — parallelizable) + tests.
4. Registry already wired; add `scripts/verify-providers.ts`.
5. Full gate + live smoke (500+ markets).

## Tests & evals

Vitest, densest on the breaker (fake timers) and normalize helpers. Provider
clients tested against recorded fixtures (happy/mismatch/timeout/retry). No live
calls in CI; the smoke script is local-only.

## Risks & mitigations

- **Live API drift** → Zod-validate + `SchemaMismatchError` logs trimmed payload;
  fixtures pin the known-good shape for CI.
- **Provider outage** → breaker opens, serves fast-fail; degraded flag is
  `feature: sync`'s job, breaker is the primitive.
- **exactOptionalPropertyTypes friction** on optional normalized fields → build
  objects conditionally, don't assign `undefined`.
