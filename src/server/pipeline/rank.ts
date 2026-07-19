import type { HedgeSpec } from '@/shared/schemas'
import type { Candidate } from './retrieve'

/**
 * Stage 3 — LLM rerank (spec §6.4). Large model. Returns up to 3 ranked
 * matches, each with the correct `side` from the user's hedging perspective,
 * a qualitative relevance label, and one-sentence reasoning.
 * Guardrail: return an empty list rather than force a match.
 */
export interface RankedMatch {
  readonly candidate: Candidate
  readonly side: 'YES' | 'NO'
  readonly relevance: 'high' | 'partial' | 'weak'
  readonly reasoning: string
}

export async function rerank(
  _spec: HedgeSpec,
  _candidates: Candidate[]
): Promise<RankedMatch[]> {
  throw new Error('rerank: not implemented (feature: rerank)')
}
