'use client'

import type { ApiResponse } from '@/shared/schemas'
import type { HedgeProposal } from '@/shared/proposal'
import { selectView } from '../lib/selectView'
import { ParsedRiskCard } from './ParsedRiskCard'
import { BestMatchSized } from './BestMatchSized'
import { BestMatchUnsized } from './BestMatchUnsized'
import { NoHedge } from './NoHedge'

export interface ProposalResultProps {
  readonly isPending: boolean
  readonly data: ApiResponse<HedgeProposal> | undefined
  readonly error: Error | null
  /** The submitted risk text (mutation `variables`) — threaded to the save button. */
  readonly prompt: string
}

/**
 * Fills the `data.ok === true` gap in `AskForm` (AC 1): calls the pure
 * `selectView` and renders exactly one branch — loading skeleton, the amber
 * "API said no" / red "network failed" copy (moved verbatim from `AskForm`),
 * or the parsed-risk + best-match(+alternatives) proposal body.
 */
export function ProposalResult({
  isPending,
  data,
  error,
  prompt,
}: ProposalResultProps) {
  const view = selectView({ isPending, data, error })

  switch (view.kind) {
    case 'idle':
      return null

    case 'loading':
      return (
        <div
          role="status"
          aria-label="Finding your hedge…"
          className="mt-4 min-h-[220px] animate-pulse rounded-2xl border border-black/10 bg-black/[.02] p-4 dark:border-white/15 dark:bg-white/[.03]"
        >
          <div className="h-4 w-2/3 rounded bg-black/10 dark:bg-white/10" />
          <div className="mt-3 h-3 w-full rounded bg-black/10 dark:bg-white/10" />
          <div className="mt-2 h-3 w-5/6 rounded bg-black/10 dark:bg-white/10" />
          <div className="mt-6 h-24 w-full rounded-xl bg-black/10 dark:bg-white/10" />
        </div>
      )

    case 'error':
      return (
        <p
          className={
            view.tone === 'red'
              ? 'mt-4 text-center text-sm text-red-600 dark:text-red-400'
              : 'mt-4 text-center text-sm text-amber-600 dark:text-amber-400'
          }
        >
          {view.message}
        </p>
      )

    case 'no-hedge':
      return (
        <div className="mt-4 flex flex-col gap-4">
          <ParsedRiskCard spec={view.spec} />
          <NoHedge />
        </div>
      )

    case 'sized':
      return (
        <div className="mt-4 flex flex-col gap-4">
          <ParsedRiskCard spec={view.spec} />
          <BestMatchSized
            prompt={prompt}
            spec={view.spec}
            best={view.best}
            alternatives={view.alternatives}
          />
        </div>
      )

    case 'unsized':
      return (
        <div className="mt-4 flex flex-col gap-4">
          <ParsedRiskCard spec={view.spec} />
          <BestMatchUnsized
            prompt={prompt}
            spec={view.spec}
            best={view.best}
            alternatives={view.alternatives}
          />
        </div>
      )

    default: {
      const exhaustive: never = view
      return exhaustive
    }
  }
}
