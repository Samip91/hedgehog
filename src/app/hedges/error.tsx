'use client'

export default function Error({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold">Couldn’t load your hedges</h1>
      <button
        type="button"
        onClick={reset}
        className="rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700"
      >
        Try again
      </button>
    </main>
  )
}
