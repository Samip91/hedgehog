# Backlog

Ordered roughly by the delivery plan (spec §10). Pull the top item into
`current.md` when starting it.

1. `feature: providers-day1` — provider clients + normalizer + http hardening.
2. `feature: sync` — pgvector migration + HNSW, cron sync, /api/health, degraded flags.
3. `feature: parse` — HedgeSpec parse prompt (few-shots, retry-on-invalid) + evals.
4. `feature: retrieval` — query embedding + hybrid retrieve + fixture recall@15.
5. `feature: rerank` — LLM rerank + relevance labels.
6. `feature: propose` — hedge math wiring + /api/hedge end-to-end + degraded modes.
7. `feature: ui-ask-proposal` — payoff diagram, stake slider, staged loading.
8. `feature: saved-hedges` — anon cookie, idempotent save, /hedges + lazy settlement.
9. `feature: hardening` — rate limits, headers, logging, PWA service worker.
10. `feature: ship` — deploy (Vercel + Neon + Upstash + cron), README, demo.
