/**
 * Service-worker offline fallback (see public/sw.js). Static — no data
 * fetching, so it renders even with zero connectivity. Mobile-first, matches
 * the app's emerald/rounded-2xl shell.
 */
export default function OfflinePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="text-4xl" aria-hidden>
        🦔
      </div>
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-semibold">You&apos;re offline</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Reconnect to size a hedge. Anything you already saved will load once
          you&apos;re back online.
        </p>
      </div>
    </main>
  )
}
