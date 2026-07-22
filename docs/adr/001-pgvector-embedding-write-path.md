# ADR 001: Writing pgvector embeddings through Prisma's `Unsupported` column

**Status:** Accepted
**Feature:** sync (`docs/features/sync-catalog/`)

## Context

`MarketSnapshot.embedding` is `Unsupported("vector(1024)")` in
`prisma/schema.prisma`. Prisma's typed client cannot read or write `Unsupported`
columns, and `src/server/pipeline/retrieve.ts`'s doc header already states vectors
go through a typed `$queryRaw`. Sync must _write_ one vector per dirty market after
the normal `upsert`, and `embedBatch` must POST to NVIDIA NIM while `fetchJson`
(`src/server/http.ts`) is GET-only.

## Decision

1. **Write path:** perform the row `upsert` via the normal Prisma client (all
   scalar columns, no embedding), then in a separate call set the vector with
   `$executeRaw`:
   ```ts
   await db.$executeRaw`
     UPDATE "MarketSnapshot"
     SET embedding = ${`[${vector.join(',')}]`}::vector, "textHash" = ${textHash}
     WHERE provider = ${provider}::"Provider" AND "externalId" = ${externalId}`
   ```
   The vector is passed as a parameterized string literal (not interpolated SQL)
   and cast `::vector`; the enum arg is cast `::"Provider"`. `textHash` is advanced
   here, atomically with the embedding, so a failed/absent embed leaves the
   _previous_ hash and vector intact (satisfies AC 13's "no partial/corrupt
   write"). Because upsert and vector-write are two statements, dirty-row embedding
   writes run after all upserts; a mid-run `embedBatch` failure simply skips the
   vector writes.
2. **HTTP path:** extend `FetchJsonOptions` in `src/server/http.ts` with optional
   `method?` and `body?` (JSON-encoded, defaulting to GET) rather than adding a
   second HTTP stack. This reuses the existing timeout/retry/jitter/breaker and is
   backward-compatible with all current GET callers. `embedBatch` then calls
   `fetchJson` with `method:'POST'`. (Fallback if the reviewer prefers zero change
   to shared http: a thin `embed-client.ts` with an injectable `fetchImpl`.)

## Consequences

- Vector writes bypass Prisma type-safety, so they are covered by a focused
  integration test and a runtime dim-check (`embedBatch` throws on
  `length !== env.EMBEDDING_DIM`).
- The HNSW index (`prisma/sql/001_enable_pgvector.sql`) must use
  `vector_cosine_ops` to match retrieval's cosine scoring and `vector(1024)` to
  match `EMBEDDING_DIM`. Migration remains authored-only per spec AC 21.
- Extending `fetchJson` keeps a single hardened HTTP path; the change is additive
  and all existing GET callers are unaffected.
