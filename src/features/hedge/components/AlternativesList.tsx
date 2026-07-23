import type { HedgeMatch } from '@/shared/proposal'
import { AlternativeCard } from './AlternativeCard'

export interface AlternativesListProps {
  readonly alternatives: readonly HedgeMatch[]
}

/** "Other markets" section below a best match — renders nothing when empty (AC 17). */
export function AlternativesList({ alternatives }: AlternativesListProps) {
  if (alternatives.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
        Other markets
      </p>
      {alternatives.map(match => (
        <AlternativeCard
          key={`${match.provider}-${match.externalId}`}
          match={match}
        />
      ))}
    </div>
  )
}
