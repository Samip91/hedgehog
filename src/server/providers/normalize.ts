import type { NormalizedMarket } from './types'

/** Kalshi prices arrive in cents (1–99); convert to a 0–1 probability. */
export function centsToProbability(cents: number): number {
  return Math.min(1, Math.max(0, cents / 100))
}

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

/** Round a probability to 4 dp (matches the Decimal(6,4) DB column). */
export function round4(n: number): number {
  return Number(n.toFixed(4))
}

/** Join non-empty parts into a single normalized search string. */
export function buildSearchText(
  ...parts: Array<string | null | undefined>
): string {
  return parts
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Coerce a string|number|undefined money field to a number (or undefined). */
export function toNumber(
  value: string | number | undefined
): number | undefined {
  if (value === undefined) return undefined
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}

/** Parse a JSON-encoded string array (Polymarket quirk). Null if malformed. */
export function parseJsonStringArray(raw: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : null
  } catch {
    return null
  }
}

/** Trimmed payload snapshot for SchemaMismatchError logs. */
export function payloadPreview(raw: unknown, max = 500): string {
  try {
    return JSON.stringify(raw).slice(0, max)
  } catch {
    return String(raw).slice(0, max)
  }
}

/** Build a NormalizedMarket, omitting undefined optionals (exactOptionalPropertyTypes). */
export function buildNormalizedMarket(
  required: Pick<
    NormalizedMarket,
    | 'provider'
    | 'externalId'
    | 'question'
    | 'searchText'
    | 'yesPrice'
    | 'noPrice'
    | 'status'
    | 'url'
  >,
  optional: {
    eventTitle?: string | undefined
    category?: string | undefined
    volumeUsd?: number | undefined
    liquidityUsd?: number | undefined
    closeTime?: Date | undefined
    resolvedYes?: boolean | undefined
  }
): NormalizedMarket {
  return {
    ...required,
    ...(optional.eventTitle ? { eventTitle: optional.eventTitle } : {}),
    ...(optional.category ? { category: optional.category } : {}),
    ...(optional.volumeUsd !== undefined
      ? { volumeUsd: optional.volumeUsd }
      : {}),
    ...(optional.liquidityUsd !== undefined
      ? { liquidityUsd: optional.liquidityUsd }
      : {}),
    ...(optional.closeTime ? { closeTime: optional.closeTime } : {}),
    ...(optional.resolvedYes !== undefined
      ? { resolvedYes: optional.resolvedYes }
      : {}),
  }
}
