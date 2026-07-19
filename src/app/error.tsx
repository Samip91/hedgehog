'use client'

export default function Error({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="text-4xl" aria-hidden>
        🦔
      </div>
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="max-w-sm text-sm text-zinc-600 dark:text-zinc-400">
        That’s on us, not you. Try again in a moment.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-2 rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700"
      >
        Try again
      </button>
    </main>
  )
}
