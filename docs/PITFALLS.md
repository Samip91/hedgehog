# Pitfalls — read before writing code or reviewing

A running list of non-obvious traps in this codebase and its stack. Add to it
whenever something bites you (that's the whole point).

## Stack surprises

- **Next.js 16: `params` is async.** In dynamic routes and route handlers,
  `params` is a `Promise` — you must `await params` (or `use(params)` in a Client
  Component). The bundled docs (`node_modules/next/dist/docs/`) are authoritative
  for this exact version; when in doubt, read them. (Note: this differs from some
  older project conventions where params was a plain object.)
- **Prisma is pinned to v6, not v7.** Prisma 7 removed `url` from the datasource
  block and requires driver adapters + `prisma.config.ts`. We baseline on stable
  v6 (`url = env("DATABASE_URL")` in schema). Upgrading to 7 is a deliberate,
  separate task — don't drift into it accidentally.
- **pgvector is not a Prisma type.** The `embedding` column is
  `Unsupported("vector(1024)")`; all vector queries go through a typed
  `$queryRaw` wrapper in `src/server/pipeline/retrieve.ts`. Enable the extension
  with `prisma/sql/001_enable_pgvector.sql` before migrating.
- **Money & probability are `Decimal`, never `Float`.** Both in Prisma columns
  and in intent. Convert to `number` only at the pure-math boundary
  (`src/shared/hedgeMath.ts`).

## Project rules that bite if ignored

- **Never read `process.env` directly.** Everything goes through
  `src/config/env.ts` (Zod, fail-fast). Add new vars there and to `.env.example`.
- **The request path never calls providers.** Only the cron sync and the single
  live-price route may. Reading a provider inside `/api/hedge` is a bug.
- **Vector dimension must match everywhere:** `EMBEDDING_DIM`, `vector(N)` in the
  schema, and the HNSW index. Confirm the embedding model's real output dim on
  day 1.
- **Provider name casing differs by layer — convert at exactly one boundary.**
  `NormalizedMarket.provider` (and the UI view types) use lowercase `'kalshi'` /
  `'polymarket'` — the natural output of the provider clients. The Prisma
  `Provider` enum and `SaveHedgeRequest` use uppercase `'KALSHI'` /
  `'POLYMARKET'`. Convert only at the DB boundary via `toProviderEnum` /
  `fromProviderEnum` in `src/server/providers/provider-enum.ts`. Do **not**
  scatter `.toUpperCase()` through sync/save code — upserting a normalized market
  without the converter is a Zod/Prisma validation error waiting to happen.
