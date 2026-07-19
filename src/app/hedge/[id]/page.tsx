import Link from 'next/link'

interface Props {
  // Next 16: params is async — await it (see docs/PITFALLS.md).
  params: Promise<{ id: string }>
}

export default async function HedgeProposalPage({ params }: Props) {
  const { id } = await params

  return (
    <main className="flex flex-1 flex-col gap-6 px-6 py-10">
      <Link
        href="/"
        className="text-sm text-zinc-500 underline-offset-4 hover:underline"
      >
        ← Ask again
      </Link>

      <section className="rounded-2xl border border-black/10 p-5 dark:border-white/15">
        <h1 className="text-lg font-semibold">Hedge proposal</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Proposal <code className="font-mono">{id}</code> — the parsed-risk card,
          best-match market, payoff diagram and stake slider render here once the
          hedge pipeline lands via the <code>/feature</code> workflow.
        </p>
      </section>
    </main>
  )
}
