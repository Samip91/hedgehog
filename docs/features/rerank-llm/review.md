# Review: `rerank` feature (`feature/rerank-llm`)

Reviewed against `spec.md` (AC 1–17), `plan.md`, ADR 004, and the `parse-hedgespec/review.md` precedent. Gate re-run: typecheck clean, lint clean, 169/169 tests pass, `pnpm evals` exits 0 with `rerankPassRate 100%`, `parsePassRate 100%`, `retrievalRecall@15 100%`.

## THE PARSE REFACTOR (AC 13) — verified behavior-preserving

Diffed the working tree. Pure extraction: `chatComplete`/`NimChatResponseSchema`/`extractJsonObject`/`tryChat`/`ChatFn` moved from `parse.ts` into `nim-chat.ts`; the extracted `chatComplete` is byte-for-byte identical (same URL/`Bearer`/`temperature:0`/`response_format:json_object`/`NimChatResponseSchema`/`choices[0] === undefined` guard, no `!`), only change is `model` becoming a parameter. `parse.ts` re-exports a single-arg `chatComplete(messages)` bound to `env.LLM_PARSE_MODEL` + re-exports `ChatMessage`/`ChatFn`; `parseRisk`/`extractAndParse`/retry/`degradedSpec` untouched. `parse-prompt.ts` is a one-line type-import swap. **`parse.test.ts` genuinely unmodified** and green; `propose.ts` still imports `RankedMatch` from `./rank`. No behavior drift — AC 13 met.

## Findings

### MINOR — missing-fixture hard-error swallowed for the `{empty:true}` case (AC 15)

`evals/run.ts` `offlineRerankChatFor` throws a helpful "fixture missing — run `pnpm evals:live`" error, but `rerank` wraps every chat call in `tryChat`, which catches all throws → returns `[]`. For `guardrail-empty`, `scoreRerankCase` marks `result.length === 0` as PASS. So if the `guardrail-empty` fixture entry ever goes missing, `pnpm evals` passes silently — contradicting AC 15 ("fails loudly if a case id has no fixture"). The three non-empty cases still fail the gate on a missing fixture (rate drops → exit 1), but the explicit error never surfaces on the eval path. Not blocking (all four fixtures present, evals green). **Fix:** in `runRerankCases`, assert `fixtures[c.id] !== undefined` before calling `rerank` (a pre-check outside the swallowed chat path). **→ fixed in this feature.**

## Accepted limitations (not defects)

- **Hand-authored fixtures / offline eval.** `rerank-responses.json` is hand-authored to satisfy each `expect`; offline eval exercises the mapping+scoring pipeline and prompt structure, not live-model side/injection robustness — the ADR-002-accepted trade-off, mitigated by `evals:live` (AC 17) + the structural two-role guarantee. Not vacuous: an always-`[]` rerank scores 1/4 = 25% < 85% → fails the gate.
- **Sentence-shape (terminal `.?!`) not in the schema** — enforced in the fixture unit test, per the plan's deliberate "don't over-reject live output"; AC 7's "reviewer-agreed ceiling" allows it.

## AC verdict

All 17 met (AC 15 with the minor caveat above, being fixed). AC 1 (model=`LLM_RERANK_MODEL`, asserted `!== parse model`), AC 4 (subset-only + object identity `.toBe`), AC 5 (`[]` no retry), AC 8/9 (exactly 2 calls), AC 10 (two-role, no leak), AC 11/12 (never throws → `[]`), AC 13 (parse unchanged) all verified. No `any`/`!` in new modules; Zod at the LLM boundary; env only via config; fixed contracts unmodified.

VERDICT: APPROVE

Relevant files: `nim-chat.ts`, `rank.ts`, `rerank-prompt.ts`, `parse.ts`, `parse-prompt.ts`, `rank.test.ts`, `evals/run.ts` (MINOR), `evals/rerank-cases.json`, `evals/fixtures/rerank-responses.json`.
