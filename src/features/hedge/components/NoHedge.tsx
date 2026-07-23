/** Honest empty state (AC 18) — distinct from an error, not an empty card. */
export function NoHedge() {
  return (
    <div className="rounded-2xl border border-dashed border-black/10 p-6 text-center dark:border-white/15">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
        No matching market found
      </p>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Try adding more detail — a location, date, or specific threshold.
      </p>
    </div>
  )
}
