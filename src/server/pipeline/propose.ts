import type { HedgeSpec } from '@/shared/schemas'
import type { HedgeMatch, HedgeProposal } from '@/shared/proposal'
import type { RankedMatch } from './rank'
import { computeHedge, suggestedStake } from '@/shared/hedgeMath'

/**
 * Stage 4 — assemble the proposal (spec §6.5). Combines the ranked matches
 * with hedge math into the response the Proposal screen renders. The math
 * itself lives in the pure, unit-tested `@/shared/hedgeMath`.
 *
 * Pure: no network/DB calls — every input is already in memory (mirrors
 * `hedgeMath`'s purity, AC 11). `async` is kept only to preserve the stub's
 * signature; nothing here awaits.
 */

/** The 7 payoff fields, all `null`, for the unsized (`spec.exposureUsd === null`) case. */
const NULL_PAYOFF: Pick<
  HedgeMatch,
  | 'sized'
  | 'stakeUsd'
  | 'shares'
  | 'payoutIfWin'
  | 'netIfBadOutcome'
  | 'netIfGoodOutcome'
  | 'coverageRatio'
  | 'coveragePct'
> = {
  sized: false,
  stakeUsd: null,
  shares: null,
  payoutIfWin: null,
  netIfBadOutcome: null,
  netIfGoodOutcome: null,
  coverageRatio: null,
  coveragePct: null,
}

/**
 * One `RankedMatch` → `HedgeMatch`, or `null` if the chosen side's price is
 * out of range (AC 8 — the match is dropped, not returned with nulled
 * payoff, so `sized: false` unambiguously means "no exposure given").
 */
function mapOne(spec: HedgeSpec, match: RankedMatch): HedgeMatch | null {
  const m = match.candidate.market
  const price = match.side === 'YES' ? m.yesPrice : m.noPrice

  if (!(Number.isFinite(price) && price > 0 && price < 1)) return null

  const base = {
    provider: m.provider,
    externalId: m.externalId,
    question: m.question,
    url: m.url,
    closeTime: m.closeTime?.toISOString() ?? null,
    yesPrice: m.yesPrice,
    noPrice: m.noPrice,
    liquidityUsd: m.liquidityUsd ?? null,
    side: match.side,
    relevance: match.relevance,
    reasoning: match.reasoning,
    price,
  }

  if (spec.exposureUsd === null) return { ...base, ...NULL_PAYOFF }

  const stakeUsd = suggestedStake(spec.exposureUsd, price, m.liquidityUsd)
  return {
    ...base,
    sized: true,
    stakeUsd,
    ...computeHedge({ stakeUsd, price, exposureUsd: spec.exposureUsd }),
  }
}

/**
 * `matches` (already relevance-sorted by `mapMatches`, AC 6) → `HedgeProposal`.
 * `best` is the first surviving match, `alternatives` the next 0–2, same order.
 * An empty/all-dropped input is a valid, honest `{best:null,alternatives:[]}`
 * outcome (AC 5), not an error.
 */
export async function buildProposal(
  spec: HedgeSpec,
  matches: RankedMatch[]
): Promise<HedgeProposal> {
  const kept = matches
    .map(match => mapOne(spec, match))
    .filter((m): m is HedgeMatch => m !== null)

  return {
    spec,
    best: kept[0] ?? null,
    alternatives: kept.slice(1, 3),
  }
}
