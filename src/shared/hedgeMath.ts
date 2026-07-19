/**
 * Pure hedge math — the densest-tested module in the repo.
 *
 * Insurance framing: the user buys the market side that PAYS when their bad
 * outcome happens. `price` is that side's price in [0, 1) (a probability /
 * cents-per-dollar). A share pays $1 if it resolves in the user's favor.
 *
 * All inputs arrive as plain numbers at the call boundary (DB columns are
 * Decimal for storage precision; convert once, compute here). No side effects.
 */

export interface HedgeMathInput {
  /** USD the user stakes on the hedge. */
  readonly stakeUsd: number
  /** Price of the side being bought, in [0, 1) (e.g. 0.24 = 24¢). */
  readonly price: number
  /** USD the user loses if the bad outcome occurs. */
  readonly exposureUsd: number
}

export interface HedgeMathResult {
  /** Contracts bought: stake / price. Each pays $1 on win. */
  readonly shares: number
  /** Gross payout if the hedge wins (bad outcome happens). */
  readonly payoutIfWin: number
  /** Net wallet delta if the bad outcome happens (payout − stake − exposure). */
  readonly netIfBadOutcome: number
  /** Net wallet delta if the good outcome happens (just the stake, lost). */
  readonly netIfGoodOutcome: number
  /** payoutIfWin / exposureUsd. 0 when there is no exposure to cover. */
  readonly coverageRatio: number
  /** coverageRatio as a percentage. */
  readonly coveragePct: number
}

function assertValidPrice(price: number): void {
  if (!Number.isFinite(price) || price <= 0 || price >= 1) {
    throw new RangeError(
      `price must be in the open interval (0, 1); received ${price}`
    )
  }
}

function assertNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite number >= 0; received ${value}`)
  }
}

/** Full hedge payoff breakdown for a given stake, price, and exposure. */
export function computeHedge(input: HedgeMathInput): HedgeMathResult {
  const { stakeUsd, price, exposureUsd } = input
  assertValidPrice(price)
  assertNonNegative(stakeUsd, 'stakeUsd')
  assertNonNegative(exposureUsd, 'exposureUsd')

  const shares = stakeUsd / price
  const payoutIfWin = shares // × $1
  const netIfBadOutcome = payoutIfWin - stakeUsd - exposureUsd
  const netIfGoodOutcome = -stakeUsd
  const coverageRatio = exposureUsd > 0 ? payoutIfWin / exposureUsd : 0

  return {
    shares,
    payoutIfWin,
    netIfBadOutcome,
    netIfGoodOutcome,
    coverageRatio,
    coveragePct: coverageRatio * 100,
  }
}

/**
 * Stake that makes the hedge's net profit (payout − stake) equal the exposure,
 * i.e. fully offsets the loss: stake = exposure × price / (1 − price).
 *
 * Optionally capped by a liquidity-derived ceiling so we never propose a size
 * the market cannot absorb.
 */
export function suggestedStake(
  exposureUsd: number,
  price: number,
  liquidityCapUsd?: number
): number {
  assertValidPrice(price)
  assertNonNegative(exposureUsd, 'exposureUsd')

  const fullCover = (exposureUsd * price) / (1 - price)
  if (liquidityCapUsd === undefined) return fullCover

  assertNonNegative(liquidityCapUsd, 'liquidityCapUsd')
  return Math.min(fullCover, liquidityCapUsd)
}
