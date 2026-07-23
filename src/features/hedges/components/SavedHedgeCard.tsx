'use client'

import Link from 'next/link'
import { useState } from 'react'
import { formatUsd } from '@/shared/format'
import { cn } from '@/lib/utils'
import type { SavedHedgeView } from '../types'
import { useDeleteSavedHedge } from '../hooks/useDeleteSavedHedge'
import { SimulatedPnl } from './SimulatedPnl'
import { StatusBadge } from './StatusBadge'

export interface SavedHedgeCardProps {
  readonly hedge: SavedHedgeView
}

/** One saved hedge — question/side/stake/status/P&L, links to detail. */
export function SavedHedgeCard({ hedge }: SavedHedgeCardProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const { mutate: deleteHedge, isPending: isDeleting } = useDeleteSavedHedge()

  function handleDeleteClick() {
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    deleteHedge(hedge.id)
  }

  return (
    <div className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/15 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/hedge/${hedge.id}`}
          className="min-w-0 flex-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
        >
          <p className="line-clamp-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {hedge.question}
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {hedge.side} · Stake {formatUsd(hedge.stakeUsd)}
          </p>
        </Link>
        <StatusBadge status={hedge.status} />
      </div>

      <div className="mt-3 flex items-center justify-between">
        <SimulatedPnl pnl={hedge.simulatedPnlUsd} />

        <button
          type="button"
          onClick={handleDeleteClick}
          disabled={isDeleting}
          className={cn(
            'rounded-full px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40',
            confirmingDelete
              ? 'bg-red-600 text-white hover:bg-red-700'
              : 'border border-black/10 text-zinc-600 hover:bg-black/[.04] dark:border-white/15 dark:text-zinc-400 dark:hover:bg-white/[.06]'
          )}
        >
          {isDeleting
            ? 'Removing…'
            : confirmingDelete
              ? 'Confirm remove'
              : 'Remove'}
        </button>
      </div>
    </div>
  )
}
