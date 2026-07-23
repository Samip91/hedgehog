'use client'

import Link from 'next/link'
import { formatPrice, formatUsd } from '@/shared/format'
import { useSavedHedge } from '../hooks/useSavedHedge'
import { SimulatedPnl } from './SimulatedPnl'
import { StatusBadge } from './StatusBadge'

export interface SavedHedgeDetailProps {
  readonly id: string
}

function LoadingSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading your hedge…"
      className="min-h-[220px] animate-pulse rounded-2xl border border-black/10 bg-black/[.02] p-4 dark:border-white/15 dark:bg-white/[.03]"
    >
      <div className="h-4 w-2/3 rounded bg-black/10 dark:bg-white/10" />
      <div className="mt-3 h-3 w-full rounded bg-black/10 dark:bg-white/10" />
      <div className="mt-2 h-3 w-5/6 rounded bg-black/10 dark:bg-white/10" />
      <div className="mt-6 h-24 w-full rounded-xl bg-black/10 dark:bg-white/10" />
    </div>
  )
}

function NotFound() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-black/10 py-16 text-center dark:border-white/15">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
        Hedge not found
      </p>
      <p className="max-w-xs text-sm text-zinc-600 dark:text-zinc-400">
        It may have been removed, or belongs to a different device.
      </p>
      <Link
        href="/hedges"
        className="mt-2 rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700"
      >
        Back to my hedges
      </Link>
    </div>
  )
}

/** `/hedge/[id]` body — loading / not-found / populated / inline error. */
export function SavedHedgeDetail({ id }: SavedHedgeDetailProps) {
  const { data, isPending, error } = useSavedHedge(id)

  if (isPending) return <LoadingSkeleton />

  if (error) {
    return (
      <p className="mt-4 text-center text-sm text-red-600 dark:text-red-400">
        Couldn&apos;t load this hedge. Please try again.
      </p>
    )
  }

  if (!data.ok) {
    if (data.error.code === 'NOT_FOUND') return <NotFound />
    return (
      <p className="mt-4 text-center text-sm text-amber-600 dark:text-amber-400">
        {data.error.message}
      </p>
    )
  }

  const hedge = data.data

  return (
    <div className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/15 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-3">
        <p className="text-base font-medium text-zinc-900 dark:text-zinc-100">
          {hedge.question}
        </p>
        <StatusBadge status={hedge.status} />
      </div>

      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {hedge.side} · Entry {formatPrice(hedge.entryPrice)}
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Stake</dt>
          <dd className="text-xl font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
            {formatUsd(hedge.stakeUsd)}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Current price</dt>
          <dd className="text-xl font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
            {hedge.currentPrice === null
              ? 'pending'
              : formatPrice(hedge.currentPrice)}
          </dd>
        </div>
      </dl>

      <div className="mt-4 rounded-xl border border-black/10 p-3 dark:border-white/15">
        <SimulatedPnl pnl={hedge.simulatedPnlUsd} size="2xl" />
      </div>

      <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
        From: &ldquo;{hedge.prompt}&rdquo;
      </p>
    </div>
  )
}
