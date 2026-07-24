import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import type { HedgeMatch } from '@/shared/proposal'
import type { HedgeSpec } from '@/shared/schemas'
import { saveHedge } from '@/features/hedges/api'
import { renderWithClient } from '@/test/renderWithClient'
import { SaveHedgeButton } from './SaveHedgeButton'

/**
 * `SaveHedgeButton` component tests (spec `docs/features/saved-hedges/spec.md`
 * AC 23–26): disabled on a non-positive stake (never POSTs `stakeUsd: 0`),
 * a pending "Saving…" state, success navigates to `/hedge/[id]`, failure
 * (both an `{ok:false}` envelope and a thrown network error) returns to idle
 * with an inline error and no navigation, and a double-tap while pending is
 * a no-op (one logical save).
 */

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('@/features/hedges/api', () => ({
  saveHedge: vi.fn(),
}))

const mockedSaveHedge = vi.mocked(saveHedge)

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
    sized: true,
    stakeUsd: 100,
    shares: 250,
    payoutIfWin: 250,
    netIfBadOutcome: -350,
    netIfGoodOutcome: -100,
    coverageRatio: 0.5,
    coveragePct: 50,
    ...overrides,
  }
}

/** A never-settled-until-resolved promise, so a test can assert the pending
 * "Saving…" state before letting the mutation resolve. */
function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SaveHedgeButton — disabled when stakeUsd <= 0 (AC 24)', () => {
  it('stakeUsd: 0 → disabled with a hint, no POST on click', () => {
    renderWithClient(
      <SaveHedgeButton
        prompt="test prompt"
        spec={spec()}
        best={match()}
        stakeUsd={0}
      />
    )

    const button = screen.getByRole('button', { name: /save this hedge/i })
    expect(button).toBeDisabled()
    expect(
      screen.getByText(/enter an amount to save this hedge/i)
    ).toBeInTheDocument()

    fireEvent.click(button)
    expect(mockedSaveHedge).not.toHaveBeenCalled()
  })

  it('a negative stakeUsd is also disabled (never POSTs a non-positive stake)', () => {
    renderWithClient(
      <SaveHedgeButton
        prompt="test prompt"
        spec={spec()}
        best={match()}
        stakeUsd={-10}
      />
    )

    expect(
      screen.getByRole('button', { name: /save this hedge/i })
    ).toBeDisabled()
  })

  it('a positive stakeUsd is enabled', () => {
    renderWithClient(
      <SaveHedgeButton
        prompt="test prompt"
        spec={spec()}
        best={match()}
        stakeUsd={100}
      />
    )

    expect(
      screen.getByRole('button', { name: /save this hedge/i })
    ).toBeEnabled()
  })
})

describe('SaveHedgeButton — pending state', () => {
  it('click → "Saving…" and disabled while the mutation is in flight', async () => {
    const { promise } = deferred<Awaited<ReturnType<typeof saveHedge>>>()
    mockedSaveHedge.mockReturnValue(promise)

    renderWithClient(
      <SaveHedgeButton
        prompt="test prompt"
        spec={spec()}
        best={match()}
        stakeUsd={100}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /save this hedge/i }))

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /saving/i })
      ).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled()
  })
})

describe('SaveHedgeButton — success navigates to /hedge/[id] (AC 23)', () => {
  it('an {ok:true} response pushes to /hedge/[id]', async () => {
    mockedSaveHedge.mockResolvedValue({
      ok: true,
      data: {
        id: 'x',
        prompt: 'test prompt',
        question: 'Will it rain in Miami on March 21?',
        side: 'YES',
        entryPrice: 0.4,
        currentPrice: null,
        stakeUsd: 100,
        simulatedPnlUsd: null,
        status: 'OPEN',
      },
    })

    renderWithClient(
      <SaveHedgeButton
        prompt="test prompt"
        spec={spec()}
        best={match()}
        stakeUsd={100}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /save this hedge/i }))

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/hedge/x')
    })
  })
})

describe('SaveHedgeButton — save failure returns to idle + inline error, no nav (AC 25)', () => {
  it('an {ok:false} response shows the inline error, returns to idle, never navigates', async () => {
    mockedSaveHedge.mockResolvedValue({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'Invalid hedge payload.' },
    })

    renderWithClient(
      <SaveHedgeButton
        prompt="test prompt"
        spec={spec()}
        best={match()}
        stakeUsd={100}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /save this hedge/i }))

    expect(
      await screen.findByText('Invalid hedge payload.')
    ).toBeInTheDocument()
    expect(mockPush).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: /save this hedge/i })
    ).toBeEnabled()
  })

  it('a thrown network error shows a generic inline error, idle, no navigation, retryable', async () => {
    mockedSaveHedge.mockRejectedValue(new Error('network down'))

    renderWithClient(
      <SaveHedgeButton
        prompt="test prompt"
        spec={spec()}
        best={match()}
        stakeUsd={100}
      />
    )

    const button = screen.getByRole('button', { name: /save this hedge/i })
    fireEvent.click(button)

    expect(
      await screen.findByText('Something went wrong. Please try again.')
    ).toBeInTheDocument()
    expect(mockPush).not.toHaveBeenCalled()
    expect(button).toBeEnabled()

    // Retryable: clicking again fires another mutate call.
    mockedSaveHedge.mockClear()
    fireEvent.click(button)
    await waitFor(() => expect(mockedSaveHedge).toHaveBeenCalledOnce())
  })
})

describe('SaveHedgeButton — double-tap while pending is a no-op (AC 26)', () => {
  it('a second tap once the button is pending/disabled fires no extra mutate call', async () => {
    const { promise, resolve } =
      deferred<Awaited<ReturnType<typeof saveHedge>>>()
    mockedSaveHedge.mockReturnValue(promise)

    renderWithClient(
      <SaveHedgeButton
        prompt="test prompt"
        spec={spec()}
        best={match()}
        stakeUsd={100}
      />
    )

    const button = screen.getByRole('button', { name: /save this hedge/i })
    fireEvent.click(button)

    // Wait for the pending re-render (disabled "Saving…") before the second
    // tap — this is what makes a real-world double-tap a no-op: the button
    // is a native `disabled` element by the time a second tap could land.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /saving/i }))
    await waitFor(() => expect(mockedSaveHedge).toHaveBeenCalledOnce())

    resolve({
      ok: true,
      data: {
        id: 'x',
        prompt: 'test prompt',
        question: 'Q',
        side: 'YES',
        entryPrice: 0.4,
        currentPrice: null,
        stakeUsd: 100,
        simulatedPnlUsd: null,
        status: 'OPEN',
      },
    })
    await waitFor(() => expect(mockPush).toHaveBeenCalled())
  })
})
