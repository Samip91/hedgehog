import Link from 'next/link'

export default function HedgesPage() {
  return (
    <main className="flex flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">My hedges</h1>
        <Link
          href="/"
          className="text-sm text-zinc-500 underline-offset-4 hover:underline"
        >
          + New
        </Link>
      </div>

      {/* Empty state — saved hedges + live P&L land via feature: saved-hedges. */}
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
    </main>
  )
}
