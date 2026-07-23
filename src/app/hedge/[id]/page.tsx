import Link from 'next/link'
import { SavedHedgeDetail } from '@/features/hedges'

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

      <SavedHedgeDetail id={id} />
    </main>
  )
}
