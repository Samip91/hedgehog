'use client'

import { useMutation } from '@tanstack/react-query'
import { requestHedge } from '../api'

/** Drives the Ask screen submit → hedge pipeline. */
export function useRequestHedge() {
  return useMutation({ mutationFn: requestHedge })
}
