import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { formatPrice, formatUsd } from '@/shared/format'
import { fetchSavedHedge } from '@/features/hedges/api'
import { renderWithClient } from '@/test/renderWithClient'
import type { SavedHedgeView } from '../types'
import { SavedHedgeDetail } from './SavedHedgeDetail'

/**
 * `SavedHedgeDetail` component tests (spec `docs/features/saved-hedges/spec.md`
 * AC 31, 32, 33 — `/hedge/[id]` page body): loading, `NOT_FOUND` → "Hedge not
 * found" copy, populated fields (`currentPrice===null → 'pending'`,
 * `simulatedPnlUsd===null → '—'`), and a non-`NOT_FOUND` error → amber
 * inline message. Only the fetcher (`@/features/hedges/api`) is mocked —
 * `useSavedHedge` drives the real query lifecycle.
 */

vi.mock('@/features/hedges/api', () => ({
  fetchSavedHedge: vi.fn(),
}))

const mockedFetchSavedHedge = vi.mocked(fetchSavedHedge)

function hedge(overrides: Partial<SavedHedgeView> = {}): SavedHedgeView {
  return {
    id: 'hedge-1',
    prompt: 'Will it rain on my wedding?',
    question: 'Will it rain in Miami on March 21?',
    side: 'YES',
    entryPrice: 0.4,
    currentPrice: 0.5,
    stakeUsd: 100,
    simulatedPnlUsd: 25,
    status: 'OPEN',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SavedHedgeDetail — loading (AC 33)', () => {
  it('shows the loading skeleton while the fetch is in flight', () => {
    mockedFetchSavedHedge.mockReturnValue(new Promise(() => {}))

    renderWithClient(<SavedHedgeDetail id="hedge-1" />)

    expect(
      screen.getByRole('status', { name: /loading your hedge/i })
    ).toBeInTheDocument()
  })
})

describe('SavedHedgeDetail — NOT_FOUND (AC 32)', () => {
  it('a NOT_FOUND error code renders "Hedge not found", not a crash', async () => {
    mockedFetchSavedHedge.mockResolvedValue({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Saved hedge not found.' },
    })

    renderWithClient(<SavedHedgeDetail id="missing-id" />)

    expect(await screen.findByText('Hedge not found')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /back to my hedges/i })
    ).toHaveAttribute('href', '/hedges')
  })
})

describe('SavedHedgeDetail — populated (AC 31)', () => {
  it('renders question, side, entry price, current price, stake, status, P&L', async () => {
    mockedFetchSavedHedge.mockResolvedValue({
      ok: true,
      data: hedge({
        side: 'YES',
        entryPrice: 0.4,
        currentPrice: 0.55,
        stakeUsd: 100,
        simulatedPnlUsd: 25,
        status: 'OPEN',
      }),
    })

    renderWithClient(<SavedHedgeDetail id="hedge-1" />)

    expect(
      await screen.findByText('Will it rain in Miami on March 21?')
    ).toBeInTheDocument()
    expect(
      screen.getByText(`YES · Entry ${formatPrice(0.4)}`)
    ).toBeInTheDocument()
    expect(screen.getByText(formatPrice(0.55))).toBeInTheDocument()
    expect(screen.getByText(formatUsd(100))).toBeInTheDocument()
    expect(screen.getByText(formatUsd(25))).toBeInTheDocument()
    expect(screen.getByText('Open')).toBeInTheDocument()
  })

  it('currentPrice === null renders "pending"', async () => {
    mockedFetchSavedHedge.mockResolvedValue({
      ok: true,
      data: hedge({ currentPrice: null }),
    })

    renderWithClient(<SavedHedgeDetail id="hedge-1" />)

    expect(await screen.findByText('pending')).toBeInTheDocument()
  })

  it('simulatedPnlUsd === null renders "—"', async () => {
    mockedFetchSavedHedge.mockResolvedValue({
      ok: true,
      data: hedge({ simulatedPnlUsd: null }),
    })

    renderWithClient(<SavedHedgeDetail id="hedge-1" />)

    expect(await screen.findByText('—')).toBeInTheDocument()
  })
})

describe('SavedHedgeDetail — non-NOT_FOUND error (AC 30 sibling behavior)', () => {
  it('a rejected fetch shows the inline red error, not blank', async () => {
    mockedFetchSavedHedge.mockRejectedValue(new Error('network down'))

    renderWithClient(<SavedHedgeDetail id="hedge-1" />)

    expect(
      await screen.findByText(/couldn.?t load this hedge/i)
    ).toBeInTheDocument()
  })

  it('a non-NOT_FOUND {ok:false} envelope shows the amber server message', async () => {
    mockedFetchSavedHedge.mockResolvedValue({
      ok: false,
      error: { code: 'INTERNAL', message: 'Something broke server-side.' },
    })

    renderWithClient(<SavedHedgeDetail id="hedge-1" />)

    const message = await screen.findByText('Something broke server-side.')
    expect(message).toHaveClass('text-amber-600')
  })
})
