import type { HedgeMathResult } from '@/shared/hedgeMath'
import { cn } from '@/lib/utils'
import { formatUsd } from '../lib/format'

export interface PayoffCalloutsProps {
  readonly stakeUsd: number
  readonly payoff: HedgeMathResult
}

function netClassName(net: number): string {
  return net >= 0
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-red-600 dark:text-red-400'
}

/**
 * Stake/coverage summary + the two "if it happens"/"if it doesn't" payoff
 * boxes — shared by both best-match cards (sized and unsized).
 */
export function PayoffCallouts({ stakeUsd, payoff }: PayoffCalloutsProps) {
  return (
    <>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Stake</dt>
          <dd className="text-xl font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
            {formatUsd(stakeUsd)}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Coverage</dt>
          <dd className="text-xl font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
            {Math.round(payoff.coveragePct)}%
          </dd>
        </div>
      </dl>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-black/10 p-3 dark:border-white/15">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            If it happens
          </p>
          <p
            className={cn(
              'text-lg font-semibold tabular-nums',
              netClassName(payoff.netIfBadOutcome)
            )}
          >
            {formatUsd(payoff.netIfBadOutcome)}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Payout {formatUsd(payoff.payoutIfWin)}
          </p>
        </div>
        <div className="rounded-xl border border-black/10 p-3 dark:border-white/15">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            If it doesn&apos;t
          </p>
          <p
            className={cn(
              'text-lg font-semibold tabular-nums',
              netClassName(payoff.netIfGoodOutcome)
            )}
          >
            {formatUsd(payoff.netIfGoodOutcome)}
          </p>
        </div>
      </div>
    </>
  )
}
