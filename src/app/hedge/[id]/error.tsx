'use client'

import Link from 'next/link'

export default function Error({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold">Couldn’t load this hedge</h1>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-full border border-black/10 px-5 py-2.5 text-sm font-medium hover:bg-black/[.04] dark:border-white/15 dark:hover:bg-white/[.06]"
        >
          Start over
        </Link>
      </div>
    </main>
  )
}
