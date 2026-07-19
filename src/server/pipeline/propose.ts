import type { HedgeSpec } from '@/shared/schemas'
import type { RankedMatch } from './rank'
import { computeHedge, suggestedStake } from '@/shared/hedgeMath'

/**
 * Stage 4 — assemble the proposal (spec §6.5). Combines the ranked matches
 * with hedge math into the response the Proposal screen renders. The math
 * itself lives in the pure, unit-tested `@/shared/hedgeMath`.
 */
export interface HedgeProposal {
  readonly spec: HedgeSpec
  readonly matches: RankedMatch[]
  // full payoff breakdown assembled per match — see hedgeMath
}

export async function buildProposal(
  _spec: HedgeSpec,
  _matches: RankedMatch[]
): Promise<HedgeProposal> {
  // Intentionally references the real math module so its API stays wired.
  void computeHedge
  void suggestedStake
  throw new Error('buildProposal: not implemented (feature: propose)')
}
