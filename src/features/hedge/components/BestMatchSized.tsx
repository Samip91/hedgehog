'use client'

import { useMemo, useState } from 'react'
import type { HedgeMatch } from '@/shared/proposal'
import type { HedgeSpec } from '@/shared/schemas'
import {
  clampStake,
  payoffToChartData,
  sliderBounds,
  stakeToPayoff,
} from '../lib/payoff'
import { formatUsd } from '../lib/format'
import { StakeSlider } from './StakeSlider'
import { PayoffDiagram } from './PayoffDiagram'
import { MatchSummary } from './MatchSummary'
import { PayoffCallouts } from './PayoffCallouts'
import { AlternativesList } from './AlternativesList'

export interface BestMatchSizedProps {
  readonly spec: HedgeSpec
  readonly best: HedgeMatch
  readonly alternatives: readonly HedgeMatch[]
}

/**
 * Best match, `sized === true` (AC 7–11). Owns the slider's `stakeUsd` state,
 * seeded from `best.stakeUsd` so the very first paint is the server's own
 * numbers (recomputing the same pure `computeHedge` from the same inputs is
 * deterministically identical — no drift, no separate "server" render path).
 */
export function BestMatchSized({
  spec,
  best,
  alternatives,
}: BestMatchSizedProps) {
  // `sized` is a runtime contract (spec.exposureUsd !== null), not encoded in
  // the flat `HedgeMatchSchema` type — fall back defensively rather than `!`.
  const exposureUsd = spec.exposureUsd ?? 0
  const seedStake = best.stakeUsd ?? 0
  const bounds = useMemo(() => sliderBounds(seedStake), [seedStake])
  const [stakeUsd, setStakeUsd] = useState(() => clampStake(seedStake, bounds))

  const payoff = useMemo(
    () => stakeToPayoff(stakeUsd, best.price, exposureUsd),
    [stakeUsd, best.price, exposureUsd]
  )
  const chartData = useMemo(() => payoffToChartData(payoff), [payoff])

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/15 dark:bg-zinc-900">
        <MatchSummary match={best} />
        <PayoffCallouts stakeUsd={stakeUsd} payoff={payoff} />

        <div className="mt-4">
          <StakeSlider
            id="stake-sized"
            label="Stake"
            value={stakeUsd}
            min={bounds.min}
            max={bounds.max}
            step={bounds.step}
            valueText={formatUsd(stakeUsd)}
            onChange={setStakeUsd}
          />
        </div>

        <div className="mt-4">
          <PayoffDiagram data={chartData} />
        </div>
      </div>

      <AlternativesList alternatives={alternatives} />
    </div>
  )
}
