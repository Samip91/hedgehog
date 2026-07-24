'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { saveHedge } from '../api'
import { HEDGES_QUERY_KEYS } from '../constants'

/** Save (idempotent upsert) a hedge, then refresh the list cache. */
export function useSaveHedge() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: saveHedge,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: HEDGES_QUERY_KEYS.list() })
    },
  })
}
