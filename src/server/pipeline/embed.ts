/**
 * Query + market embeddings via NVIDIA NIM (spec §6.0). Batched; market embeds
 * are skipped when textHash is unchanged. Degraded mode: embedding API down →
 * retrieval falls back to keyword-only.
 */
export async function embedText(_text: string): Promise<number[]> {
  throw new Error('embedText: not implemented (feature: retrieval)')
}

export async function embedBatch(_texts: string[]): Promise<number[][]> {
  throw new Error('embedBatch: not implemented (feature: sync)')
}
