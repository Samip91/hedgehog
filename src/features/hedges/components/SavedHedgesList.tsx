'use client'

import Link from 'next/link'
import { useSavedHedges } from '../hooks/useSavedHedges'
import { SavedHedgeCard } from './SavedHedgeCard'

function LoadingSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading your hedges…"
      className="flex flex-col gap-3"
    >
      {[0, 1, 2].map(i => (
        <div
          key={i}
          className="h-24 animate-pulse rounded-2xl border border-black/10 bg-black/[.02] dark:border-white/15 dark:bg-white/[.03]"
        />
      ))}
    </div>
  )
}

/** Empty state — copy/CTA unchanged from the pre-`saved-hedges` page (AC 27). */
function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-black/10 py-20 text-center dark:border-white/15">
      <div className="text-4xl" aria-hidden>
        🦔
      </div>
      <p className="max-w-xs text-sm text-zinc-600 dark:text-zinc-400">
        No hedges yet. Describe a risk and save your first hedge to track its
        simulated P&amp;L here.
      </p>
      <Link
        href="/"
        className="mt-2 rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700"
      >
        Find a hedge
      </Link>
    </div>
  )
}

/** `/hedges` list body — loading skeleton / empty state / cards / inline error. */
export function SavedHedgesList() {
  const { data, isPending, error } = useSavedHedges()

  if (isPending) return <LoadingSkeleton />

  if (error) {
    return (
      <p className="mt-4 text-center text-sm text-red-600 dark:text-red-400">
        Couldn&apos;t load your hedges. Please try again.
      </p>
    )
  }

  if (!data.ok) {
    return (
      <p className="mt-4 text-center text-sm text-amber-600 dark:text-amber-400">
        {data.error.message}
      </p>
    )
  }

  if (data.data.length === 0) return <EmptyState />

  return (
    <div className="flex flex-col gap-3">
      {data.data.map(hedge => (
        <SavedHedgeCard key={hedge.id} hedge={hedge} />
      ))}
    </div>
  )
}
