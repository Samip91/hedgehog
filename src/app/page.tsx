import Link from 'next/link'
import { AskForm } from '@/features/ask'

export default function AskPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-16">
      <div className="text-center">
        <div className="text-5xl" aria-hidden>
          🦔
        </div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Hedgehog</h1>
        <p className="mt-2 max-w-sm text-balance text-zinc-600 dark:text-zinc-400">
          Describe a real-life risk in plain English. Get the live market that
          hedges it — with the payoff math done for you.
        </p>
      </div>

      <AskForm />

      <Link
        href="/hedges"
        className="text-sm text-zinc-500 underline-offset-4 hover:underline"
      >
        My hedges →
      </Link>
    </main>
  )
}
