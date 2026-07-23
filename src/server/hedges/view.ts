import type { MarketSnapshot, SavedHedge } from '@prisma/client'
import type { SavedHedgeView } from '@/features/hedges/types'
import { settle, type SettleInput } from '@/server/hedges/settle'

/**
 * `SavedHedge` row (+ its joined `MarketSnapshot`, or `null` when none
 * exists yet) → `SavedHedgeView`. Decimal→number coercion is isolated here
 * (mirrors `retrieve.ts`'s boundary pattern) — `settle()` itself stays pure
 * `number`-only.
 */
export function savedHedgeToView(
  row: SavedHedge,
  snapshot: MarketSnapshot | null
): SavedHedgeView {
  const input: SettleInput = {
    side: row.side,
    stakeUsd: Number(row.stakeUsd),
    shares: Number(row.shares),
    snapshot:
      snapshot === null
        ? null
        : {
            status: snapshot.status,
            resolvedYes: snapshot.resolvedYes,
            yesPrice: Number(snapshot.yesPrice),
            noPrice: Number(snapshot.noPrice),
          },
  }
  const result = settle(input)

  return {
    id: row.id,
    prompt: row.prompt,
    question: row.question,
    side: row.side,
    entryPrice: Number(row.entryPrice),
    currentPrice: result.currentPrice,
    stakeUsd: Number(row.stakeUsd),
    simulatedPnlUsd: result.simulatedPnlUsd,
    status: result.status,
  }
}
