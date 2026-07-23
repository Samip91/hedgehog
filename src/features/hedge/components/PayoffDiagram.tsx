'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ChartDatum } from '../lib/payoff'
import { formatUsd } from '../lib/format'

export interface PayoffDiagramProps {
  readonly data: readonly ChartDatum[]
}

const POSITIVE_FILL = '#059669' // emerald-600
const NEGATIVE_FILL = '#dc2626' // red-600

/**
 * 2-outcome payoff bars (design Q2/A): "if it happens" vs "if it doesn't".
 * The chart data is memoized by the caller and this component is stably
 * keyed there, so a stake drag re-heights the bars without a remount.
 */
export function PayoffDiagram({ data }: PayoffDiagramProps) {
  return (
    <div className="h-48 w-full" role="img" aria-label="Payoff by outcome">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={[...data]}
          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="currentColor"
            opacity={0.1}
          />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            fontSize={12}
            stroke="currentColor"
          />
          <YAxis
            tickFormatter={value => formatUsd(Number(value))}
            width={68}
            tickLine={false}
            axisLine={false}
            fontSize={12}
            stroke="currentColor"
          />
          <Tooltip
            formatter={value => formatUsd(Number(value))}
            contentStyle={{ borderRadius: 12, fontSize: 13 }}
          />
          <Bar dataKey="net" radius={[6, 6, 0, 0]} isAnimationActive={false}>
            {data.map(entry => (
              <Cell
                key={entry.label}
                fill={entry.net >= 0 ? POSITIVE_FILL : NEGATIVE_FILL}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
