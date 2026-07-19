import type { ApiResponse } from '@/shared/schemas'

/** POST the user's free-text risk to the hedge pipeline. */
export async function requestHedge(
  prompt: string
): Promise<ApiResponse<{ hedgeId: string }>> {
  const res = await fetch('/api/hedge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })
  return (await res.json()) as ApiResponse<{ hedgeId: string }>
}
