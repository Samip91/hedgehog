/**
 * Deterministic bag-of-words "toy" embedder for offline retrieval evals
 * (ADR 003) — validates retrieval *logic* (filters/scoring/dedupe/ranking),
 * explicitly NOT real embedding *quality* (that's `evals:live`'s job).
 *
 * Pure, no network, no imports of server code — safe for the `tsx` eval
 * runner and for future unit tests alike.
 */

const DIM = 64

/** 32-bit FNV-1a — small, fast, deterministic string hash. */
function fnv1a(token: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * `text` → 64-d hashed bag-of-words vector, L2-normalized. All-zero input
 * (no tokens) stays the all-zero vector rather than dividing by zero.
 */
export function toyEmbed(text: string): number[] {
  const vector = new Array<number>(DIM).fill(0)
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? []
  for (const token of tokens) {
    const bucket = fnv1a(token) % DIM
    const current = vector[bucket] ?? 0
    vector[bucket] = current + 1
  }

  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0))
  if (norm === 0) return vector
  return vector.map(x => x / norm)
}

/** Cosine similarity — dot product of the (re-)normalized inputs; `0` for a
 * zero vector (rather than `NaN` from a divide-by-zero). */
export function cosineSim(a: readonly number[], b: readonly number[]): number {
  const normA = Math.sqrt(a.reduce((sum, x) => sum + x * x, 0))
  const normB = Math.sqrt(b.reduce((sum, x) => sum + x * x, 0))
  if (normA === 0 || normB === 0) return 0

  let dot = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0)
  }
  return dot / (normA * normB)
}
