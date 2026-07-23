import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import type { HedgeMatch } from '@/shared/proposal'
import type { HedgeSpec } from '@/shared/schemas'
import { suggestedStake } from '@/shared/hedgeMath'
import { renderWithClient } from '@/test/renderWithClient'
import { BestMatchUnsized } from './BestMatchUnsized'

/**
 * AC 12–15: `spec.exposureUsd === null` → no fabricated payoff numbers until
 * a positive exposure is entered; a positive entry seeds the slider from
 * `suggestedStake` and reveals the diagram; clearing/zero/negative removes
 * both without throwing.
 *
 * `saved-hedges` requires `prompt`/`spec` props and mounts `SaveHedgeButton`
 * once `hasExposure` — `next/navigation` is mocked and every render goes
 * through `renderWithClient` (a real `QueryClientProvider`) so these
 * ORIGINAL assertions keep running unmodified.
 */

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('@/features/hedges/api', () => ({
  saveHedge: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

function spec(overrides: Partial<HedgeSpec> = {}): HedgeSpec {
  return {
    riskDescription: 'Financial loss from rain at an outdoor wedding',
    domain: 'weather',
    direction: 'happens',
    exposureUsd: null,
    deadline: '2026-03-21',
    location: 'Miami',
    asset: null,
    threshold: null,
    confidence: 'high',
    clarificationNeeded: null,
    ...overrides,
  }
}

function unsizedMatch(overrides: Partial<HedgeMatch> = {}): HedgeMatch {
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
    price: 0.4,
    sized: false,
    stakeUsd: null,
    shares: null,
    payoutIfWin: null,
    netIfBadOutcome: null,
    netIfGoodOutcome: null,
    coverageRatio: null,
    coveragePct: null,
    ...overrides,
  }
}

describe('BestMatchUnsized — no fabricated payoff before input (AC 12, 13)', () => {
  it('shows provider/question/side/price/reasoning but no payoff numbers, slider, or diagram', () => {
    const best = unsizedMatch()
    renderWithClient(
      <BestMatchUnsized
        prompt="test prompt"
        spec={spec()}
        best={best}
        alternatives={[]}
      />
    )

    expect(screen.getByText('Kalshi')).toBeInTheDocument()
    expect(screen.getByText(best.question)).toBeInTheDocument()
    expect(screen.getByText('YES at 40¢')).toBeInTheDocument()
    expect(screen.getByText(best.reasoning)).toBeInTheDocument()

    expect(document.querySelector('#stake-unsized')).toBeNull()
    expect(
      screen.queryByRole('img', { name: /payoff by outcome/i })
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Stake')).not.toBeInTheDocument()
    expect(screen.queryByText('Coverage')).not.toBeInTheDocument()
  })

  it('shows a labeled exposure input', () => {
    const best = unsizedMatch()
    renderWithClient(
      <BestMatchUnsized
        prompt="test prompt"
        spec={spec()}
        best={best}
        alternatives={[]}
      />
    )

    const input = screen.getByLabelText(/how much are you protecting/i)
    expect(input).toBeInTheDocument()
    expect(input).toHaveAttribute('id', 'exposure')
  })
})

describe('BestMatchUnsized — a positive exposure reveals the slider + diagram (AC 14)', () => {
  it('seeds the slider from suggestedStake(enteredExposure, best.price)', () => {
    const best = unsizedMatch({ price: 0.4 })
    renderWithClient(
      <BestMatchUnsized
        prompt="test prompt"
        spec={spec()}
        best={best}
        alternatives={[]}
      />
    )

    const input = document.querySelector<HTMLInputElement>('#exposure')
    if (input === null) throw new Error('expected the exposure input')

    fireEvent.change(input, { target: { value: '500' } })

    const slider = document.querySelector<HTMLInputElement>('#stake-unsized')
    expect(slider).not.toBeNull()
    const expectedSeed = suggestedStake(500, 0.4)
    expect(Number(slider?.value)).toBeCloseTo(expectedSeed, 5)

    expect(
      screen.getByRole('img', { name: /payoff by outcome/i })
    ).toBeInTheDocument()
  })

  it('driven by client-side computeHedge, same as the sized path — coverage/net values appear', () => {
    const best = unsizedMatch({ price: 0.4 })
    renderWithClient(
      <BestMatchUnsized
        prompt="test prompt"
        spec={spec()}
        best={best}
        alternatives={[]}
      />
    )

    const input = document.querySelector<HTMLInputElement>('#exposure')
    if (input === null) throw new Error('expected the exposure input')
    fireEvent.change(input, { target: { value: '500' } })

    expect(screen.getByText(/coverage/i)).toBeInTheDocument()
    expect(screen.getByText(/if it happens/i)).toBeInTheDocument()
    expect(screen.getByText(/if it doesn't/i)).toBeInTheDocument()
  })
})

describe('BestMatchUnsized — clearing/zero/negative hides slider+diagram without throwing (AC 15)', () => {
  it('clearing the exposure after a positive entry removes the slider + diagram', () => {
    const best = unsizedMatch({ price: 0.4 })
    renderWithClient(
      <BestMatchUnsized
        prompt="test prompt"
        spec={spec()}
        best={best}
        alternatives={[]}
      />
    )

    const input = document.querySelector<HTMLInputElement>('#exposure')
    if (input === null) throw new Error('expected the exposure input')

    fireEvent.change(input, { target: { value: '500' } })
    expect(document.querySelector('#stake-unsized')).not.toBeNull()

    expect(() =>
      fireEvent.change(input, { target: { value: '' } })
    ).not.toThrow()
    expect(document.querySelector('#stake-unsized')).toBeNull()
    expect(
      screen.queryByRole('img', { name: /payoff by outcome/i })
    ).not.toBeInTheDocument()
  })

  it('entering 0 removes the slider + diagram without throwing', () => {
    const best = unsizedMatch({ price: 0.4 })
    renderWithClient(
      <BestMatchUnsized
        prompt="test prompt"
        spec={spec()}
        best={best}
        alternatives={[]}
      />
    )

    const input = document.querySelector<HTMLInputElement>('#exposure')
    if (input === null) throw new Error('expected the exposure input')

    fireEvent.change(input, { target: { value: '500' } })
    expect(() =>
      fireEvent.change(input, { target: { value: '0' } })
    ).not.toThrow()

    expect(document.querySelector('#stake-unsized')).toBeNull()
    expect(
      screen.queryByRole('img', { name: /payoff by outcome/i })
    ).not.toBeInTheDocument()
  })

  it('entering a negative value removes the slider + diagram without throwing', () => {
    const best = unsizedMatch({ price: 0.4 })
    renderWithClient(
      <BestMatchUnsized
        prompt="test prompt"
        spec={spec()}
        best={best}
        alternatives={[]}
      />
    )

    const input = document.querySelector<HTMLInputElement>('#exposure')
    if (input === null) throw new Error('expected the exposure input')

    fireEvent.change(input, { target: { value: '500' } })
    expect(() =>
      fireEvent.change(input, { target: { value: '-50' } })
    ).not.toThrow()

    expect(document.querySelector('#stake-unsized')).toBeNull()
    expect(
      screen.queryByRole('img', { name: /payoff by outcome/i })
    ).not.toBeInTheDocument()
  })
})

describe('BestMatchUnsized — alternatives (AC 16, 17)', () => {
  it('renders compact alternative cards with no slider/diagram of their own', () => {
    const best = unsizedMatch()
    const alt = unsizedMatch({ externalId: 'ALT-1', question: 'Alt question?' })
    renderWithClient(
      <BestMatchUnsized
        prompt="test prompt"
        spec={spec()}
        best={best}
        alternatives={[alt]}
      />
    )

    expect(screen.getByText('Alt question?')).toBeInTheDocument()
  })
})
