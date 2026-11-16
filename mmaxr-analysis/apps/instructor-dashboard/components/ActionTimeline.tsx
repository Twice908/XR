'use client'
import type { TraceEvent } from '@/lib/types'
import { dimensionMeta } from '@/lib/rubric'

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return iso
  }
}

export function ActionTimeline({ events }: { events: TraceEvent[] }) {
  if (!events.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-5 py-12 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100">
          <svg
            className="h-5 w-5 text-zinc-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <div className="text-sm font-medium text-zinc-700">No events recorded yet</div>
        <div className="text-xs text-zinc-500">
          Interactions will appear here as the student progresses.
        </div>
      </div>
    )
  }

  return (
    <ol className="relative px-5 py-5">
      <div
        className="absolute left-[28px] top-6 bottom-6 w-px bg-zinc-200"
        aria-hidden
      />

      {events.map((e, i) => {
        const meta = dimensionMeta(e.dimension ?? null)
        const title = e.action ?? e.verb ?? 'event'
        const detail = e.detail ?? e.object ?? ''
        return (
          <li
            key={e.id ?? `${e.timestamp}-${i}`}
            className="relative flex gap-4 pb-6 last:pb-0"
          >
            <div className="relative z-10 mt-1 flex h-4 w-4 shrink-0 items-center justify-center">
              <span
                className="block h-3 w-3 rounded-full ring-4 ring-white"
                style={{ backgroundColor: meta.color }}
              />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] tabular-nums text-zinc-400">
                  {formatTime(e.timestamp)}
                </span>
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ backgroundColor: `${meta.color}1a`, color: meta.color }}
                >
                  {meta.label}
                </span>
              </div>
              <div className="mt-1 text-sm font-medium text-zinc-900">{title}</div>
              {detail && <div className="mt-0.5 text-sm text-zinc-600">{detail}</div>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}