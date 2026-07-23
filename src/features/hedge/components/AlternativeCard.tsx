import type { HedgeMatch } from '@/shared/proposal'
import { formatPrice, formatProvider } from '../lib/format'

export interface AlternativeCardProps {
  readonly match: HedgeMatch
}

const RELEVANCE_LABEL: Record<HedgeMatch['relevance'], string> = {
  high: 'High match',
  partial: 'Partial match',
  weak: 'Weak match',
}

/** Compact comparison card — no slider/diagram (AC 16). */
export function AlternativeCard({ match }: AlternativeCardProps) {
  return (
    <div className="rounded-xl border border-black/10 bg-white p-3 dark:border-white/15 dark:bg-zinc-900">
      <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
        <span>{formatProvider(match.provider)}</span>
        <span>{RELEVANCE_LABEL[match.relevance]}</span>
      </div>
      <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
        {match.question}
      </p>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {match.side} at {formatPrice(match.price)}
      </p>
    </div>
  )
}
