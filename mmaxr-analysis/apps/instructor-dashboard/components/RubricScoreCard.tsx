export function RubricScoreCard({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: string
}) {
  const pct = Math.min(100, Math.max(0, value))

  return (
    <div className="group relative overflow-hidden rounded-xl border border-zinc-200/80 bg-white p-3.5 transition-colors hover:border-zinc-300">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-xs font-medium text-zinc-600">{label}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="tnum text-xl font-semibold tracking-tight text-zinc-900">{value}</span>
        <span className="text-[10px] text-zinc-400">/ 100</span>
      </div>
      <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-zinc-100">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}