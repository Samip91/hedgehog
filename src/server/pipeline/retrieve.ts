import type { HedgeSpec } from '@/shared/schemas'
import type { NormalizedMarket } from '@/server/providers/types'

/**
 * Stage 2 — hybrid retrieval (spec §6.3):
 *   0.60·cosine + 0.25·keyword + 0.15·liquidityBoost, after hard filters
 *   (status, closeTime within deadline+30d, liquidity floor, domain when
 *   parse confidence is high), then cross-provider dedupe, top 15.
 *
 * pgvector HNSW cosine top-50 runs through a typed $queryRaw wrapper here
 * (Prisma has no native vector type).
 */
export interface Candidate {
  readonly market: NormalizedMarket
  readonly cosine: number
  readonly keyword: number
  readonly score: number
}

export async function retrieveCandidates(
  _spec: HedgeSpec,
  _rawPrompt: string
): Promise<Candidate[]> {
  throw new Error('retrieveCandidates: not implemented (feature: retrieval)')
}
