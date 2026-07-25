# Plan: hardening

## Branch

`feature/hardening`

## Approach

Four independent concerns in one slice, sharing almost no code (only `src/config/env.ts` tunables + bookkeeping). Build/test each on its own. Verified from installed sources: Next 16.2.10 `async headers()` (`{source, headers:[{key,value}]}`) applies to page + `/api/*` routes; `metadata.icons` accepts `{icon, apple}` arrays. `@serwist/next` is NOT installed and Next-16 compat is unverifiable → **hand-rolled SW**. `sharp` NOT installed → **zero-dep icon generation**. Zero `console.*` in `src/` today → the logger writes via `process.stdout.write` to preserve that.

**1. Rate limits — generalize the ADR-005 seam.** Extract `rate-limit.ts`'s atomic `SET NX EX`+INCR into `checkRateLimit(bucket, ip, limit, windowSeconds)` (key `ratelimit:${bucket}:${ip}`); `checkHedgeRateLimit` becomes a one-line wrapper (`bucket='hedge'`, existing constants) — `ratelimit:hedge:${ip}` + 10/600 behavior + existing test all byte-identical. Wire new buckets as the FIRST statement of each handler (429 `err` + `Retry-After`, before any `getAnonId`/`db`). Fail-open inherited. `@upstash/ratelimit` (installed-unused) = labeled follow-up.

**2. Security headers — static via `next.config.ts`, no middleware.** Pure `src/config/security-headers.ts` returns the header array (incl. CSP); `next.config.ts` returns it from `async headers()` for `source:'/(.*)'` (uniform, no per-route opt-out). Pragmatic static CSP: `script-src`/`connect-src`/`worker-src` `'self'`, `frame-ancestors`/`object-src` `'none'`, but `style-src 'unsafe-inline'` (Recharts inline SVG styles) + `script-src 'unsafe-inline'` (Next streaming, no nonce w/o middleware). Dev-only `'unsafe-eval'`+`ws:` gated off the config `phase` (no `process.env`). Nonce CSP = follow-up.

**3. Structured logging — ~40-line JSON logger, no pino/winston.** `src/server/log.ts` leveled fns serialize `{level,msg,ts,...redacted}` via `process.stdout.write`, gated by `LOG_LEVEL` env. `redact()` drops cookie/creds/token keys + truncates `prompt` to ~100 chars; `newErrorId()` stamps 500s (log-only). Wire into the five `catch`→500 sites + the two degraded emitters. Response bodies/status untouched.

**4. PWA — hand-rolled `public/sw.js` + client registrar + real icon binaries.** SW precaches app shell (`/`,`/offline`,manifest,icons), network-first navigations/API with `/offline` fallback, cache-first static, versioned cache purged on activate, `skipWaiting()`+`clients.claim()`. A `'use client'` `ServiceWorkerRegister` registers `/sw.js` on load ONLY when `NODE_ENV==='production'` (build constant), mounted in `layout.tsx`. Icons via committed zero-dep `scripts/gen-icons.mjs` (node `zlib`) → solid-`#0a0a0a` maskable PNGs (512/192) + 180 apple-touch + 32 favicon (solid placeholders acceptable).

## File map

### Concern 1 — Rate limits (backend engineer)

- `src/server/rate-limit.ts` — add `checkRateLimit(bucket, ip, limit, windowSeconds)`; `checkHedgeRateLimit` → wrapper. Keep other exports.
- `src/config/env.ts` — add `RL_HEDGES_SAVE_LIMIT/_WINDOW` (20/600), `RL_HEDGES_READ_LIMIT/_WINDOW` (60/60), `RL_HEDGES_DELETE_LIMIT/_WINDOW` (30/60), `RL_HEALTH_LIMIT/_WINDOW` (120/60) — `z.coerce.number().int().positive().default(...)`.
- `src/app/api/hedges/route.ts` — GET (`hedges:read`) + POST (`hedges:save`) limited first.
- `src/app/api/hedges/[id]/route.ts` — GET (`hedges:read`) + DELETE (`hedges:delete`) first.
- `src/app/api/health/route.ts` — GET (`health`) first.
- `src/app/api/hedge/route.ts` — add `Retry-After` to the existing 429 (additive).
- `.env.example` — document RL_* vars.

### Concern 2 — Security headers (frontend engineer)

- `src/config/security-headers.ts` — **create.** `securityHeaders(isDev): {key,value}[]` + CSP builder.
- `next.config.ts` — **modify.** `(phase) => NextConfig` with `async headers()` → `[{source:'/(.*)', headers: securityHeaders(phase===PHASE_DEVELOPMENT_SERVER)}]`.

### Concern 3 — Structured logging (backend engineer)

