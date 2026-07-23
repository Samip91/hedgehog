import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { formatUsd } from '@/shared/format'
import { deleteSavedHedge } from '@/features/hedges/api'
import { renderWithClient } from '@/test/renderWithClient'
import type { SavedHedgeView } from '../types'
import { SavedHedgeCard } from './SavedHedgeCard'

/**
 * `SavedHedgeCard` component tests (spec `docs/features/saved-hedges/spec.md`
 * AC 28): renders question/side/stake/status badge/P&L (or "—" when
 * `simulatedPnlUsd === null`), and the two-tap "Remove" → "Confirm remove"
 * affordance calls the delete mutation.
 */

vi.mock('@/features/hedges/api', () => ({
  deleteSavedHedge: vi.fn(),
}))

const mockedDeleteSavedHedge = vi.mocked(deleteSavedHedge)

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
  mockedDeleteSavedHedge.mockResolvedValue({
    ok: true,
    data: { id: 'hedge-1' },
  })
})

describe('SavedHedgeCard — renders the core fields (AC 28)', () => {
  it('shows question, side, stake, status badge, and formatted P&L', () => {
    renderWithClient(
      <SavedHedgeCard
        hedge={hedge({ side: 'YES', stakeUsd: 100, simulatedPnlUsd: 25 })}
      />
    )

    expect(
      screen.getByText('Will it rain in Miami on March 21?')
    ).toBeInTheDocument()
    expect(
      screen.getByText(`YES · Stake ${formatUsd(100)}`)
    ).toBeInTheDocument()
    expect(screen.getByText('Open')).toBeInTheDocument()
    expect(screen.getByText(formatUsd(25))).toBeInTheDocument()
  })

  it('shows "—" when simulatedPnlUsd is null', () => {
    renderWithClient(
      <SavedHedgeCard hedge={hedge({ simulatedPnlUsd: null })} />
    )

    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('links to /hedge/[id]', () => {
    renderWithClient(<SavedHedgeCard hedge={hedge({ id: 'abc' })} />)

    expect(screen.getByRole('link')).toHaveAttribute('href', '/hedge/abc')
  })
})

describe('SavedHedgeCard — two-tap remove (delete affordance)', () => {
  it('first tap shows "Confirm remove" without deleting; second tap calls the delete mutation', async () => {
    renderWithClient(<SavedHedgeCard hedge={hedge({ id: 'hedge-1' })} />)

    const removeButton = screen.getByRole('button', { name: /^remove$/i })
    fireEvent.click(removeButton)

    expect(mockedDeleteSavedHedge).not.toHaveBeenCalled()
    const confirmButton = await screen.findByRole('button', {
      name: /confirm remove/i,
    })

    fireEvent.click(confirmButton)

    await waitFor(() =>
      expect(mockedDeleteSavedHedge).toHaveBeenCalledWith(
        'hedge-1',
        expect.anything()
      )
    )
  })
})
