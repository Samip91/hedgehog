# Feature: providers-day1

## Problem / user value

Hedgehog can only match a risk to a market if it has a live catalog of markets.
This feature builds the two provider clients (Kalshi, Polymarket) and the
HTTP-hardening layer they depend on — the raw material every later feature
(sync, retrieval, proposal) reads from. No user-facing UI yet; this is the data
spine.

## User stories

- As the sync job, I want each provider behind one `MarketProvider` interface so
  I can fetch and normalize markets uniformly.
- As the platform, I want provider calls to be resilient (timeouts, retries,
  circuit breaking) so one flaky provider never takes down a request or a sync.

## Acceptance criteria (testable)

- [ ] `fetchJson(url, { timeoutMs, retries })` times out, retries per policy
      (429/5xx/network/timeout retried with backoff+jitter; 400/401/403/404 and
      TLS never retried), and honors `Retry-After` on 429.
- [ ] `CircuitBreaker` opens after ≥5 consecutive failures, serves fast-fail for
      60s, half-opens with a probe, and closes on success. Unit-tested with fake
      timers.
- [ ] `kalshiProvider.fetchOpenMarkets()` returns `NormalizedMarket[]` — prices in
      0–1 from the live string `*_dollars` fields (bid/ask midpoint, else last_price),
      `searchText = event_ticker + title + yes_sub_title`, illiquid all-zero dropped.
- [ ] `polymarketProvider.fetchOpenMarkets()` returns `NormalizedMarket[]` —
      defensively parses the JSON-encoded `outcomes`/`outcomePrices` strings,
      skips non-binary markets, prices already 0–1.
- [ ] Provider payloads are Zod-validated; a schema mismatch throws a
      `SchemaMismatchError` with the trimmed payload (not a silent crash).
- [ ] A dev script prints **500+** normalized live markets across both providers.

## Scope

**In:** `http.ts` (fetchJson + breaker), `kalshi.ts`, `polymarket.ts`, a shared
normalize helper, registry wiring, Zod provider schemas, fixtures + unit tests, a
`scripts/verify-providers.ts` smoke script.

**Out (non-goals):** the cron sync loop, embeddings, DB writes, Redis (all
`feature: sync`). Live trading APIs (simulated only, per ADR-001).

## Open questions

- Exact live endpoint paths/params must be verified against provider docs on day 1
  (both version their APIs) before finalizing the Zod schemas.
