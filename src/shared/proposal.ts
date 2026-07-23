import { z } from 'zod'
import { HedgeSpecSchema } from '@/shared/schemas'

/**
 * `HedgeProposal` — the `POST /api/hedge` response payload (spec §6.5, plan
 * decision Q4). Zod is the source of truth: this crosses the API boundary, so
 * the server pipeline (`propose.ts`) and any client both validate against it.
 *
 * Every returned match has `price` guaranteed in the open interval (0, 1) —
 * out-of-range prices are dropped upstream (AC 8), never serialized here.
 * The seven payoff fields are `.finite().nullable()`: `null` together
 * (`sized: false`) means "no exposure given," never a partial payoff.
 */

const payoffField = z.number().finite().nullable()

export const HedgeMatchSchema = z.object({
  provider: z.enum(['kalshi', 'polymarket']),
  externalId: z.string().min(1),
  question: z.string().min(1),
  url: z.string(),
  /** ISO date-time, or `null` when the market has no known close time. */
  closeTime: z.string().nullable(),
  yesPrice: z.number(),
  noPrice: z.number(),
  liquidityUsd: z.number().nullable(),
  side: z.enum(['YES', 'NO']),
  relevance: z.enum(['high', 'partial', 'weak']),
  reasoning: z.string(),
  /** The chosen side's price — guaranteed in (0, 1). */
  price: z.number().gt(0).lt(1),
  /** `spec.exposureUsd !== null` — whether the payoff fields below are sized. */
  sized: z.boolean(),
  stakeUsd: payoffField,
  shares: payoffField,
  payoutIfWin: payoffField,
  netIfBadOutcome: payoffField,
  netIfGoodOutcome: payoffField,
  coverageRatio: payoffField,
  coveragePct: payoffField,
})
export type HedgeMatch = z.infer<typeof HedgeMatchSchema>

export const HedgeProposalSchema = z.object({
  spec: HedgeSpecSchema,
  best: HedgeMatchSchema.nullable(),
  /** 0–2 remaining matches, relevance-order preserved from `rerank`. */
  alternatives: z.array(HedgeMatchSchema).max(2),
})
export type HedgeProposal = z.infer<typeof HedgeProposalSchema>
