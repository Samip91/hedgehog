'use client'

import { useState } from 'react'
import { useRequestHedge } from '../hooks/useRequestHedge'
import { ASK_PLACEHOLDER, EXAMPLE_CHIPS } from '../constants'
import { ProposalResult } from '@/features/hedge'

const STAGES = ['Understanding your risk…', 'Searching live markets…'] as const

export function AskForm() {
  const [prompt, setPrompt] = useState('')
  const { mutate, isPending, data, error, variables } = useRequestHedge()

  const disabled = isPending || prompt.trim().length === 0

  function submit() {
    if (disabled) return
    mutate(prompt.trim())
  }

  return (
    <div className="w-full max-w-md">
      <label htmlFor="risk" className="sr-only">
        Describe your risk
      </label>
      <textarea
        id="risk"
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        placeholder={ASK_PLACEHOLDER}
        rows={3}
        className="w-full resize-none rounded-2xl border border-black/10 bg-white p-4 text-base leading-relaxed shadow-sm outline-none focus:border-black/30 dark:border-white/15 dark:bg-zinc-900"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        {EXAMPLE_CHIPS.map(chip => (
          <button
            key={chip.label}
            type="button"
            onClick={() => setPrompt(chip.prompt)}
            className="rounded-full border border-black/10 px-3 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-black/[.04] dark:border-white/15 dark:text-zinc-300 dark:hover:bg-white/[.06]"
          >
            {chip.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={disabled}
        className="mt-4 h-12 w-full rounded-full bg-emerald-600 text-base font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-40"
      >
        {isPending ? STAGES[0] : 'Find my hedge'}
      </button>

      <ProposalResult
        isPending={isPending}
        data={data}
        error={error}
        prompt={variables ?? ''}
      />
    </div>
  )
}
