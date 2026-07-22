# Review: `retrieval` (feature/retrieval-hybrid)

Adversarial review against `spec.md` (AC 1–21), `plan.md`, ADR 003/001. Gate re-run: typecheck clean, lint clean, 29 unit tests pass, `pnpm evals` offline green (recall@15 100%, MRR 1.000, zero network).

## Focus-area verdicts (all CONFIRMED)

1. **pgvector `$queryRaw` (AC 14) — SAFE.** Query vector reaches SQL only as bound tagged-template params (`${literal}::vector`, `LIMIT ${k}`), never concatenated. Cosine correct: `1 - (embedding <=> …)` (`<=>` = cosine distance). `embedding` referenced only inside `<=>`/`IS NOT NULL`, never SELECTed into JS. `LIMIT` bound, sole call passes `VECTOR_TOP_K = 50`. `VectorRowSchema`/`DecimalLikeSchema` are real Zod-at-the-boundary; malformed rows skipped, not fatal.
2. **Degraded mode (AC 15/16) — CORRECT.** try/catch wraps ONLY `await embed(...)`; `vectorTopK`/`keywordPool` are outside it so a Postgres failure propagates while a NIM failure degrades to keyword-only (`cosine: 0` on all). Hard filters run uniformly in both modes.
3. **Hard filters (AC 5–8) — CORRECT, no off-by-one.** deadline parsed as UTC midnight, `+30d`, `closeTime > windowEnd → exclude` (so `deadline+30d` retained); missing closeTime excluded only when deadline set; no filter when null. Liquidity floor excludes only present-and-below (unknown retained — correct AC 7 reading). Domain filter only at confidence high.
4. **Hybrid score + determinism (AC 9/10) — CORRECT.** `combineScore` exactly `0.6·cosine + 0.25·keyword + 0.15·boost`; `liquidityBoost` clamps [0,1], undefined→0; sort is a total order (score desc → provider asc → externalId asc), input-order-independent.
5. **`keywordScore` reuse swap — NO REGRESSION (scrutinized).** Now uses `buildSearchText(riskDescription, location, asset, threshold, rawPrompt)` — same five fields, same order, differing only by whitespace normalization, which `tokenize` (`/[a-z0-9]+/g`, len ≥ 2) erases. Token set identical; scores unchanged.
6. **Keyword + dedupe (AC 4/11) — CORRECT.** `keyword = |q ∩ market| / |q|`, empty→0. `questionSignature` sorts tokens (order-independent), keeps numeric tokens ("below 60000" ≠ "below 70000"). Dedupe keeps higher score, runs before the top-15 cut.
7. **`embedText` (AC 1–4) — CORRECT.** Shares `nimEmbed([text], 'query')` (no duplication); `input_type: 'query'`; dim+count checked in the shared helper; failures propagate; `vectors[0]` guarded without `!`.
8. **Offline eval integrity (AC 17–21) — CORRECT.** recall = |expected ∩ top15|/|expected| averaged; gate `< 0.85` → exit(1), independent of parse gate. `toyEmbed`/`cosineSim` pure and network-free. Permissive spec + 2-market catalog = trivial smoke test, but explicitly acknowledged (ADR 003); filter/scoring/dedupe covered by unit tests. README's stale "pre-computed embeddings" claim corrected.
9. **Boundary/types — CLEAN.** No `any`, no `!`; Zod at `$queryRaw` + fixture boundaries; env only via config; module constants (not env vars); fixed contracts unmodified.
10. **Test quality — SUBSTANTIVE.** AC 14 test asserts `$queryRaw` called once with numeric `LIMIT ≤ 50` and `findMany` NOT run; Postgres-propagation tests assert `.rejects` for both paths.

## Findings

- **[minor] `run.ts` MRR uses first expected-id in list order, not min-rank.** For a case with multiple `expectedMarketIds`, it reports the rank of the first expected id that appears in `top`, not the smallest rank among all hits. No impact today (MRR is report-only, no gate; every current case has one expected id). Fix: compute `min` over ranks of all hit ids. **→ fixed in this feature (cheap, prevents latent wrongness once the catalog grows).**
- **[minor / note] Eval is a smoke test, not coverage.** 2-market catalog + permissive spec makes recall@15 trivially 1. Documented/accepted (ADR 003, plan Q2 deferred); flagged so it isn't mistaken for real retrieval-quality validation. Follow-up (grow catalog with distractors + cross-provider duplicate) is backlogged.

No blockers or majors. The request-path-reads-DB + calls-NIM-embed carve-out (plan risk #5) not flagged, per design.

## Acceptance criteria

All 21 met. AC 18 (MRR) met as report-only, with the multi-id caveat above.

VERDICT: APPROVE
