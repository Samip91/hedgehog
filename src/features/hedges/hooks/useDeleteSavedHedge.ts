'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { deleteSavedHedge } from '../api'
import { HEDGES_QUERY_KEYS } from '../constants'

/** Delete a saved hedge, then refresh the list cache. */
export function useDeleteSavedHedge() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteSavedHedge,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: HEDGES_QUERY_KEYS.list() })
    },
  })
}
