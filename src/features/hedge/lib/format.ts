/**
 * Pure, `Intl`-backed display formatters for the proposal screen. No ad-hoc
 * `toFixed`/string interpolation belongs in JSX — everything routes through
 * here so number/date/null copy stays consistent and unit-testable.
 */
import type { HedgeMatch } from '@/shared/proposal'

export const NOT_SPECIFIED = 'not specified'
export const NO_DEADLINE = 'no deadline'

const PROVIDER_LABEL: Record<HedgeMatch['provider'], string> = {
  kalshi: 'Kalshi',
  polymarket: 'Polymarket',
}

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  // Format the calendar date encoded in the string, not the viewer's local
  // date — avoids an off-by-one for `YYYY-MM-DD` deadlines near midnight UTC.
  timeZone: 'UTC',
})

/** `1234.5` → `"$1,234.50"`. */
export function formatUsd(value: number): string {
  return usdFormatter.format(value)
}

/** `spec.exposureUsd`: currency, or the "not specified" null copy. */
export function formatExposureUsd(value: number | null): string {
  return value === null ? NOT_SPECIFIED : formatUsd(value)
}

/** A market side's price in (0, 1) → cents, e.g. `0.24` → `"24¢"`. */
export function formatPrice(price: number): string {
  return `${Math.round(price * 100)}¢`
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