- `src/server/log.ts` — **create.** `logger.{debug,info,warn,error}(msg, fields?)`, `newErrorId()`, internal `redact()`.
- `src/config/env.ts` — add `LOG_LEVEL: z.enum(['debug','info','warn','error']).default('info')`.
- `.env.example` — document `LOG_LEVEL`.
- `src/app/api/hedge/route.ts`, `src/app/api/cron/sync/route.ts` — add `logger.error` in existing catch (body unchanged).
- `src/app/api/hedges/route.ts`, `[id]/route.ts` — wrap bodies in `try/catch` → `logger.error` + `err('INTERNAL','Something went wrong.')` 500.
- `src/server/sync.ts` — `if (degraded.length) logger.warn('sync degraded', { degraded })`.
- `src/app/api/health/route.ts` — `if (degraded.length) logger.warn('health degraded', { degraded })`.

### Concern 4 — PWA (frontend engineer)

- `public/sw.js` — **create** (lifecycle below).
- `src/app/service-worker-register.tsx` — **create** (`'use client'` registrar).
- `src/app/layout.tsx` — **modify** (add `metadata.icons`, mount `<ServiceWorkerRegister/>`).
- `public/manifest.webmanifest` — **modify** (add PNG icon entries, keep SVG).
- `src/app/offline/page.tsx` — **create** (static offline shell).
- `public/{icon-192,icon-512,apple-touch-icon}.png`, `public/favicon.ico` — **create** (via script).
- `scripts/gen-icons.mjs` — **create** (zero-dep generator; run once, commit outputs).
- `e2e/offline.spec.ts` — **create** (Playwright, prod-only — see Risks).

### Bookkeeping

- `docs/tasks/current.md` — remove merged `saved-hedges` (`f91e723`), add `hardening`.
- `docs/tasks/done.md` — append `saved-hedges`.

## Resolved open questions

1. **Limiter → generalize** the atomic fixed-window (keeps ADR-005 seam, zero `/api/hedge` change); `@upstash/ratelimit` deferred. Fail-open. Defaults: hedges POST 20/10min, GET 60/min, DELETE 30/min, health 120/min.
2. **CSP → pragmatic static** in `next.config.ts` (directives below); enforce directly (policy permits every inline the app uses), documented fallback to `-Report-Only` if the reviewer's manual check flags a violation. Nonce CSP = follow-up.
3. **Logging → small custom JSON logger** (`process.stdout.write`), `LOG_LEVEL` env, redact cookie/creds/token + truncate prompt to 100, log-only error id, no response change.
4. **PWA → hand-rolled SW** (unverifiable `@serwist/next` Next-16 compat), zero-dep `zlib` icon script (no `sharp`), network-first pages/API + cache-first static + versioned cache + skipWaiting/claim, register prod-only.

## Design details

**`checkRateLimit(bucket, ip, limit, windowSeconds)`** — key `ratelimit:${bucket}:${ip}`, same `SET key 1 {nx,ex}`→`INCR`→`count<=limit`, same `catch → {ok:true, remaining:limit}` fail-open. `checkHedgeRateLimit(ip)=checkRateLimit('hedge', ip, HEDGE_RATE_LIMIT, HEDGE_RATE_WINDOW_SECONDS)`. Call site:

```
const ip = clientIp(req)
const rl = await checkRateLimit('hedges:save', ip, env.RL_HEDGES_SAVE_LIMIT, env.RL_HEDGES_SAVE_WINDOW)
if (!rl.ok) return NextResponse.json(err('RATE_LIMITED','Too many requests. Try again shortly.'), { status:429, headers:{ 'Retry-After': String(env.RL_HEDGES_SAVE_WINDOW) } })
```

(GET handlers currently take `_req` — rename to `req` to read the IP.)

**Header set (every response):** `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` · `X-Content-Type-Options: nosniff` · `Referrer-Policy: strict-origin-when-cross-origin` · `X-Frame-Options: DENY` · `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()` · **CSP:** `default-src 'self'`; `script-src 'self' 'unsafe-inline'`(+`'unsafe-eval'` dev); `style-src 'self' 'unsafe-inline'`; `img-src 'self' data: blob:`; `font-src 'self' data:`; `connect-src 'self'`(+`ws:` dev); `worker-src 'self'`; `manifest-src 'self'`; `frame-ancestors 'none'`; `base-uri 'self'`; `form-action 'self'`; `object-src 'none'`.

**Logger:** level rank `debug<info<warn<error`, emit if `rank(level) >= rank(env.LOG_LEVEL)`; `process.stdout.write(JSON.stringify({level,msg,ts:ISO,...redact(fields)})+'\n')`. `redact()` drops `anonId,cookie,authorization,token,secret,apiKey,password`, truncates `prompt` to 100+`…`. `newErrorId()` = `crypto.randomUUID().slice(0,8)` (log-only). Catch:

```
} catch (e) {
  const errorId = newErrorId()
  logger.error('hedges.POST failed', { route:'POST /api/hedges', errorId, err: e instanceof Error ? e.message : String(e) })
  return NextResponse.json(err('INTERNAL','Something went wrong.'), { status:500 })
}
```

