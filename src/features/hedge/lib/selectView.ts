/**
 * Pure state selector — the single source of truth for "exactly one render
 * state, never a stale previous result" (AC 1). `ProposalResult` calls this
 * and renders exactly one branch of the returned union; every precedence
 * decision (loading beats stale data, error before "amber" API error, etc.)
 * lives here, unit-tested, instead of scattered `if`s in JSX.
 */
import type { ApiResponse } from '@/shared/schemas'
import type { HedgeProposal, HedgeMatch } from '@/shared/proposal'
import type { HedgeSpec } from '@/shared/schemas'

export type ProposalView =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'error'
      readonly tone: 'red' | 'amber'
      readonly message: string
    }
  | { readonly kind: 'no-hedge'; readonly spec: HedgeSpec }
  | {
      readonly kind: 'sized'
      readonly spec: HedgeSpec
      readonly best: HedgeMatch
      readonly alternatives: readonly HedgeMatch[]
    }
  | {
      readonly kind: 'unsized'
      readonly spec: HedgeSpec
      readonly best: HedgeMatch
      readonly alternatives: readonly HedgeMatch[]
    }

export interface SelectViewInput {
  readonly isPending: boolean
  readonly data: ApiResponse<HedgeProposal> | undefined
  readonly error: Error | null
}

/** The existing red inline-error copy (`AskForm`) — moved verbatim. */
export const NETWORK_ERROR_MESSAGE = 'Something went wrong. Please try again.'

/**
 * Precedence (AC 1, 18–21): `isPending` beats any stale `data`/`error` from a
 * previous mutation → loading; a mutation-level `error` → red; no mutation
 * run yet → idle; a non-`ok` API response → amber; `best === null` →
 * no-hedge; otherwise sized/unsized by `best.sized`.
 */
export function selectView({
  isPending,
  data,
  error,
}: SelectViewInput): ProposalView {
  if (isPending) return { kind: 'loading' }
  if (error)
    return { kind: 'error', tone: 'red', message: NETWORK_ERROR_MESSAGE }
  if (data === undefined) return { kind: 'idle' }
  if (!data.ok)
    return { kind: 'error', tone: 'amber', message: data.error.message }

  const { spec, best, alternatives } = data.data
  if (best === null) return { kind: 'no-hedge', spec }
  return best.sized
    ? { kind: 'sized', spec, best, alternatives }
    : { kind: 'unsized', spec, best, alternatives }
}
