'use client'

import { cn } from '@/lib/utils'

export interface StakeSliderProps {
  readonly id: string
  readonly label: string
  readonly value: number
  readonly min: number
  readonly max: number
  readonly step: number
  /** Formatted stake, e.g. `"$120"` — surfaced to assistive tech as the current value. */
  readonly valueText: string
  readonly onChange: (value: number) => void
  readonly className?: string
}

/** House-styled native `<input type="range">` — no new dep (plan Q3). */
export function StakeSlider({
  id,
  label,
  value,
  min,
  max,
  step,
  valueText,
  onChange,
  className,
}: StakeSliderProps) {
  return (
    <div className={cn('w-full', className)}>
      <div className="flex items-baseline justify-between">
        <label
          htmlFor={id}
          className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          {label}
        </label>
        <span className="text-sm font-medium text-zinc-900 tabular-nums dark:text-zinc-100">
          {valueText}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={valueText}
        onChange={event => onChange(Number(event.target.value))}
        className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-black/10 accent-emerald-600 outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 dark:bg-white/15"
      />
    </div>
  )
}
