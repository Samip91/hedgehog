import type { ApiResponse } from '@/shared/schemas'
import type { HedgeProposal } from '@/shared/proposal'

/** POST the user's free-text risk to the hedge pipeline. */
export async function requestHedge(
  prompt: string
): Promise<ApiResponse<HedgeProposal>> {
  const res = await fetch('/api/hedge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })
  return (await res.json()) as ApiResponse<HedgeProposal>
}
