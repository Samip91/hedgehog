# Done

Newest first.

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
