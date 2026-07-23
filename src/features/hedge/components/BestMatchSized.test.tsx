import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { HedgeMatch } from '@/shared/proposal'
import type { HedgeSpec } from '@/shared/schemas'
import { computeHedge } from '@/shared/hedgeMath'
import { formatUsd } from '../lib/format'
import { BestMatchSized } from './BestMatchSized'

/**
 * AC 7–11: first-paint numbers equal the server's own `best` fields, a
 * slider drag updates the payoff via `computeHedge`, and the `PayoffDiagram`
 * container node identity is stable across the drag (no remount).
 *
 * Several payoff numbers legitimately appear twice in the DOM (the `<dd>`
 * value next to the `<dt>` label, and the slider's `valueText` readout), so
 * assertions here read a specific node's `textContent` off its label sibling
 * rather than a global `getByText`, which would be ambiguous.
 */

function spec(overrides: Partial<HedgeSpec> = {}): HedgeSpec {
  return {
    riskDescription: 'Financial loss from rain at an outdoor wedding',
    domain: 'weather',
    direction: 'happens',
    exposureUsd: 500,
    deadline: '2026-03-21',
    location: 'Miami',
    asset: null,
    threshold: null,
    confidence: 'high',
    clarificationNeeded: null,
    ...overrides,
  }
}

function match(overrides: Partial<HedgeMatch> = {}): HedgeMatch {
  const stakeUsd = overrides.stakeUsd ?? 300
  const price = overrides.price ?? 0.4
  const exposureUsd = 500
  const computed = computeHedge({ stakeUsd, price, exposureUsd })
  return {
    provider: 'kalshi',
    externalId: 'K-TEST',
    question: 'Will it rain in Miami on March 21?',
    url: 'https://kalshi.com/markets/K-TEST',
    closeTime: '2026-03-21T00:00:00Z',
    yesPrice: 0.4,
    noPrice: 0.6,
    liquidityUsd: 10_000,
    side: 'YES',
    relevance: 'high',
    reasoning: 'This hedges the risk.',
    price,
    sized: true,
    stakeUsd,
    shares: computed.shares,
    payoutIfWin: computed.payoutIfWin,
    netIfBadOutcome: computed.netIfBadOutcome,
    netIfGoodOutcome: computed.netIfGoodOutcome,
    coverageRatio: computed.coverageRatio,
    coveragePct: computed.coveragePct,
    ...overrides,
  }
}

/** The next element sibling's `textContent` after a `<dt>`/`<p>` exactly matching `label`. */
function textAfterLabel(container: HTMLElement, label: string): string | null {
  const labelEl = Array.from(container.querySelectorAll('dt, p')).find(
    el => el.textContent === label
  )
  return labelEl?.nextElementSibling?.textContent ?? null
}

describe('BestMatchSized — first paint = server numbers, no recompute drift (AC 7)', () => {
  it('renders stakeUsd/payoutIfWin/netIfBadOutcome/netIfGoodOutcome/coveragePct exactly as sent', () => {
    const s = spec()
    const best = match({ stakeUsd: 300, price: 0.4 })
    const { container } = render(
      <BestMatchSized spec={s} best={best} alternatives={[]} />
    )

    expect(textAfterLabel(container, 'Stake')).toBe(
      formatUsd(best.stakeUsd as number)
    )
    expect(textAfterLabel(container, 'Coverage')).toBe(
      `${Math.round(best.coveragePct as number)}%`
    )
    expect(textAfterLabel(container, 'If it happens')).toBe(
      formatUsd(best.netIfBadOutcome as number)
    )
    expect(textAfterLabel(container, "If it doesn't")).toBe(
      formatUsd(best.netIfGoodOutcome as number)
    )
    expect(
      screen.getByText(
        (_, el) =>
          el?.textContent === `Payout ${formatUsd(best.payoutIfWin as number)}`
      )
    ).toBeInTheDocument()
  })

  it('provider, question, side, and price also render (AC 7)', () => {
    const s = spec()
    const best = match({ provider: 'kalshi', side: 'YES', price: 0.4 })
    render(<BestMatchSized spec={s} best={best} alternatives={[]} />)

    expect(screen.getByText('Kalshi')).toBeInTheDocument()
    expect(screen.getByText(best.question)).toBeInTheDocument()
    expect(screen.getByText('YES at 40¢')).toBeInTheDocument()
  })
})

