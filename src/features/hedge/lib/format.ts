/**
 * Pure, `Intl`-backed display formatters for the proposal screen. No ad-hoc
 * `toFixed`/string interpolation belongs in JSX — everything routes through
 * here so number/date/null copy stays consistent and unit-testable.
 *
 * `formatUsd`/`formatPrice` live in `@/shared/format` (no `HedgeMatch`
 * dependency, so the `hedges` slice can use them without reaching into this
 * one) and are re-exported here so this module stays the single import path
 * for everything on the proposal screen.
 */
import type { HedgeMatch } from '@/shared/proposal'
import { formatUsd } from '@/shared/format'

export { formatPrice, formatUsd } from '@/shared/format'

export const NOT_SPECIFIED = 'not specified'
export const NO_DEADLINE = 'no deadline'

const PROVIDER_LABEL: Record<HedgeMatch['provider'], string> = {
  kalshi: 'Kalshi',
  polymarket: 'Polymarket',
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  // Format the calendar date encoded in the string, not the viewer's local
  // date — avoids an off-by-one for `YYYY-MM-DD` deadlines near midnight UTC.
  timeZone: 'UTC',
})

/** `spec.exposureUsd`: currency, or the "not specified" null copy. */
export function formatExposureUsd(value: number | null): string {
  return value === null ? NOT_SPECIFIED : formatUsd(value)
}

/** `HedgeMatch.provider` → its display label — shared by every match card. */
export function formatProvider(provider: HedgeMatch['provider']): string {
  return PROVIDER_LABEL[provider]
}

/** A `YYYY-MM-DD` date or full ISO date-time → `"Mar 21, 2026"`. */
export function formatDate(value: string): string {
  const isoValue = value.length === 10 ? `${value}T00:00:00Z` : value
  const date = new Date(isoValue)
  if (Number.isNaN(date.getTime())) return value
  return dateFormatter.format(date)
}

/** `spec.deadline`: date, or the "no deadline" null copy. */
export function formatDeadline(value: string | null): string {
  return value === null ? NO_DEADLINE : formatDate(value)
}
