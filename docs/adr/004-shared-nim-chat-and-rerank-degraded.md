# ADR 004: Shared `nim-chat.ts` extraction + `[]`-only rerank degraded mode

**Status:** Accepted
**Feature:** rerank (`docs/features/rerank-llm/`)

## Context

`feature: rerank` introduces the **second** NIM chat-completions caller. ADR 002
deferred extracting a shared client "until `feature: rerank` introduces a second chat
caller," keeping `chatComplete`/`NimChatResponseSchema` local to `parse.ts`. That
extraction now touches already-merged, 100%-green parse code, so it must be
behavior-preserving. Separately, rerank's guardrail ("return empty rather than force a
match", AC 5) and its per-candidate, question-polarity-dependent `side` rule (AC 6)
constrain what a _no-LLM_ degraded result may legitimately contain. `RankedMatch` is a
fixed contract already imported by `propose.ts`.

## Decision

1. **Extract** `chatComplete`, `NimChatResponseSchema`, `ChatMessage`, `ChatFn`, and the
   pure `extractJsonObject` into `src/server/pipeline/nim-chat.ts`. Signature:
   `chatComplete(messages, model)`, with `temperature: 0` + `response_format:
json_object` hardcoded for both callers (no `opts`). `parse.ts` and `rank.ts` bind
   `LLM_PARSE_MODEL`/`LLM_RERANK_MODEL` respectively through the existing
   `deps.chat ?? default` seam. `parse.ts` re-exports a single-arg `chatComplete` bound
   to `LLM_PARSE_MODEL` so its public surface (and `parse.test.ts` + the parse eval) is
   unchanged — a pure refactor, not a behavior change.
2. **Rerank degraded mode returns `[]` unconditionally.** A formulaic no-LLM `side`
   cannot be trusted (side depends on per-market question polarity, which is model
   judgment per AC 6); a top-N-by-score fallback would emit the forced,
   possibly-wrong-side match the guardrail forbids. `[]` is pure, no-I/O, shape-valid,
   and honest.
3. **`RankedMatch` stays local to `rank.ts`** (no move to `shared/schemas.ts`, no
   `RankedMatchSchema`): it never crosses a runtime boundary needing Zod — the LLM wire
   shape is validated by `RerankResponseSchema`, and `RankedMatch` objects are
   constructed in code from caller-supplied `Candidate` identities. Moving it is churn
   on `propose.ts` for no benefit.

## Consequences

- Positive: one shared, tested chat client for all model callers (no duplicated
  auth/parse/error handling — the spec's headline); parse stays green unmodified;
  rerank's degraded contract is trivially correct; zero diff to `propose.ts`.
- Negative / accepted: `parse.ts` retains a thin bound `chatComplete` wrapper (a
  one-line indirection) to preserve its call surface; the shared client hardcodes
  `temperature: 0`, so a future caller needing a different temperature must add an
  `opts` parameter then (YAGNI now).
- Upgrade path: if a third caller needs non-JSON or non-zero-temperature output, widen
  `chatComplete` with an `opts?: { temperature?; responseFormat? }` argument — additive,
  no change to existing callers.
