'use client'

import { useEffect, useState } from 'react'

/** Circular percentage ring with the value in the middle. */
export function ScoreRing({ percent, size = 168, stroke = 12, caption }: { percent: number | null; size?: number; stroke?: number; caption?: string }) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(percent ?? 0))
    return () => cancelAnimationFrame(id)
  }, [percent])

  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const color = percent === null ? '#525252' : percent >= 70 ? '#3ecf8e' : percent >= 40 ? '#f5a524' : '#f31260'

  return (
    <div role="img" aria-label={percent === null ? 'Overall learning score not available' : `Overall learning score ${percent} percent`} style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#ffffff1f" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown / 100)}
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.2, 0, 0, 1)' }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center', textAlign: 'center' }}>
        <div className="vc-mono" style={{ fontSize: size * 0.26, fontWeight: 600, lineHeight: 1, letterSpacing: '-0.03em' }}>
          {percent === null ? '–' : `${percent}%`}
        </div>
        {caption ? <div style={{ marginTop: 6, fontSize: 12, color: '#a1a1a1' }}>{caption}</div> : null}
      </div>
    </div>
  )
}
