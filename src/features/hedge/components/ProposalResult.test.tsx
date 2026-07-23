import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ApiResponse, HedgeSpec } from '@/shared/schemas'
import type { HedgeMatch, HedgeProposal } from '@/shared/proposal'
import { computeHedge } from '@/shared/hedgeMath'
import { ProposalResult } from './ProposalResult'

/**
 * Drives `ProposalResult` via props (`{isPending,data,error}`), not
 * `selectView` directly, to exercise the wiring (AC 1, 2, 18–21): exactly
 * one state region renders, never a stale card during a new pending
 * mutation, and proposal text is rendered literally (no markup parsing).
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

function sizedMatch(overrides: Partial<HedgeMatch> = {}): HedgeMatch {
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

function okProposal(
  overrides: Partial<HedgeProposal> = {}
): ApiResponse<HedgeProposal> {
  return {
    ok: true,
    data: {
      spec: spec(),
      best: sizedMatch(),
      alternatives: [],
      ...overrides,
    },
  }
}

describe('ProposalResult — exactly one state (AC 1)', () => {
  it('pending: only the loading skeleton renders', () => {
    render(<ProposalResult isPending data={undefined} error={null} />)

    expect(
      screen.getByRole('status', { name: /finding your hedge/i })
    ).toBeInTheDocument()
    expect(screen.queryByText(/what we understood/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/no matching market/i)).not.toBeInTheDocument()
  })

  it('no stale card left on screen when a new mutation goes pending (AC 1)', () => {
    const best = sizedMatch()
    const proposal = okProposal({ best })
    const { rerender } = render(
      <ProposalResult isPending={false} data={proposal} error={null} />
    )
    expect(screen.getByText(best.question)).toBeInTheDocument()

    // Simulate a resubmit: isPending flips true while `data` is still the
    // previous mutation's stale payload — `selectView` must ignore it.
    rerender(<ProposalResult isPending data={proposal} error={null} />)

    expect(
      screen.getByRole('status', { name: /finding your hedge/i })
    ).toBeInTheDocument()
    expect(screen.queryByText(best.question)).not.toBeInTheDocument()
    expect(screen.queryByText(/what we understood/i)).not.toBeInTheDocument()
  })

  it('!data.ok → amber message only, no proposal card (AC 20)', () => {
    render(
      <ProposalResult
        isPending={false}
        data={{
          ok: false,
          error: { code: 'BAD', message: 'Please rephrase.' },
        }}
        error={null}
      />
    )

    const message = screen.getByText('Please rephrase.')
    expect(message).toHaveClass('text-amber-600')
    expect(screen.queryByText(/what we understood/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('a network/mutation error → red message only (AC 21)', () => {
    render(
      <ProposalResult
        isPending={false}
        data={undefined}
        error={new Error('boom')}
      />
    )

    const message = screen.getByText('Something went wrong. Please try again.')
    expect(message).toHaveClass('text-red-600')
    expect(screen.queryByText(/what we understood/i)).not.toBeInTheDocument()
  })

  it('data.ok + sized best → parsed-risk card + best-match card, nothing else', () => {
    const best = sizedMatch()
    render(
      <ProposalResult
        isPending={false}
        data={okProposal({ best })}
        error={null}
      />
    )

    expect(screen.getByText(/what we understood/i)).toBeInTheDocument()
    expect(screen.getByText(best.question)).toBeInTheDocument()
    expect(screen.queryByText(/no matching market/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('best === null → parsed-risk card + "No matching market found" (distinct from error, AC 18)', () => {
    render(
      <ProposalResult
        isPending={false}
        data={okProposal({ best: null, alternatives: [] })}
        error={null}
      />
    )

    expect(screen.getByText(/what we understood/i)).toBeInTheDocument()
    const message = screen.getByText('No matching market found')
    expect(message).toBeInTheDocument()
    expect(message).not.toHaveClass('text-red-600')
    expect(message).not.toHaveClass('text-amber-600')
  })
})

describe('ProposalResult — proposal text renders literally, no markup parsing (AC 2)', () => {
  it('a reasoning string containing markup-ish characters shows as literal text', () => {
    const markupish = '<b>bold</b> & "quotes" <script>alert(1)</script>'
    const { container } = render(
      <ProposalResult
        isPending={false}
        data={okProposal({ best: sizedMatch({ reasoning: markupish }) })}
        error={null}
      />
    )

    // The literal string is present as text content...
    expect(screen.getByText(markupish)).toBeInTheDocument()
    // ...and was never parsed as HTML: no actual <b>/<script> elements exist.
    expect(container.querySelector('b')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
  })

  it('spec.clarificationNeeded with markup-ish characters shows as literal text', () => {
    const markupish = 'Confirm: <img src=x onerror=alert(1)>'
    const { container } = render(
      <ProposalResult
        isPending={false}
        data={okProposal({ spec: spec({ clarificationNeeded: markupish }) })}
        error={null}
      />
    )

    expect(screen.getByText(markupish)).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })
})
