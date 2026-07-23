/**
 * Client-side payoff transform. `stakeToPayoff` is a thin delegate to
 * `computeHedge` — its entire job is to FORBID reimplementing hedge math in
 * components (AC 8): the slider drives this function, this function calls
 * `computeHedge`, full stop.
 */
import { computeHedge, type HedgeMathResult } from '@/shared/hedgeMath'

export interface ChartDatum {
  readonly label: string
  readonly net: number
}

export interface SliderBounds {
  readonly min: number
  readonly max: number
  readonly step: number
}

/** Delegates to `computeHedge` unchanged — see AC 8. */
export function stakeToPayoff(
  stakeUsd: number,
  price: number,
  exposureUsd: number
): HedgeMathResult {
  return computeHedge({ stakeUsd, price, exposureUsd })
}

/** `HedgeMathResult` → the two-outcome bars for `PayoffDiagram` (design Q2/A). */
export function payoffToChartData(
  result: HedgeMathResult
): readonly ChartDatum[] {
  return [
    { label: 'If it happens', net: result.netIfBadOutcome },
    { label: "If it doesn't", net: result.netIfGoodOutcome },
  ]
}

/**
 * Deterministic slider range seeded from `best.stakeUsd` (sized) or
 * `suggestedStake(...)` (unsized): `[0, max(1, ceil(seed*2))]`, stepped in
 * ~100 increments so the slider feels continuous at any seed size.
 */
export function sliderBounds(seedStake: number): SliderBounds {
  const max = Math.max(1, Math.ceil(seedStake * 2))
  const step = Math.max(1, Math.round(max / 100))
  return { min: 0, max, step }
}

/** Clamp a stake into a slider's `[min, max]` range — never negative. */
export function clampStake(stakeUsd: number, bounds: SliderBounds): number {
  return Math.min(Math.max(stakeUsd, bounds.min), bounds.max)
}
