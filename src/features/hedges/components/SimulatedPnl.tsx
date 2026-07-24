import { cn } from '@/lib/utils'
import { formatUsd } from '@/shared/format'

export interface SimulatedPnlProps {
  readonly pnl: number | null
  /** Value text size — `lg` for the list card, `2xl` for the detail view. */
  readonly size?: 'lg' | '2xl'
}

const SIZE_CLASSNAME = { lg: 'text-lg', '2xl': 'text-2xl' } as const

/** "Simulated P&L" label + value: `null` renders `—`, else color-coded by
 * sign. Shared by `SavedHedgeCard` and `SavedHedgeDetail`. */
export function SimulatedPnl({ pnl, size = 'lg' }: SimulatedPnlProps) {
  return (
    <div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Simulated P&amp;L
      </p>
      <p
        className={cn(
          'font-semibold tabular-nums',
          SIZE_CLASSNAME[size],
          pnl === null
            ? 'text-zinc-500 dark:text-zinc-400'
            : pnl >= 0
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-red-600 dark:text-red-400'
        )}
      >
        {pnl === null ? '—' : formatUsd(pnl)}
      </p>
    </div>
  )
}
