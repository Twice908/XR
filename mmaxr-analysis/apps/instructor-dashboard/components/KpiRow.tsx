import type { RubricDimension } from '@mmaxr/schema'

type ScoredDimension = {
  key: RubricDimension
  label: string
  color: string
  value: number
}

export function KpiRow({
  avg,
  events,
  strongest,
  weakest,
}: {
  avg: number
  events: number
  strongest: ScoredDimension
  weakest: ScoredDimension
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi label="Average score" value={avg.toFixed(1)} suffix="/ 100" />
      <Kpi
        label="Total events"
        value={events.toString()}
        suffix={events === 1 ? 'event' : 'events'}
      />
      <Kpi
        label="Strongest"
        value={strongest.value.toString()}
        suffix="/ 100"
        sublabel={strongest.label}
        accentDot={strongest.color}
      />
      <Kpi
        label="Needs attention"
        value={weakest.value.toString()}
        suffix="/ 100"
        sublabel={weakest.label}
        accentDot={weakest.color}
      />
    </div>
  )
}

function Kpi({
  label,
  value,
  suffix,
  sublabel,
  accentDot,
}: {
  label: string
  value: string
  suffix?: string
  sublabel?: string
  accentDot?: string
}) {
  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(24,24,27,0.04)]">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        {accentDot && (
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accentDot }} />
        )}
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="tnum text-2xl font-semibold tracking-tight text-zinc-900">{value}</span>
        {suffix && <span className="text-xs text-zinc-400">{suffix}</span>}
      </div>
      {sublabel && <div className="mt-1 text-xs text-zinc-500">{sublabel}</div>}
    </div>
  )
}