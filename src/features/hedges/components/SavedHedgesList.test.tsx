import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { fetchSavedHedges } from '@/features/hedges/api'
import { renderWithClient } from '@/test/renderWithClient'
import type { SavedHedgeView } from '../types'
import { SavedHedgesList } from './SavedHedgesList'

/**
 * `SavedHedgesList` component tests (spec `docs/features/saved-hedges/spec.md`
 * AC 27, 28, 29, 30 — `/hedges` page body): loading skeleton, empty-state
 * copy, N cards when populated, inline error when the fetch fails.
 * `useSavedHedges` is exercised through the real hook — only the fetcher
 * (`@/features/hedges/api`) is mocked, so TanStack Query drives the actual
 * loading/success/error states.
 */

vi.mock('@/features/hedges/api', () => ({
  fetchSavedHedges: vi.fn(),
  // `SavedHedgeCard` (rendered for each populated row) also calls
  // `useDeleteSavedHedge`, whose `mutationFn` is this same module's
  // `deleteSavedHedge` — stub it so the mock module has every export the
  // rendered tree touches, even though delete itself is never triggered here.
  deleteSavedHedge: vi.fn(),
}))

const mockedFetchSavedHedges = vi.mocked(fetchSavedHedges)

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

describe('SavedHedgesList — loading (AC 29)', () => {
  it('shows the loading skeleton while the fetch is in flight', () => {
    mockedFetchSavedHedges.mockReturnValue(new Promise(() => {}))

    renderWithClient(<SavedHedgesList />)

    expect(
      screen.getByRole('status', { name: /loading your hedges/i })
    ).toBeInTheDocument()
  })
})

describe('SavedHedgesList — empty (AC 27)', () => {
  it('zero saved → the unchanged empty-state copy/CTA', async () => {
    mockedFetchSavedHedges.mockResolvedValue({ ok: true, data: [] })

    renderWithClient(<SavedHedgesList />)

    expect(await screen.findByText(/no hedges yet/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /find a hedge/i })).toHaveAttribute(
      'href',
      '/'
    )
  })
})

describe('SavedHedgesList — populated (AC 28)', () => {
  it('N saved → N cards, each linking to /hedge/[id]', async () => {
    mockedFetchSavedHedges.mockResolvedValue({
      ok: true,
      data: [
        hedge({ id: 'a', question: 'Question A?' }),
        hedge({ id: 'b', question: 'Question B?' }),
        hedge({ id: 'c', question: 'Question C?' }),
      ],
    })

    renderWithClient(<SavedHedgesList />)

    expect(await screen.findByText('Question A?')).toBeInTheDocument()
    expect(screen.getByText('Question B?')).toBeInTheDocument()
    expect(screen.getByText('Question C?')).toBeInTheDocument()

    const links = screen.getAllByRole('link')
    expect(links.map(l => l.getAttribute('href')).sort()).toEqual([
      '/hedge/a',
      '/hedge/b',
      '/hedge/c',
    ])
  })
})

describe('SavedHedgesList — error (AC 30)', () => {
  it('a rejected fetch shows an inline error, not blank', async () => {
    mockedFetchSavedHedges.mockRejectedValue(new Error('network down'))

    renderWithClient(<SavedHedgesList />)

    expect(
      await screen.findByText(/couldn.?t load your hedges/i)
    ).toBeInTheDocument()
  })

  it('an {ok:false} envelope shows the server-provided inline message', async () => {
    mockedFetchSavedHedges.mockResolvedValue({
      ok: false,
      error: { code: 'INTERNAL', message: 'Something broke server-side.' },
    })

    renderWithClient(<SavedHedgesList />)

    expect(
      await screen.findByText('Something broke server-side.')
    ).toBeInTheDocument()
  })
})
