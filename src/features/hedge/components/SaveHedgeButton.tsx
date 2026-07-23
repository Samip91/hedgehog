'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { HedgeMatch } from '@/shared/proposal'
import type { HedgeSpec, SaveHedgeRequest } from '@/shared/schemas'
import { toSaveHedgeRequest, useSaveHedge } from '@/features/hedges'

export interface SaveHedgeButtonProps {
  readonly prompt: string
  readonly spec: HedgeSpec
  readonly best: HedgeMatch
  readonly stakeUsd: number
}

const GENERIC_ERROR = 'Something went wrong. Please try again.'

/**
 * One-tap save (AC 23–26). Lives in the `hedge` slice (consumes the
 * proposal-tree shape) but crosses into the `hedges` slice only via its
 * barrel (`toSaveHedgeRequest` + `useSaveHedge`) — one-directional, no
 * cycle. Disabled whenever `stakeUsd <= 0` so it never POSTs a zero stake
 * (AC 24); on success it navigates to the saved hedge's detail page (Q2);
 * on failure it returns to idle with a retryable inline error, no nav
 * (AC 25); the pending-disable also makes a double-tap a no-op (AC 26).
 */
export function SaveHedgeButton({
  prompt,
  spec,
  best,
  stakeUsd,
}: SaveHedgeButtonProps) {
  const router = useRouter()
  const { mutate, isPending, data, error, reset } = useSaveHedge()
  const [buildError, setBuildError] = useState<string | null>(null)

  const disabled = stakeUsd <= 0

  function handleClick() {
    if (disabled || isPending) return
    setBuildError(null)
    reset()

    let request: SaveHedgeRequest
    try {
      request = toSaveHedgeRequest({ prompt, spec, best, stakeUsd })
    } catch {
      setBuildError(GENERIC_ERROR)
      return
    }

    mutate(request, {
      onSuccess: res => {
        if (res.ok) router.push(`/hedge/${res.data.id}`)
      },
    })
  }

  const errorMessage =
    buildError ??
    (data && !data.ok ? data.error.message : null) ??
    (error ? GENERIC_ERROR : null)

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || isPending}
        aria-disabled={disabled || isPending}
        className="h-11 w-full rounded-full bg-emerald-600 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-40"
      >
        {isPending ? 'Saving…' : 'Save this hedge'}
      </button>

      {disabled && !isPending && (
        <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
          Enter an amount to save this hedge.
        </p>
      )}

      {errorMessage && (
        <p
          role="alert"
          className="text-center text-xs text-red-600 dark:text-red-400"
        >
          {errorMessage}
        </p>
      )}
    </div>
  )
}
