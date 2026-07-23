# Plan: propose — wire the 4-stage pipeline behind `POST /api/hedge`

## Branch

`feature/propose-hedge`

## Scope

Backend-only. Turn reranked matches into a sized `HedgeProposal` with payoff math, compose the four stages behind `POST /api/hedge`, add a narrow per-IP rate limiter, and fix one client return type. No UI. No persistence.

## Decisions on the 4 open questions

### Q1 — Persistence boundary: (b) return `HedgeProposal` inline, persist nothing

`/api/hedge` is a pure read/compute endpoint; it writes nothing.

- `docs/architecture.md` draws two separate arrows: `UI → /api/hedge/` (propose) and `UI → /api/hedges/ → DB` (save).
- `src/app/api/hedges/route.ts` already exists as the save stub ("Idempotent save lands in feature: saved-hedges"). Auto-saving pre-empts that feature.
- `SaveHedgeRequestSchema` demands a single, confirmed, sized hedge (client uuid, one provider/externalId/side, `entryPrice` gt(0).lt(1), positive `stakeUsd`). Propose produces 0–3 matches, some unsized/empty — no coherent row.
- Anonymous identity (`anonId` cookie) isn't built.
- **Only cost:** fix `requestHedge()` return type in `src/features/ask/api/index.ts` → `ApiResponse<HedgeProposal>`. Verified safe — `AskForm.tsx` reads only `data.ok`/`data.error.message`, never `hedgeId`.

### Q2 — Invalid price (AC 8): DROP the match

Chosen side-price ∉ (0,1) or non-finite → match removed, not returned with nulled payoff. A market whose side sits at 0/1 is degenerate (no honest hedge). Returning it `sized:false` would collide with AC 4's meaning ("user gave no exposure"). Dropping preserves the invariant: every returned match has `price ∈ (0,1)` and finite payoff. All-dropped → `{best:null, alternatives:[]}` (still 200). No `try/catch` around the math needed — the up-front price guard makes `computeHedge`'s `RangeError` unreachable; the Zod response schema pins payoff fields `.finite()` as backstop.

### Q3 — Rate limit: narrow, `/api/hedge`-only fixed window on existing Redis

- New `src/server/rate-limit.ts` reusing the shared `redis` (`src/server/cache.ts`) — no new dependency (not `@upstash/ratelimit`).
- Fixed window, key `ratelimit:hedge:${ip}`, `LIMIT=10`, `WINDOW=600s`: `c = await redis.incr(key); if (c===1) await redis.expire(key,600); allowed = c<=10`.
- Checked FIRST in the handler, before body parse and any stage → request 11 rejected before any token (AC 9).
- **Fail-open** on Redis error (ADR 005) — the limiter must not be the single point of failure for `/api/hedge`.

### Q4 — Response type: shared Zod schema, not extending UI `MarketMatchView`

Response crosses the API boundary → Zod schema as source of truth. Extending the UI interface would invert the dependency (server → `src/features/hedge`). Add `src/shared/proposal.ts` (`HedgeMatchSchema`, `HedgeProposalSchema`, `z.infer` types); `propose.ts` imports from there. Deriving the UI view from it is deferred to `feature: ui-ask-proposal`.

## File map

**Create**

- `src/shared/proposal.ts` — `HedgeMatchSchema`+`HedgeMatch`, `HedgeProposalSchema`+`HedgeProposal`. Payoff fields `.finite().nullable()`, `price` `.gt(0).lt(1)`.
- `src/server/rate-limit.ts` — `checkHedgeRateLimit(ip)` (INCR + conditional EXPIRE, fail-open) and `clientIp(req)` (`x-forwarded-for` first hop → `x-real-ip` → `'unknown'`). Reuses `redis` from `@/server/cache`.
- `src/server/pipeline/propose.test.ts` — pure `buildProposal` tests (AC 2,3,4,6,8,12).
- `src/server/rate-limit.test.ts` — limiter tests with mocked `redis`.
- `src/app/api/hedge/route.test.ts` — route tests, pipeline modules + limiter mocked (AC 13).

