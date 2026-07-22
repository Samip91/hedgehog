# Evals

Two suites keep model choice honest (spec §6.7):

- **Parse (`cases.json`)** — free text → `HedgeSpec`, with field-level assertions.
  Covers every edge case (un-hedgeable, missing date/amount, ambiguous, non-English,
  emoji, typos, multiple risks, and adversarial/injection prompts).
- **Retrieval (`retrieval-cases.json`)** — prompt → expected market IDs against a
  **frozen fixture catalog** (`fixtures/catalog.json`). The catalog carries **no**
  pre-computed embeddings — offline runs derive both the query vector and every
  market vector from `searchText` at eval time via a deterministic bag-of-words
  hash embedder (`evals/lib/toy-embed.ts`; see ADR 003), so nothing goes stale and
  CI needs zero secrets. Metrics: **recall@15** and **MRR**.

## Running

```bash
pnpm evals        # offline: recorded parses + fixtures. Deterministic, zero cost. CI runs this.
pnpm evals:live   # EVALS_LIVE=1 — hits live NVIDIA NIM + DB locally.
```

## Gates

- Parse pass rate ≥ **0.85** across ~40 cases.
- Retrieval recall@15 ≥ **0.85**; MRR reported.

## Methodology & weight tuning

Hybrid score = `0.60·cosine + 0.25·keyword + 0.15·liquidityBoost`. Weights are
module constants in `src/server/pipeline/retrieve.ts`, tuned against this set —
not guessed. The `toyEmbed` offline embedder validates retrieval **logic**
(filters, scoring, dedupe, ranking), not real embedding **quality**; a semantic
keyword-only-vs-hybrid comparison (the "beach wedding" prompt never contains the
word "rain") is `evals:live`'s job against a real DB + NIM.

> Status: both gates (parse pass rate, retrieval recall@15) are wired and green
> offline. `evals:live` still needs a provisioned Postgres + live NIM to refresh
> fixtures and validate real embedding quality.
