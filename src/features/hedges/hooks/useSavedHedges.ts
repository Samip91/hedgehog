'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchSavedHedges } from '../api'
import { HEDGES_QUERY_KEYS } from '../constants'

/** The caller's saved hedges list (anon-cookie scoped). */
export function useSavedHedges() {
  return useQuery({
    queryKey: HEDGES_QUERY_KEYS.list(),
    queryFn: fetchSavedHedges,
  })
}
