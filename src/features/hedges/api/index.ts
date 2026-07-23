import type { ApiResponse } from '@/shared/schemas'
import type { SaveHedgeRequest } from '@/shared/schemas'
import type { SavedHedgeView } from '../types'

const JSON_HEADERS = { 'content-type': 'application/json' } as const

/** POST a saved hedge (idempotent upsert, `id` is client-minted). */
export async function saveHedge(
  req: SaveHedgeRequest
): Promise<ApiResponse<SavedHedgeView>> {
  const res = await fetch('/api/hedges', {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: 'same-origin',
    body: JSON.stringify(req),
  })
  return (await res.json()) as ApiResponse<SavedHedgeView>
}

/** GET the caller's saved hedges (anon-cookie scoped), newest first. */
export async function fetchSavedHedges(): Promise<
  ApiResponse<SavedHedgeView[]>
> {
  const res = await fetch('/api/hedges', {
    method: 'GET',
    credentials: 'same-origin',
  })
  return (await res.json()) as ApiResponse<SavedHedgeView[]>
}

/** GET a single saved hedge by id (404 if not owned/missing). */
export async function fetchSavedHedge(
  id: string
): Promise<ApiResponse<SavedHedgeView>> {
  const res = await fetch(`/api/hedges/${id}`, {
    method: 'GET',
    credentials: 'same-origin',
  })
  return (await res.json()) as ApiResponse<SavedHedgeView>
}

/** DELETE a saved hedge by id (404 if not owned/missing). */
export async function deleteSavedHedge(
  id: string
): Promise<ApiResponse<{ id: string }>> {
  const res = await fetch(`/api/hedges/${id}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  return (await res.json()) as ApiResponse<{ id: string }>
}
