# Feature: hardening

## Problem / user value

Hedgehog's full loop (risk → sized hedge → save → track) is code-complete but not
production-safe: unprotected API routes can be hammered or scraped, the browser gets
no security headers, failures on the request path leave no trace to debug from, and
the app cannot be installed or used with a flaky connection. This slice makes the app
safe to deploy (`feature: ship` depends on it) and, for end users, installable as a
real app on their home screen with an offline-capable shell.

## User stories

- As an operator, I want every mutating/listing API route rate-limited per IP, so
  that a single client can't exhaust LLM spend, DB load, or scrape the saved-hedges store.
- As an operator, I want standard security headers on every response, so the app
  isn't trivially vulnerable to clickjacking, MIME-sniffing, or script injection via
  reflected content.
- As an on-call engineer, I want structured JSON logs on server errors and
  degraded-mode events, so a production incident is diagnosable from logs alone,
  without leaking secrets or user prompts.
- As a mobile user, I want to install Hedgehog to my home screen and have it open
  instantly with a usable shell even on a bad connection, so it feels like a real app.

## Acceptance criteria (testable)

### 1. Rate limits

1. `checkHedgeRateLimit` is generalized into a reusable `checkRateLimit(bucket, ip, limit, windowSeconds)` (or the `@upstash/ratelimit` equivalent — tech-lead's call); `/api/hedge`'s behavior (10/10min/IP, request 11 → **429 before any pipeline stage**) is unchanged and still covered by its existing test.
2. `POST /api/hedges` (save) is rate-limited per IP (rec: 20/10min); exceeding → **429 before any DB write**.
3. `GET /api/hedges` + `GET /api/hedges/[id]` are rate-limited per IP (rec: 60/min); exceeding → **429 before any DB read**.
4. `DELETE /api/hedges/[id]` is rate-limited per IP (rec: 30/min); exceeding → **429 before any DB write**.
5. `GET /api/health` has a loose limit (rec: 120/min) — normal polling never trips it.
6. `POST /api/cron/sync` gets **no** new limiter — its `Bearer CRON_SECRET` auth is the guard; reviewer confirms none was added (avoid over-building).
7. Every 429 uses the existing `err(code, message)` envelope + includes a `Retry-After` header (or equivalent).
8. On Redis error, every limited route **fails open** (matches ADR 005) — tested per newly-limited route.
9. Per-bucket limit/window values are env-tunable via `src/config/env.ts` with sane defaults (no direct `process.env`).

### 2. Security headers

10. Every response (pages + API) includes `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, and a frame-block (`X-Frame-Options: DENY` or CSP `frame-ancestors 'none'`) — asserted by a test on ≥1 page route and ≥1 API route.
11. A `Content-Security-Policy` is present and does **not** break the UI: the Recharts payoff diagram (inline styles/SVG) and dev TanStack devtools still render — reviewer manual check on `/hedge/[id]` + ask screen with CSP active; Playwright check for no CSP console violation if feasible.
12. The CSP allows no arbitrary third-party script (no `script-src *`; scripts `'self'` at minimum).
13. Headers apply uniformly — no undocumented per-route opt-out.

### 3. Structured logging

14. `src/server/log.ts` exports leveled functions emitting structured JSON (`{level, msg, ts, ...fields}`), gated by a `LOG_LEVEL` env (added to `env.ts`, sane default) — unit-tested for JSON shape + level filtering.
15. Every `catch`→500 in `/api/hedge`, `/api/hedges` (GET/POST), `/api/hedges/[id]` (GET/DELETE), `/api/cron/sync` logs a structured error (with an error id) **without changing the response body/status** — route test asserts a log call on a forced failure.
16. Degraded signals (`SyncResult.degraded`, `/api/health` `degraded[]`) emit a structured `warn` when non-empty — tested on the sync path.
17. No log includes the anon-id cookie, the full raw prompt (truncate ~100 chars if logged), or any credential — reviewer code-read AC (manual).

### 4. PWA service worker

18. A service worker (`public/sw.js`, hand-rolled or library) registers on load in production builds and precaches the app shell (layout assets, manifest, icons, offline fallback) — Playwright: load → `navigator.serviceWorker.ready` → go offline → reload → offline fallback / cached shell renders (not a browser error).
19. Strategy is network-first for HTML/API, cache-first for static assets; a redeploy doesn't serve stale JS indefinitely (rec: build-versioned cache name, `skipWaiting()` + `clients.claim()`) — reviewer reads the SW for strategy + versioning.
20. `manifest.webmanifest` gains real validated icons: ≥1 maskable PNG (≥512×512) + `favicon.ico`/`apple-touch-icon.png`, replacing the SVG-only set — manifest-shape test + manual installability check.
21. `layout.tsx` links the new icons alongside existing `manifest`/`appleWebApp` metadata — reviewer diff read.
22. Installable: manual check (documented in the PR) — DevTools > Application > Manifest shows no errors, install entry available.

## Scope

**In:** generalize the rate limiter + apply to `hedges` (GET/POST), `hedges/[id]` (GET/DELETE), `health`; global security headers (HSTS/nosniff/Referrer/Permissions/frame + CSP); a small structured JSON logger wired into 500 paths + degraded emission (no response change); a service worker for offline app-shell + installability + missing icon assets + manifest/layout wiring; env additions for rate-limit tunables + `LOG_LEVEL`.

**Out (non-goals):** actual deploy / Vercel/Neon/Upstash provisioning / cron schedule (`feature: ship`); the live `/api/markets/[key]` route (`feature: live-price`); auth/accounts (anon cookie unchanged; limiting is IP-based); a full observability stack (metrics/tracing/log-shipping — stdout JSON is the bar); a strict nonce CSP (pragmatic static CSP is the bar; nonce is a follow-up); perfect Lighthouse / exhaustive caching / push (a working installable SW with offline shell is the bar); rate-limiting `/api/cron/sync` (already bearer-authed).

## Open questions (with recommendations) — tech-lead resolves

1. **Limiter: generalize hand-rolled vs adopt `@upstash/ratelimit` (installed, unused).** Rec: **generalize** the atomic `SET NX EX`+INCR into `checkRateLimit(bucket, ip, limit, window)` (keeps ADR-005 seam, zero change to `/api/hedge`); library adoption a labeled follow-up. Keep fail-open. Suggested defaults: hedges POST 20/10min, GET 60/min, DELETE 30/min, health 120/min.
2. **CSP strictness + placement.** Rec: **pragmatic static CSP** via `next.config.ts` `headers()` (`style-src 'unsafe-inline'` for Recharts; `script-src`/`frame-ancestors`/`object-src` locked to `'self'`/`'none'`); `report-only` first if risky, then enforce. Nonce-based CSP (`middleware.ts`) a follow-up. Other headers uncontroversial/static.
3. **Logging shape.** Rec: small custom JSON logger (no pino/winston dep); log route 500s (error id + route) + sync degraded events; never log cookie/full prompt(truncate ~100)/credentials; `LOG_LEVEL` env (info prod / debug dev).
4. **PWA library vs hand-rolled + caching.** Rec: try `@serwist/next` (App-Router-native) if Next 16-compatible on a quick check, else hand-rolled `public/sw.js` registered client-side; network-first pages/API, cache-first static, build-versioned cache + `skipWaiting`/`clients.claim`; generate maskable PNG + favicon + apple-touch from the existing `/icon.svg`.
