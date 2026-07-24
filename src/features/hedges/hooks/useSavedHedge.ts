'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchSavedHedge } from '../api'
import { HEDGES_QUERY_KEYS } from '../constants'

/** A single saved hedge by id, settled at read time. */
export function useSavedHedge(id: string) {
  return useQuery({
    queryKey: HEDGES_QUERY_KEYS.detail(id),
    queryFn: () => fetchSavedHedge(id),
  })
}
