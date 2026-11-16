'use client'
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import type { RubricScores } from '@/lib/types'
import { DIMENSIONS } from '@/lib/rubric'

export function RubricRadar({ scores }: { scores: RubricScores }) {
  const data = DIMENSIONS.map((d) => ({
    dimension: d.label,
    value: scores[d.key] ?? 0,
  }))

  return (
    <div className="h-[340px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart
          data={data}
          outerRadius="72%"
          margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
        >
          <defs>
            <linearGradient id="radar-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.08} />
            </linearGradient>
          </defs>
          <PolarGrid stroke="#e4e4e7" strokeDasharray="3 3" />
          <PolarAngleAxis
            dataKey="dimension"
            tick={{ fill: '#71717a', fontSize: 11, fontWeight: 500 }}
          />
          <PolarRadiusAxis
            domain={[0, 100]}
            tick={{ fill: '#a1a1aa', fontSize: 10 }}
            axisLine={false}
            tickCount={5}
          />
          <Radar
            dataKey="value"
            stroke="#3b82f6"
            strokeWidth={2}
            fill="url(#radar-fill)"
            fillOpacity={1}
            dot={{ r: 3, fill: '#3b82f6', stroke: '#fff', strokeWidth: 1.5 }}
            isAnimationActive
            animationDuration={600}
          />
          <Tooltip
            formatter={(v: number) => [`${v} / 100`, 'Score']}
            contentStyle={{
              borderRadius: 10,
              border: '1px solid #e4e4e7',
              boxShadow: '0 8px 24px -12px rgba(24,24,27,0.15)',
              fontSize: 12,
            }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}