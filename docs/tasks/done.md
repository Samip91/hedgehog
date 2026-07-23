# Done

Newest first.

- **`feature: rerank`** — LLM rerank (large model, `LLM_RERANK_MODEL`) over the top-15
  `Candidate[]` → up to 3 `RankedMatch` (correct YES/NO `side`, `relevance`
  high/partial/weak, one-sentence reasoning); subset-only mapping, one
  retry-on-invalid, injection-safe two-role prompt, `[]`-only degraded fallback
  (guardrail). Headline: extracted the shared `nim-chat.ts` client out of `parse.ts`
  (ADR 004) — behavior-preserving, `parse.test.ts` green unmodified. Merged to
  `develop` via **PR #6** (`0977ecd`). Reviewer APPROVED (1 round + a missing-fixture
  loud-error fix), full offline gate green (typecheck · lint · test 169/169 · evals:
  parse 100%, retrieval recall@15 100%, rerank 100% · build w/
  `SKIP_ENV_VALIDATION=1`).

- **`feature: retrieval`** — `embedText` (NIM query embedding) + `retrieveCandidates`:
  hard filters → hybrid score (`0.60·cosine + 0.25·keyword + 0.15·liquidity`) →
  cross-provider dedupe → top-15 `Candidate[]`; pgvector HNSW cosine top-50 via typed
  `$queryRaw`; keyword-only degraded fallback. `evals/run.ts` wired with recall@15 ≥
  0.85 gate + report-only MRR, deterministic offline via injected seams + a toy
  embedder (ADR 003). Merged to `develop` via **PR #5** (`1f3d527`). Reviewer APPROVED.
  Offline gate green (test 140/140, recall@15 100%). **Follow-ups (backlogged):** grow
  `evals/fixtures/catalog.json` beyond 2 markets so recall@15/MRR/dedupe discriminate;
  persist `url`/slug on `MarketSnapshot` for faithful deep links.

- **`feature: parse`** — `parseRisk()`: NIM chat (`LLM_PARSE_MODEL`) → JSON-only
  `HedgeSpec`, Zod `safeParse` + one retry feeding the error back, degraded
  keyword-only fallback; injection-safe two-role prompt; `evals/run.ts` wired with
  a `parsePassRate ≥ 0.85` gate (offline via a committed DI fixture — ADR 002).
  Merged to `develop` via **PR #4** (`358f3c3`). Reviewer APPROVED, full offline
  gate green (typecheck · lint · test 115/115 · evals 100% · build). **Pending:**
  refresh `evals/fixtures/parse-responses.json` against live NIM via
  `pnpm evals:live` (offline fixture is hand-authored; sandbox can't reach NIM).

- **`feature: sync`** — cron sync → normalize + upsert `MarketSnapshot` → hash-diff
  embed → pgvector (`$executeRaw` write) + Redis hot catalog; `/api/health`;
  per-provider + `embedding` degraded flags; pgvector HNSW index authored. Merged to
  `develop` via **PR #3** (`f30b67c`). Reviewer APPROVED across 3 rounds (1 blocker +
  2 minors, then a 4-finding hardening pass incl. the silent catalog-wipe guard).
  Offline gate green (test 84/84). **Integration still owed** — AC 5 (Decimal-on-wire)
  and AC 6 (no-dupe/`updatedAt`) are unit-mocked only; need a live Postgres + pgvector
  run + applying the (authored, not applied) migration. See
  `docs/features/sync-catalog/review.md`.

- **Foundation bootstrap** — Next.js 16 + TS strict-plus scaffold, feature-slice
  layout, Prisma 6 + pgvector schema, Zod env, pure hedge math + tests, eval
  harness skeleton, git-flow (main/develop) + husky/commitlint/gitleaks, CI, and
  the local `.claude/` multi-agent workflow.