**Modify**

- `src/server/pipeline/propose.ts` — implement `buildProposal`; import types from `@/shared/proposal` (drop local placeholder); keep signature `(spec, matches)` and purity.
- `src/app/api/hedge/route.ts` — replace 501 body: rate-limit first → existing 400 validation → composed pipeline in `try/catch` → `ok(proposal)` / `err(...)`. Keep `dynamic='force-dynamic'`, `maxDuration=30`.
- `src/features/ask/api/index.ts` — return type → `ApiResponse<HedgeProposal>`.
- `docs/tasks/current.md` — move `feature: propose` to In progress; also move merged `rerank` → done.

**Do NOT touch:** `src/shared/hedgeMath.ts`, the three earlier stage modules, `src/app/api/hedges/route.ts` (save stays a stub).

## Design details

### `HedgeProposal` shape (`src/shared/proposal.ts`)

```
HedgeMatch = {
  provider: 'kalshi' | 'polymarket'; externalId: string; question: string; url: string
  closeTime: string | null           // ISO, serialized from Date
  yesPrice: number; noPrice: number; liquidityUsd: number | null
  side: 'YES' | 'NO'; relevance: 'high' | 'partial' | 'weak'; reasoning: string
  price: number                       // chosen side, ∈ (0,1) guaranteed
  sized: boolean                      // spec.exposureUsd !== null
  stakeUsd | shares | payoutIfWin | netIfBadOutcome |
  netIfGoodOutcome | coverageRatio | coveragePct : number | null   // all .finite().nullable()
}
HedgeProposal = { spec: HedgeSpec; best: HedgeMatch | null; alternatives: HedgeMatch[] (max 2) }
```

No `id` (client-generated at save time — reinforces Q1); no `prompt` (`spec.riskDescription` restates it).

### `buildProposal` control flow (pure)

```
mapOne(spec, match): HedgeMatch | null
  m = match.candidate.market
  price = match.side === 'YES' ? m.yesPrice : m.noPrice
  if !(Number.isFinite(price) && price > 0 && price < 1) return null            // AC 8 drop
  base = { provider, externalId, question, url,
           closeTime: m.closeTime?.toISOString() ?? null,
           yesPrice, noPrice, liquidityUsd: m.liquidityUsd ?? null,
           side, relevance, reasoning, price }
  if spec.exposureUsd === null                                                  // AC 4
     return { ...base, sized:false, stakeUsd:null, shares:null, payoutIfWin:null,
              netIfBadOutcome:null, netIfGoodOutcome:null, coverageRatio:null, coveragePct:null }
  stake = suggestedStake(spec.exposureUsd, price, m.liquidityUsd)               // AC 3 (+cap AC 12)
  r     = computeHedge({ stakeUsd: stake, price, exposureUsd: spec.exposureUsd })
  return { ...base, sized:true, stakeUsd:stake, ...r }

buildProposal:
  kept = matches.map(m => mapOne(spec,m)).filter(Boolean)
  return { spec, best: kept[0] ?? null, alternatives: kept.slice(1, 3) }
```

`suggestedStake`'s optional `liquidityCapUsd` receives `m.liquidityUsd` (`undefined` → uncapped). `async` kept only to preserve the stub signature.

### `POST /api/hedge` handler

```
1. ip = clientIp(req); if (!(await checkHedgeRateLimit(ip)).ok)
     return 429 err('RATE_LIMITED', 'Too many requests. Try again shortly.')   // AC 9
2. body = await req.json().catch(()=>null); p = HedgeRequestSchema.safeParse(body)
   if (!p.success) return 400 err('BAD_REQUEST', 'A non-empty `prompt` is required.')
3. try:
     spec       = await parseRisk(p.data.prompt)
     candidates = await retrieveCandidates(spec, p.data.prompt)
     matches    = await rerank(spec, candidates)
     proposal   = await buildProposal(spec, matches)
     return 200 ok(proposal)                                                    // AC 1,5
   catch:
     return 500 err('PIPELINE_ERROR', 'Could not build a hedge right now.')     // AC 7
```

