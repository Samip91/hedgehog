import type { HedgeMatch } from '@/shared/proposal'
import type { HedgeSpec, SaveHedgeRequest } from '@/shared/schemas'
import { SaveHedgeRequestSchema } from '@/shared/schemas'

export interface ToSaveHedgeRequestInput {
  readonly prompt: string
  readonly spec: HedgeSpec
  readonly best: HedgeMatch
  readonly stakeUsd: number
}

const PROVIDER_UPPER: Record<
  HedgeMatch['provider'],
  SaveHedgeRequest['provider']
> = {
  kalshi: 'KALSHI',
  polymarket: 'POLYMARKET',
}

/**
 * Pure mapper: proposal-tree shape (`HedgeMatch`/`HedgeSpec`, lowercase
 * provider) → the `SaveHedgeRequest` API contract (uppercase provider,
 * client-minted `id`). Zod-validates before returning — throws on a bad
 * shape so the caller (mutation) surfaces it as an error, never a silent
 * malformed POST.
 */
export function toSaveHedgeRequest({
  prompt,
  spec,
  best,
  stakeUsd,
}: ToSaveHedgeRequestInput): SaveHedgeRequest {
  const request: SaveHedgeRequest = {
    id: crypto.randomUUID(),
    prompt,
    spec,
    provider: PROVIDER_UPPER[best.provider],
    externalId: best.externalId,
    question: best.question,
    side: best.side,
    entryPrice: best.price,
    stakeUsd,
  }

  return SaveHedgeRequestSchema.parse(request)
}