**SW (`public/sw.js`):** `const VERSION='v1'; const CACHE=\`hedgehog-${VERSION}\`; const SHELL=['/','/offline','/manifest.webmanifest','/icon-192.png','/icon-512.png','/apple-touch-icon.png','/favicon.ico']`. `install`→`caches.open(CACHE).then(c=>c.addAll(SHELL))`+`skipWaiting()`. `activate`→delete caches `!==CACHE`+`clients.claim()`. `fetch`(GET only; return early otherwise so POST/DELETE never touch cache): navigations→network-first, on reject`caches.match(request)`→`caches.match('/offline')`; `/_next/static/_`+fonts+icons→cache-first; `/api/_`→network-first no-cache. **Registrar:** `if ('serviceWorker' in navigator && process.env.NODE_ENV==='production') window.addEventListener('load', ()=>navigator.serviceWorker.register('/sw.js'))`.

**Manifest icons:** add `{src:'/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'}`, `{src:'/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any maskable'}` (keep the SVG entry). **Layout `metadata.icons`:** `icon:[{url:'/favicon.ico',sizes:'32x32'},{url:'/icon.svg',type:'image/svg+xml'},{url:'/icon-192.png',type:'image/png',sizes:'192x192'}]`, `apple:[{url:'/apple-touch-icon.png',sizes:'180x180'}]`.

## Sequencing

1. **Env first** (shared): `env.ts` + `.env.example` (RL_* + LOG_LEVEL) — small, unblocks the rest.
2. **Backend engineer** owns rate-limit + logging (both touch the `hedges` routes — one owner avoids conflicts): generalize `rate-limit.ts` → wire 4 routes; `log.ts` → wire 5 catch sites + 2 degraded emitters.
3. **Frontend engineer** owns headers + PWA (independent of the API routes): `security-headers.ts`+`next.config.ts`; `gen-icons.mjs`→run→SW+registrar+offline page+manifest+layout icons.
4. Bookkeeping last. Then gate.

## Tests & seams (no new evals)

- **rate-limit unit** (node): existing hedge cases stay; add `checkRateLimit` for an arbitrary bucket (key shape, allow/block at limit, fail-open).
- **rate-limit route** (hedges, hedges/[id], health — node): mock `@/server/rate-limit`; assert `ok:false`→429+`Retry-After` and `db` NOT called (429-before-work); `ok:true`→normal.
- **header unit** (`security-headers.test.ts`, node): each key/value present; CSP contains each directive; `isDev=true` adds `'unsafe-eval'`/`ws:`, false doesn't. Pure module (no `next.config` import).
- **logger unit** (`log.test.ts`, node): spy `process.stdout.write`; JSON shape, level filter (debug suppressed at info), redaction (anonId absent, prompt truncated, authorization dropped).
- **logging wiring**: route + `sync.test.ts` mock `@/server/log`; assert `logger.error` on forced failure, `logger.warn` on non-empty degraded.
- **manifest shape** (`src/app/manifest.test.ts`, node): parse manifest; assert a 512 `image/png` `maskable` entry + favicon/apple-touch referenced.
- **offline e2e** (`e2e/offline.spec.ts`): SW ready → offline → reload → offline shell. **Needs a prod server** (`next build && next start`; SW is prod-only) — ship it but document as CI/manual-only (same posture as `ask-proposal.spec.ts`).

## Risks & mitigations

- **CSP breaking Recharts/hydration/devtools** — `style-src`+`script-src 'unsafe-inline'`; dev `'unsafe-eval'`/`ws:` gated off `phase`; fallback to `-Report-Only` if manual check flags. Nonce CSP follow-up.
- **SW stale JS on redeploy** — versioned cache purge + skipWaiting/claim + network-first navigations/scripts.
- **SW interfering with dev/tests** — registrar gated by `NODE_ENV==='production'`; dev + the existing Playwright dev webServer never register it; offline e2e needs a prod server (flagged).
- **Rate-limit fail-open** — single shared `checkRateLimit` catch; asserted per route.
- **Logging leak / response change** — `redact()`; error id log-only; `/api/hedge`+`/api/cron/sync` byte-identical bodies; `hedges` gains a standard `err('INTERNAL')` 500 (success paths untouched); reviewer no-leak read.
- **Env additions** — all through Zod `.default()`; `SKIP_ENV_VALIDATION` build unaffected; no `process.env` except the SW registrar's build-time `NODE_ENV`.
- **Icons must be valid binaries** — `gen-icons.mjs` (`zlib`) emits valid solid-color PNG/ICO.
- **Vitest split** — all new unit tests `.ts` → node project; `ServiceWorkerRegister` kept logic-free (covered by e2e).

See ADR: `docs/adr/008-hardening-cross-cutting.md`.
