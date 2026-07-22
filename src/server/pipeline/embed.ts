/**
 * Query + market embeddings via NVIDIA NIM (spec §6.0). Batched; market embeds
 * are skipped when textHash is unchanged. Degraded mode: embedding API down →
 * retrieval falls back to keyword-only.
 */
import { z } from 'zod'
import { env } from '@/config/env'
import { fetchJson, SchemaMismatchError } from '@/server/http'
import { payloadPreview } from '@/server/providers/normalize'

/** Bounded batch size for NIM embedding calls — spec AC 11. */
export const BATCH_SIZE = 64

/** Thrown when NIM returns a vector whose length != EMBEDDING_DIM (env). */
export class EmbeddingDimError extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number
  ) {
    super(`embedding dim mismatch: expected ${expected}, got ${actual}`)
    this.name = 'EmbeddingDimError'
  }
}

/** Thrown when NIM returns a different number of entries than were sent for
 * a batch — order is defended by sorting on `index`, but a dropped entry
 * would silently shift every later vector off-by-one against its input text. */
export class EmbeddingCountError extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number
  ) {
    super(`embedding count mismatch: expected ${expected}, got ${actual}`)
    this.name = 'EmbeddingCountError'
  }
}

const NimEmbeddingsResponseSchema = z.object({
  data: z.array(
    z.object({
      embedding: z.array(z.number()),
      index: z.number(),
    })
  ),
})

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

/**
 * Shared NIM embeddings fetch/parse/count-check/index-sort/dim-check
 * plumbing. `input_type` distinguishes indexed documents ('passage', used by
 * `embedOneBatch`/sync) from a search query ('query', used by `embedText`) —
 * the only difference the NIM embedding API cares about between the two
 * callers (spec AC 4: no duplication).
 */
async function nimEmbed(
  texts: readonly string[],
  inputType: 'passage' | 'query'
): Promise<number[][]> {
  const raw = await fetchJson<unknown>(`${env.NVIDIA_BASE_URL}/embeddings`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.NVIDIA_API_KEY}` },
    body: {
      input: texts,
      model: env.EMBEDDING_MODEL,
      input_type: inputType,
      encoding_format: 'float',
    },
  })

  const parsed = NimEmbeddingsResponseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new SchemaMismatchError(
      'NIM embeddings response',
      payloadPreview(raw)
    )
  }

  // Guard *count*, not just order: a dropped entry would otherwise shift
  // every later vector off-by-one against its input text while `embedded`
  // still reports the full count (reviewer finding, sync AC 13 sibling risk).
  if (parsed.data.data.length !== texts.length) {
    throw new EmbeddingCountError(texts.length, parsed.data.data.length)
  }

  // NIM returns entries with an `index` mapping back to the input order —
  // sort defensively rather than trust response order.
  const vectors = [...parsed.data.data]
    .sort((a, b) => a.index - b.index)
    .map(d => d.embedding)

  for (const vector of vectors) {
    if (vector.length !== env.EMBEDDING_DIM) {
      throw new EmbeddingDimError(env.EMBEDDING_DIM, vector.length)
    }
  }

  return vectors
}

async function embedOneBatch(texts: readonly string[]): Promise<number[][]> {
  return nimEmbed(texts, 'passage')
}

/**
 * Embeds a single search query for retrieval (spec §6.3). Uses NIM's
 * `input_type: 'query'` (asymmetric retrieval models encode queries and
 * indexed passages differently) — never silently returns a zero/partial
 * vector; any HTTP/schema/dim failure throws and propagates. The only
 * catcher is `retrieveCandidates`'s degraded-mode fallback (AC 15–16).
 */
export async function embedText(text: string): Promise<number[]> {
  const vectors = await nimEmbed([text], 'query')
  const vector = vectors[0]
  if (vector === undefined) {
    throw new EmbeddingCountError(1, vectors.length)
  }
  return vector
}

/**
 * Embeds `texts` in bounded batches of `BATCH_SIZE`, flattening the results
 * back into a single array aligned 1:1 with the input order. Throws
 * (`EmbeddingDimError` or `SchemaMismatchError`) rather than returning a
 * partial result — callers (sync) route that into the 'embedding' degraded
 * path (spec AC 13).
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const batches = chunk(texts, BATCH_SIZE)
  const results: number[][] = []
  for (const batch of batches) {
    const vectors = await embedOneBatch(batch)
    results.push(...vectors)
  }
  return results
}
