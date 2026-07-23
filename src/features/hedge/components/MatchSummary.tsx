import type { HedgeMatch } from '@/shared/proposal'
import { formatPrice, formatProvider } from '../lib/format'

export interface MatchSummaryProps {
  readonly match: HedgeMatch
}

/** Provider/side/price header + question + reasoning — shared by both best-match cards. */
export function MatchSummary({ match }: MatchSummaryProps) {
  return (
    <>
      <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
        <span>{formatProvider(match.provider)}</span>
        <span>
          {match.side} at {formatPrice(match.price)}
        </span>
      </div>
      <p className="mt-1 text-base font-medium text-zinc-900 dark:text-zinc-100">
        {match.question}
      </p>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        {match.reasoning}
      </p>
    </>
  )
}
