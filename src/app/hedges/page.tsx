import Link from 'next/link'
import { SavedHedgesList } from '@/features/hedges'

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

      <SavedHedgesList />
    </main>
  )
}
