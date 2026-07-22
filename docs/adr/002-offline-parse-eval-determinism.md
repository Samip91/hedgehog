# ADR 002: Deterministic offline parse evals via injected chat transport

**Status:** Accepted
**Feature:** parse (`docs/features/parse-hedgespec/`)

## Context

`parseRisk` calls a live NVIDIA NIM chat model, but `pnpm evals` must be
deterministic, API-cost-free, and green in CI from committed fixtures alone — the
sandbox cannot reach NIM (constraint restated in
`docs/features/parse-hedgespec/spec.md` Open Questions and `docs/tasks/current.md`).
`evals/run.ts` is a plain `tsx` script, so it cannot use `vi.mock` to intercept the
transport the way `src/server/pipeline/embed.test.ts` does. The retrieval side already
set a "frozen fixture" precedent (`evals/fixtures/catalog.json`). We must pick where the
seam lives (function-level DI vs an env-gated `fetchImpl` shim) and where recorded
responses live.

## Decision

1. `parseRisk(prompt, deps?: { chat?: ChatFn })` exposes a **function-level
   dependency-injection seam**. The default `chat` is the module-local `chatComplete`
   (the only code that touches the network). Offline, `evals/run.ts` injects
   `chat: async () => fixture[caseId]`.
2. Recorded assistant contents live in `evals/fixtures/parse-responses.json`
   (`Record<caseId, string>`), committed. Offline evals replay them; the runner errors
   if a case id is absent. Because live NIM is unreachable in the sandbox, the initial
   fixture is hand-authored with representative valid HedgeSpec JSON satisfying each
   case's `expect`; `evals:live` refreshes it against the real model.
3. `pnpm evals:live` (`EVALS_LIVE=1`) wraps the real `chatComplete` in a recorder that
   asserts the 6 cases against live NIM and rewrites the fixture — the single refresh
   path.
4. The NIM chat client stays **local to `parse.ts`** (mirroring `embed.ts`), not a
   shared `nim.ts`. Extraction is deferred until `feature: rerank` introduces a second
   chat caller.

Chosen over an env-gated `fetchImpl` shim because a real DI seam is shared by both the
tsx eval runner and the vitest units, eliminating divergence, and matches the
injectable-seam idiom already in `src/server/http.ts`.

## Consequences

- Positive: offline evals are hermetic and CI-safe with no secrets; one obvious refresh
  command; unit tests reuse the same `chat` seam without module mocking; no change to
  shared HTTP.
- Negative / accepted: fixtures can drift from live model behavior between refreshes —
  mitigated by `evals:live` as a manual pre-merge check (AC 14) and `temperature: 0`
  recordings.
- Upgrade path: when `feature: rerank` lands, lift `chatComplete` +
  `NimChatResponseSchema` into a shared `src/server/pipeline/nim-chat.ts`; the `ChatFn`
  seam and fixture mechanism carry over unchanged.
