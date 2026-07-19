-- Run once against the database before the first `prisma migrate` that adds the
-- embedding column. pgvector is a Postgres extension Prisma cannot enable via the
-- schema, so it lives here (spec §4). Neon supports pgvector out of the box.

CREATE EXTENSION IF NOT EXISTS vector;

-- After `prisma migrate` creates "MarketSnapshot", add the HNSW index for fast
-- cosine similarity search (spec §4). Keep the dimension in sync with
-- EMBEDDING_DIM and prisma vector(N).
--
--   CREATE INDEX IF NOT EXISTS marketsnapshot_embedding_hnsw
--     ON "MarketSnapshot" USING hnsw (embedding vector_cosine_ops);
