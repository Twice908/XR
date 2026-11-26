import type { LearningRing } from '@/lib/types'

/** Same colours as the student app: Complete (outer), Master, Explore (inner). */
export const RING_META = [
  { key: 'complete', name: 'Complete', color: '#ff5c7a', unit: 'labs' },
  { key: 'master', name: 'Master', color: '#a6f05c', unit: 'mastered' },
  { key: 'explore', name: 'Explore', color: '#45d4ff', unit: 'min' },
] as const

type Rings = { complete: LearningRing; master: LearningRing; explore: LearningRing }

/** Three nested weekly rings, the way students see them. */
export function WeekRings({ rings, size = 40 }: { rings: Rings; size?: number }) {
  const stroke = Math.max(3, size * 0.11)
  const gap = stroke * 0.35
  const label = RING_META.map((m) => `${m.name} ${rings[m.key].value} of ${rings[m.key].goal}`).join(', ')
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} style={{ flex: 'none' }}>
      {RING_META.map((m, i) => {
        const r = size / 2 - stroke / 2 - i * (stroke + gap)
        const c = 2 * Math.PI * r
        const pct = Math.max(0, Math.min(100, rings[m.key].percent))
        return (
          <g key={m.key} transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={m.color} strokeOpacity={0.18} strokeWidth={stroke} />
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={m.color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} />
          </g>
        )
      })}
    </svg>
  )
}