Sequential (retrieve needs spec, reads Postgres directly). Stages use their default production seams; offline testing via module mocks (no `deps` param on the route). No provider import; no `Decimal` (retrieve already coerced to `number`).

### `src/server/rate-limit.ts`

```
HEDGE_RATE_LIMIT=10; HEDGE_RATE_WINDOW_SECONDS=600; keyFor(ip)=`ratelimit:hedge:${ip}`
clientIp(req): x-forwarded-for.split(',')[0].trim() || x-real-ip || 'unknown'
checkHedgeRateLimit(ip):
  try { c = await redis.incr(key); if (c===1) await redis.expire(key, 600)
        return { ok: c <= 10, remaining: max(0, 10-c) } }
  catch { return { ok: true, remaining: 10 } }        // fail-open
```

## Sequencing

1. `src/shared/proposal.ts` (contract) — unblocks all.
2. `buildProposal` + `propose.test.ts` (pure) — parallel with 3.
3. `rate-limit.ts` + `rate-limit.test.ts`.
4. `route.ts` composition + `route.test.ts` (needs 1–3).
5. `src/features/ask/api/index.ts` type fix (needs 1).
6. `docs/tasks/current.md` bookkeeping.
   Then gate: `typecheck · lint · test · evals · build`. No new eval.

## Tests & seams

- **`buildProposal` unit (AC 2,3,4,6,8,12):** YES vs NO price; sized happy path (six fields finite); unsized (nulls + `price` kept); empty → `{best:null,alternatives:[]}`; liquidity-cap; best/alternatives order + 3-cap; invalid price dropped (0/1/NaN; all-invalid → empty). Fixtures mirror `rank.test.ts` (`buildNormalizedMarket` + `RankedMatch` literals).
- **Route (AC 13), pattern from `health/route.test.ts`:** `vi.hoisted` + `vi.mock` the four pipeline modules and `@/server/rate-limit`. 400 bad body; 200 happy; 200 empty; 429 (assert no pipeline module ran); 500 (`retrieveCandidates` rejects). Optional grep-style check that the route never imports `@/server/providers`.
- **Rate limiter:** mock `@/server/cache` `redis` (`incr`/`expire`); 10th allowed / 11th blocked; `expire` only when `incr` returns 1; fail-open on reject.
- Route tested by mocking pipeline modules (not threading deps); `buildProposal` needs no mocks.

## Risks & mitigations

- **NaN/Infinity into a 200 (AC 8)** — up-front price guard makes `computeHedge`'s `RangeError` unreachable; schema `.finite()` backstop.
- **Rate-limit bypass / cost leak (AC 9)** — check is the first statement; route test asserts no pipeline module runs on a 429.
- **IP extraction** — Next 16 has no `NextRequest.ip`; read `x-forwarded-for`/`x-real-ip` headers; `'unknown'` fallback shares one bucket (accepted).
- **Fail-open vs closed** — fail-open (ADR 005); accepted bounded token-spend window during a Redis outage.
- **DB error → 500 (AC 7)** — only `retrieveCandidates` (Postgres) propagates; single try/catch maps it; parse/rerank degrade internally.
- **Request-path-no-providers** — route imports only pipeline stages + `@/shared`; retrieval reads Postgres/pgvector, never a provider client.
- **Purity of `buildProposal`** — imports limited to `@/shared/hedgeMath`, `@/shared/proposal`, types; enforced by the no-mock unit test.

## Deferred

- Saving a hedge / anon-cookie identity → `feature: saved-hedges`.
- UI `ProposalView`/`MarketMatchView` alignment + success-branch rendering → `feature: ui-ask-proposal`.
- Broader/global rate-limit hardening → backlog #9.

See ADR: `docs/adr/005-hedge-rate-limit.md`.
