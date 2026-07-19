# Evals

Two suites keep model choice honest (spec §6.7):

- **Parse (`cases.json`)** — free text → `HedgeSpec`, with field-level assertions.
  Covers every edge case (un-hedgeable, missing date/amount, ambiguous, non-English,
  emoji, typos, multiple risks, and adversarial/injection prompts).
- **Retrieval (`retrieval-cases.json`)** — prompt → expected market IDs against a
  **frozen fixture catalog** (`fixtures/catalog.json`) with pre-computed embeddings,
  checked in for CI determinism. Metrics: **recall@15** and **MRR**.

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
**tuned against this set, not guessed**; the keyword-only vs hybrid recall
comparison — with the "beach wedding" prompt as the worked example (keyword search
never sees the word "rain") — is recorded here once `feature: retrieval` lands.

> Status: harness skeleton. The metric gates activate when the parse/retrieval
> pipeline is implemented (see `run.ts` TODOs).
