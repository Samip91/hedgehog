# Review — feature `hardening`

Gate on `feature/hardening`: `typecheck` clean · `lint` clean · **429/429 tests pass** · `SKIP_ENV_VALIDATION=1 build` succeeds (all routes emit, `/offline` prerendered static). No `console.*` in `src/`. No `any`/non-null `!` in the new modules.

## Focus-area verdicts

**1. Rate-limit generalization — no regression.** `checkHedgeRateLimit` is a pure wrapper over `checkRateLimit('hedge', ip, 10, 600)`. Key stays `ratelimit:hedge:${ip}`; atomic `SET NX EX`→conditional `INCR`→`count<=limit` + `catch → {ok:true}` fail-open byte-identical (original hedge tests still assert it). On every newly-limited handler the limit check is the **first statement** before `getAnonId`/`db`/cookie: hedges GET/POST, hedges/[id] GET/DELETE, health GET. Each 429 uses `err('RATE_LIMITED')` + `Retry-After` = the window. Buckets/limits match the plan (save 20/600, read 60/60, delete 30/60, health 120/60). `cron/sync` has NO limiter, statically asserted (AC 6). Fail-open + 429-before-work tested per route (db/Redis not called).

**2. Logging — no secret leak, no response change.** `redact()` drops `anonId/cookie/authorization/token/secret/apiKey/password` + truncates `prompt` to 100+`…` (asserted). Every call site passes only `{route, errorId, err:<message string>}` or `{degraded:string[]}` — no raw prompt/cookie/credential logged. Responses unchanged: `/api/hedge` still `PIPELINE_ERROR` 500, `/api/cron/sync` still `SYNC_FAILED` (logging additive in the existing catch); the `hedges` routes' new `logAndFail` fires only on a genuine throw → `err('INTERNAL')`, leaving the 400/403/404/429 paths untouched. Logger writes via `process.stdout.write` only.

**3. CSP / headers — safe and non-breaking.** All 6 headers present with sane values. CSP locks `script-src 'self' 'unsafe-inline'` (no `*`/host), `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`. `'unsafe-eval'`/`ws:` correctly **dev-only**, gated off `phase === PHASE_DEVELOPMENT_SERVER`; prod CSP proven to contain neither. `worker-src`/`manifest-src 'self'` allow the SW+manifest; `img-src 'self' data: blob:`/`connect-src 'self'`/`font-src 'self' data:` permissive enough for Recharts/TanStack/self-hosted fonts without being open. Applied to `source:'/(.*)'` (AC 13). Inert on `/api/*` JSON.

**4. PWA SW — correct, no footguns.** `fetch` returns early for non-GET, so POST/DELETE to `/api/hedges` are never cached/replayed. Navigations network-first with `/offline` fallback; `/api/*` passthrough never cached; static assets cache-first. Versioned cache `hedgehog-v1` purged on `activate` + `skipWaiting`/`clients.claim`. Registration prod-only (`NODE_ENV` inlined). Icons valid non-zero binaries (PNG magic on all three PNGs, ICO header), referenced in manifest + layout. `/offline` in the precache SHELL.

**5. Env + boundaries.** All `RL_*`+`LOG_LEVEL` via Zod `.default()` (`SKIP_ENV_VALIDATION` build unaffected). No `process.env` outside `env.ts` + the registrar's build-time `NODE_ENV`. `logAndFail` returns generic `err('INTERNAL')`; real message log-only.

**6. Test quality.** Tests trace to ACs and assert substance (429-before-work: db not called; fail-open; CSP dev-vs-prod; redaction; level filter; manifest maskable-512 + on-disk icons; degraded→`logger.warn`; the 4 fixed route tests keep their original assertions). No vacuous tests.

## Acceptance criteria

Covered (code+test): 1–10, 12–17, 19, 20. Covered by code-read (e2e/manual-only, accepted — sandbox can't run the prod-only Playwright/DevTools checks): 11, 18, 21, 22 (`e2e/offline.spec.ts` present + documented prod-server-only). No gaps.

## Findings (minor / informational — none blocking; tracked as follow-ups)

- **minor:** logged `err` is the raw `Error.message`; a Prisma failure's message could embed a hedge `id`/`anonId` into stdout. Log-only (client gets the generic envelope), not the cookie/prompt/credential AC 17 enumerates — not an AC violation. If logs are shipped later, map known infra errors to a code rather than echoing `.message`. Redaction is shallow (accepted); every current call site passes a string for `err`.
- **minor:** `public/sw.js` precaches `/manifest.webmanifest` in SHELL but the `fetch` handler doesn't serve it offline (falls through to a network fetch). Cosmetic — the manifest isn't needed at runtime once installed. Adding `/manifest.webmanifest` to `isStaticAsset` would close it.

VERDICT: APPROVE
