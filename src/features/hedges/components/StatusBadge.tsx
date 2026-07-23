import { cn } from '@/lib/utils'
import type { SavedHedgeView } from '../types'

const STATUS_LABEL: Record<SavedHedgeView['status'], string> = {
  OPEN: 'Open',
  MARKET_CLOSED: 'Market closed',
  RESOLVED_WIN: 'Won',
  RESOLVED_LOSS: 'Lost',
}

const STATUS_CLASSNAME: Record<SavedHedgeView['status'], string> = {
  OPEN: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
  MARKET_CLOSED:
    'bg-zinc-100 text-zinc-600 dark:bg-zinc-500/10 dark:text-zinc-400',
  RESOLVED_WIN:
    'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
  RESOLVED_LOSS: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
}

export interface StatusBadgeProps {
  readonly status: SavedHedgeView['status']
  readonly className?: string
}

/** Colored pill for a saved hedge's lazily-settled status. */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium',
        STATUS_CLASSNAME[status],
        className
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}
