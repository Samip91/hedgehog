import type { HedgeSpec } from '@/shared/schemas'

/**
 * Best-effort keyword-only `HedgeSpec` extraction (spec AC 8–10, plan Q2).
 * Pure, no I/O — always `HedgeSpecSchema`-valid. Used when the model/API is
 * unreachable or two consecutive responses fail validation.
 */

const DOMAIN_KEYWORDS: ReadonlyArray<{
  domain: HedgeSpec['domain']
  keywords: readonly string[]
}> = [
  {
    domain: 'weather',
    keywords: [
      'rain',
      'snow',
      'storm',
      'hurricane',
      'wind',
      'heat',
      'cold',
      'frost',
      'temperature',
      'weather',
      'sunny',
    ],
  },
  {
    domain: 'crypto',
    keywords: [
      'bitcoin',
      'btc',
      'eth',
      'ethereum',
      'crypto',
      'solana',
      'sol',
      'doge',
      'token',
      'coin',
    ],
  },
  {
    domain: 'politics',
    keywords: [
      'election',
      'president',
      'senate',
      'congress',
      'vote',
      'poll',
      'primary',
    ],
  },
  {
    domain: 'sports',
    keywords: [
      'game',
      'match',
      'championship',
      'playoff',
      'cup',
      'nba',
      'nfl',
      'score',
    ],
  },
  {
    domain: 'economics',
    keywords: [
      'inflation',
      'recession',
      'fed',
      'rates',
      'gdp',
      'cpi',
      'unemployment',
      'stock',
    ],
  },
]

const TICKER_TO_ASSET: Readonly<Record<string, string>> = {
  btc: 'BTC',
  eth: 'ETH',
  sol: 'SOL',
  doge: 'DOGE',
}

const EXPOSURE_RE = /\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k|m)?/i

const CLARIFICATION_QUESTION =
  "I couldn't fully parse your risk — could you restate what you'd lose money on, roughly how much, and by when?"

const MAX_DESCRIPTION_LEN = 500

function detectDomain(lower: string): HedgeSpec['domain'] {
  for (const { domain, keywords } of DOMAIN_KEYWORDS) {
    if (keywords.some(kw => lower.includes(kw))) return domain
  }
  return 'other'
}

function detectExposureUsd(text: string): number | null {
  const match = EXPOSURE_RE.exec(text)
  if (!match) return null
  const digits = match[1]
  if (digits === undefined) return null
  const magnitude = match[2]?.toLowerCase()
  const base = Number(digits.replace(/,/g, ''))
  if (!Number.isFinite(base)) return null
  const multiplier =
    magnitude === 'k' ? 1_000 : magnitude === 'm' ? 1_000_000 : 1
  const value = base * multiplier
  if (!Number.isFinite(value)) return null
  return value > 0 ? value : null
}

function detectAsset(lower: string): string | null {
  for (const [ticker, asset] of Object.entries(TICKER_TO_ASSET)) {
    if (lower.includes(ticker)) return asset
  }
  return null
}

function buildRiskDescription(prompt: string): string {
  const trimmed = prompt.trim()
  if (trimmed.length === 0) return 'Unspecified risk'
  return trimmed.slice(0, MAX_DESCRIPTION_LEN)
}

export function degradedSpec(prompt: string): HedgeSpec {
  const lower = prompt.toLowerCase()
  return {
    riskDescription: buildRiskDescription(prompt),
    domain: detectDomain(lower),
    direction: 'happens',
    exposureUsd: detectExposureUsd(prompt),
    deadline: null,
    location: null,
    asset: detectAsset(lower),
    threshold: null,
    confidence: 'low',
    clarificationNeeded: CLARIFICATION_QUESTION,
  }
}
