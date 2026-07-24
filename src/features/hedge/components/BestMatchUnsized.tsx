'use client'

import { useMemo, useState } from 'react'
import type { HedgeMatch } from '@/shared/proposal'
import type { HedgeSpec } from '@/shared/schemas'
import { suggestedStake } from '@/shared/hedgeMath'
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
import { SaveHedgeButton } from './SaveHedgeButton'

export interface BestMatchUnsizedProps {
  readonly prompt: string
  readonly spec: HedgeSpec
  readonly best: HedgeMatch
  readonly alternatives: readonly HedgeMatch[]
}

/** Parses the exposure `<input>`; empty/non-finite → `null` (no NaN downstream). */
function parseExposure(raw: string): number | null {
  if (raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

/**
 * Best match, `sized === false` (AC 12–15): `spec.exposureUsd === null`, so no
 * payoff is fabricated. The user's exposure entry is UI-local (never sent to
 * the server); once positive it seeds the slider via `suggestedStake` and
 * drives the exact same `computeHedge` path as the sized card.
 */
export function BestMatchUnsized({
  prompt,
  spec,
  best,
  alternatives,
}: BestMatchUnsizedProps) {
  const [exposureInput, setExposureInput] = useState('')
  const [customStake, setCustomStake] = useState<number | null>(null)

  const exposureUsd = parseExposure(exposureInput)
  const hasExposure = exposureUsd !== null && exposureUsd > 0

  const bounds = useMemo(
    () =>
      hasExposure
        ? sliderBounds(suggestedStake(exposureUsd, best.price))
        : null,
    [hasExposure, exposureUsd, best.price]
  )
  const stakeUsd =
    hasExposure && bounds !== null
      ? clampStake(
          customStake ?? suggestedStake(exposureUsd, best.price),
          bounds
        )
      : 0

  const payoff = useMemo(
    () =>
      hasExposure ? stakeToPayoff(stakeUsd, best.price, exposureUsd) : null,
    [hasExposure, stakeUsd, best.price, exposureUsd]
  )
  const chartData = useMemo(
    () => (payoff === null ? null : payoffToChartData(payoff)),
    [payoff]
  )

  function handleExposureChange(raw: string): void {
    setExposureInput(raw)
    setCustomStake(null)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/15 dark:bg-zinc-900">
        <MatchSummary match={best} />

        <div className="mt-4">
          <label
            htmlFor="exposure"
            className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            How much are you protecting? ($)
          </label>
          <input
            id="exposure"
            type="number"
            inputMode="decimal"
            min={0}
            value={exposureInput}
            onChange={event => handleExposureChange(event.target.value)}
            placeholder="e.g. 500"
            className="mt-1 w-full rounded-xl border border-black/10 bg-white p-3 text-base outline-none focus:border-black/30 dark:border-white/15 dark:bg-zinc-900"
          />
        </div>

        {!hasExposure && (
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Enter an amount to size your hedge and see the payoff.
          </p>
        )}

        {hasExposure &&
          bounds !== null &&
          payoff !== null &&
          chartData !== null && (
            <>
              <PayoffCallouts stakeUsd={stakeUsd} payoff={payoff} />

              <div className="mt-4">
                <StakeSlider
                  id="stake-unsized"
                  label="Stake"
                  value={stakeUsd}
                  min={bounds.min}
                  max={bounds.max}
                  step={bounds.step}
                  valueText={formatUsd(stakeUsd)}
                  onChange={setCustomStake}
                />
              </div>

              <div className="mt-4">
                <PayoffDiagram data={chartData} />
              </div>

              <div className="mt-4">
                <SaveHedgeButton
                  prompt={prompt}
                  spec={spec}
                  best={best}
                  stakeUsd={stakeUsd}
                />
              </div>
            </>
          )}
      </div>

      <AlternativesList alternatives={alternatives} />
    </div>
  )
}
