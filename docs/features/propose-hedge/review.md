# Review — `propose` feature (`feature/propose-hedge`)

Traced the full request path (`route.ts` → parse/retrieve/rerank/propose), the math wiring (`mapOne` → `suggestedStake` → `computeHedge`), the rate limiter, and every AC against its test. Core is sound: payoff wiring correct, price guard airtight, rate-limit off-by-one right, persistence/provider boundaries hold. Gate green (203/203, evals unchanged).

## Findings

### 1. MINOR (real bug) — orphaned rate-limit counter can permanently block an IP

`src/server/rate-limit.ts`. `redis.incr` and `redis.expire` are two separate calls; `expire` runs only when `count === 1`. If `incr` succeeds (creating the key with NO TTL) but `expire` throws, the `catch` fail-opens _this_ request (correct) — but the key now lives forever. Every later request increments it (`count !== 1`, so `expire` is never retried); once it crosses 10 that IP (or the shared `'unknown'` bucket) is **permanently 429'd** until the key is manually deleted.

- Contradicts the fail-open design goal ("the limiter must not be the single point of failure") and ADR 005's stated "self-heals on next EXPIRE … for at most one window" — with `expire` gated on `count === 1`, it never self-heals.
- **Fix (applied in this feature):** make window creation + TTL atomic — `SET key 1 { nx:true, ex:600 }` to init, then `INCR` on subsequent requests (a key with a value always has a TTL). Also correct ADR 005's inaccurate self-heal consequence.

### 2. MINOR (informational) — the `.finite()` schema "backstop" isn't wired into the route

`src/app/api/hedge/route.ts` returns `ok(proposal)` without parsing through `HedgeProposalSchema`, yet the plan + `proposal.ts` docs cite the schema's `.finite()` payoff fields as a runtime backstop against `NaN/Infinity` reaching a 200. That validation only runs in `propose.test.ts`. No functional impact today (the up-front `Number.isFinite(price) && price>0 && price<1` guard makes `computeHedge`'s `RangeError` unreachable, and finite inputs — incl. `liquidityUsd=0` → `stake=0` — cannot yield non-finite payoff), but the documented defense-in-depth is illusory. **Fix (applied):** validate the response through `HedgeProposalSchema.safeParse` before `ok(...)`; on failure treat as a pipeline error (500), making the documented backstop real.

## AC verification (all 13 met)

| AC                                                  | Status                                                        |
| --------------------------------------------------- | ------------------------------------------------------------- |
| 1 pipeline in sequence, 200                         | Met (route test asserts stage data-dependency)                |
| 2 side-price selection                              | Met                                                           |
| 3 sized: suggestedStake→computeHedge, args correct  | Met (6 fields cross-checked vs real math)                     |
| 4 unsized → 7 nulls, price kept                     | Met                                                           |
| 5 empty → {best:null,alternatives:[]}, 200          | Met                                                           |
| 6 best=first, alternatives=next 0–2 in order        | Met (slice(1,3))                                              |
| 7 propagated failure → 500, no partial body         | Met                                                           |
| 8 invalid price dropped, no NaN/Inf in 200          | Met (0/1/NaN + mixed + all-invalid)                           |
| 9 10/10min per IP, 11th → 429 before any stage      | Met (check first; count<=10; no stage on 429)                 |
| 10 writes nothing                                   | Met (no Prisma import; static grep; requestHedge change safe) |
| 11 buildProposal pure                               | Met (zero mocks in unit test)                                 |
| 12 unit coverage incl. liquidity-cap + invalid-drop | Met                                                           |
| 13 route tests 400/200/200-empty/429/500            | Met                                                           |

Also confirmed: no `any`/non-null `!`; `closeTime` Date→ISO|null, `liquidityUsd` undefined→null; no Decimal leak; route imports no provider client (static test); malformed JSON → 400. `clientIp` header-spoofing accepted per ADR 005.

VERDICT: APPROVE

---

## Re-review (round 2) — after fixes

Both minors resolved, no new defects (suite 206/206, evals unchanged):

- **Finding 1 (rate-limit orphan) — fixed.** `checkHedgeRateLimit` now inits the window
  atomically with `redis.set(key, 1, { nx:true, ex:600 })`, INCR only on the `null`
  (already-exists) branch — so a key with a value always carries a TTL; the
  permanent-block path is gone. 10th-allowed / 11th-blocked boundary preserved; fail-open
  holds if `set` rejects or if `set`→null then `incr` rejects; `remaining` math correct.
  ADR 005 updated (atomic `SET NX EX`; the inaccurate "self-heals on next EXPIRE" line
  removed).
- **Finding 2 (schema backstop) — fixed.** The route now `HedgeProposalSchema.safeParse`s
  the proposal before responding — malformed output (non-finite payoff / `price ∉ (0,1)`)
  → 500 `PIPELINE_ERROR`, never a 200. Verified no false-reject of valid sized/unsized/
  empty proposals; 500 semantics for propagated infra failures unchanged.

VERDICT: APPROVE (round 2)
