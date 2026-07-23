import type { HedgeSpec } from '@/shared/schemas'
import { formatDeadline, formatExposureUsd } from '../lib/format'

export interface ParsedRiskCardProps {
  readonly spec: HedgeSpec
}

const DOMAIN_LABEL: Record<HedgeSpec['domain'], string> = {
  weather: 'Weather',
  crypto: 'Crypto',
  politics: 'Politics',
  sports: 'Sports',
  economics: 'Economics',
  other: 'Other',
}

/** "What we understood" — AC 5/6. */
export function ParsedRiskCard({ spec }: ParsedRiskCardProps) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/15 dark:bg-zinc-900">
      <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
        What we understood
      </p>
      <p className="mt-1 text-base leading-relaxed text-zinc-900 dark:text-zinc-100">
        {spec.riskDescription}
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Domain</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-100">
            {DOMAIN_LABEL[spec.domain]}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Exposure</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-100">
            {formatExposureUsd(spec.exposureUsd)}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Deadline</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-100">
            {formatDeadline(spec.deadline)}
          </dd>
        </div>
      </dl>

      {spec.clarificationNeeded !== null && (
        <div
          role="status"
          className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
        >
          <p className="font-medium">One thing to confirm</p>
          <p className="mt-0.5">{spec.clarificationNeeded}</p>
        </div>
      )}
    </div>
  )
}