describe('BestMatchSized — slider drives computeHedge (AC 8, 9)', () => {
  it('the slider initial value equals best.stakeUsd', () => {
    const s = spec()
    const best = match({ stakeUsd: 300 })
    render(<BestMatchSized spec={s} best={best} alternatives={[]} />)

    const slider = document.querySelector<HTMLInputElement>('#stake-sized')
    expect(slider).not.toBeNull()
    expect(Number(slider?.value)).toBe(300)
  })

  it('dragging the slider updates the displayed payoff to match stakeToPayoff at the new stake', () => {
    const s = spec({ exposureUsd: 500 })
    const best = match({ stakeUsd: 300, price: 0.4 })
    const { container } = render(
      <BestMatchSized spec={s} best={best} alternatives={[]} />
    )

    const slider = document.querySelector<HTMLInputElement>('#stake-sized')
    expect(slider).not.toBeNull()
    if (slider === null) throw new Error('expected a slider')

    const newStake = 100
    fireEvent.change(slider, { target: { value: String(newStake) } })

    const expected = computeHedge({
      stakeUsd: newStake,
      price: 0.4,
      exposureUsd: 500,
    })
    expect(textAfterLabel(container, 'Stake')).toBe(formatUsd(newStake))
    expect(textAfterLabel(container, 'If it happens')).toBe(
      formatUsd(expected.netIfBadOutcome)
    )
    expect(textAfterLabel(container, "If it doesn't")).toBe(
      formatUsd(expected.netIfGoodOutcome)
    )
    expect(textAfterLabel(container, 'Coverage')).toBe(
      `${Math.round(expected.coveragePct)}%`
    )

    // The old (pre-drag) net-if-bad value is gone.
    expect(textAfterLabel(container, 'If it happens')).not.toBe(
      formatUsd(best.netIfBadOutcome as number)
    )
  })

  it('stakeUsd: 0 does not throw and renders the computeHedge(0,...) numbers', () => {
    const s = spec({ exposureUsd: 500 })
    const best = match({ stakeUsd: 300, price: 0.4 })
    const { container } = render(
      <BestMatchSized spec={s} best={best} alternatives={[]} />
    )

    const slider = document.querySelector<HTMLInputElement>('#stake-sized')
    if (slider === null) throw new Error('expected a slider')

    expect(() =>
      fireEvent.change(slider, { target: { value: '0' } })
    ).not.toThrow()

    const expected = computeHedge({ stakeUsd: 0, price: 0.4, exposureUsd: 500 })
    expect(textAfterLabel(container, 'Stake')).toBe(formatUsd(0))
    expect(textAfterLabel(container, "If it doesn't")).toBe(
      formatUsd(expected.netIfGoodOutcome)
    )
  })
})

describe('BestMatchSized — PayoffDiagram does not remount on drag (AC 10)', () => {
  it('the diagram container DOM node reference is stable before/after a drag', () => {
    const s = spec()
    const best = match({ stakeUsd: 300, price: 0.4 })
    render(<BestMatchSized spec={s} best={best} alternatives={[]} />)

    const diagramBefore = screen.getByRole('img', {
      name: /payoff by outcome/i,
    })

    const slider = document.querySelector<HTMLInputElement>('#stake-sized')
    if (slider === null) throw new Error('expected a slider')
    fireEvent.change(slider, { target: { value: '150' } })

    const diagramAfter = screen.getByRole('img', { name: /payoff by outcome/i })
    expect(diagramAfter).toBe(diagramBefore)
  })
})

describe('BestMatchSized — alternatives render below the best match (AC 11)', () => {
  it('renders alternative cards even in the sized case', () => {
    const s = spec()
    const best = match()
    const alt = match({ externalId: 'ALT-1', question: 'Alt question?' })
    render(<BestMatchSized spec={s} best={best} alternatives={[alt]} />)

    expect(screen.getByText('Alt question?')).toBeInTheDocument()
  })

  it('renders no alternatives section when alternatives is empty (AC 17)', () => {
    const s = spec()
    const best = match()
    render(<BestMatchSized spec={s} best={best} alternatives={[]} />)

    expect(screen.queryByText(/other markets/i)).not.toBeInTheDocument()
  })
})
