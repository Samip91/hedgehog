# Review: providers-day1

**Verdict: APPROVE** (with one deferred verification the sandbox can't perform).

## Acceptance criteria

- [x] `fetchJson` retry policy (429/5xx/network/timeout retried w/ backoff+jitter;
      400/401/403/404 + TLS fail fast; honors Retry-After) — 7 tests.
- [x] `CircuitBreaker` open → cooldown → half-open probe → close — 4 tests, injected clock.
- [x] Kalshi client: midpoint→prob, cents/100, searchText from event+title+subtitle,
      price-less markets dropped — fixture tests.
- [x] Polymarket client: defensive JSON-string parsing, non-binary + closed skipped,
      money strings coerced — fixture tests.
- [x] Zod validation with `SchemaMismatchError` (trimmed payload) on both providers.
- [~] **500+ live markets** — smoke script written and import-verified, but the CI
  sandbox blocks outbound HTTP to the providers. **Must be run on a machine with
  open network:** `pnpm verify:providers`. This is the one criterion not
  closable here.

## Checks

- Correctness: normalizers are pure and unit-tested against fixtures incl. the
  edge cases (no-price, 3-way, closed). Prices clamped to [0,1] and rounded to 4dp
  to match the Decimal(6,4) column.
- Security: no secrets; provider payloads validated at the boundary; `any`-free.
- Architecture: clients sit behind `MarketProvider`; request path untouched; casing
  boundary (`provider-enum.ts`) unused here (DB writes are `feature: sync`).
- Conventions: exactOptionalPropertyTypes respected via `buildNormalizedMarket`.

## Follow-ups (not blockers)

- Enrich Kalshi `eventTitle` with the real event name (needs the events endpoint);
  currently uses `event_ticker`.
- Confirm live field names against a real response and freeze recorded fixtures.
