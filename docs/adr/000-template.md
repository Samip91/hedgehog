# ADR-NNN — <title>

- **Status:** proposed | accepted | superseded by ADR-XXX
- **Date:** YYYY-MM-DD
- **Deciders:** <who>

## Context

What problem forced a decision? What constraints (serverless target, free tiers,
timeline) apply?

## Decision

The choice, stated plainly.

## Consequences

- Positive: …
- Negative / accepted costs: …
- Documented upgrade path: …

---

The product's foundational decisions (ADR-001…005) are recorded in the spec (§3)
and land as individual files here during feature work:

1. ADR-001 — Simulated execution only.
2. ADR-002 — Cron sync instead of queue workers.
3. ADR-003 — Hybrid retrieval (pgvector + keyword + filters → LLM rerank).
4. ADR-004 — Anonymous cookie identity.
5. ADR-005 — No numeric LLM confidence scores.
