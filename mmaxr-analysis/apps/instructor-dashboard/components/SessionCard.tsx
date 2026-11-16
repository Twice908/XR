import Link from 'next/link'
import type { SessionSummary } from '@/lib/types'

function relativeTime(input: string | number | undefined): string {
  if (input === undefined || input === null || input === '') return '—'
  const raw = String(input)
  const n = Number(raw)
  let ms: number
  if (Number.isFinite(n) && raw.length <= 10) {
    ms = n * 1000
  } else if (Number.isFinite(n) && raw.length <= 13) {
    ms = n * 1000
  } else if (Number.isFinite(n)) {
    ms = n
  } else {
    ms = Date.parse(raw)
  }
  if (!Number.isFinite(ms)) return '—'
  const diff = Math.max(0, Date.now() - ms)
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export function SessionCard({ session }: { session: SessionSummary }) {
  const id = session.session_id
  const shortId = id.length > 22 ? `${id.slice(0, 14)}…${id.slice(-6)}` : id
  const eventCount = Number(session.event_count ?? 0) || 0

  return (
    <Link
      href={`/sessions/${encodeURIComponent(id)}`}
      className="group relative flex flex-col rounded-2xl border border-zinc-200/80 bg-white p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-[0_10px_30px_-15px_rgba(24,24,27,0.15)] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Session
          </span>
        </div>
        <svg
          width="16"
          height="16"
          className="h-4 w-4 flex-shrink-0 -translate-x-1 text-zinc-300 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:text-zinc-500 group-hover:opacity-100"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>

      <div className="mt-3 font-mono text-sm text-zinc-900">{shortId}</div>

      <div className="mt-auto flex items-center gap-3 pt-5 text-xs text-zinc-500">
        <span className="inline-flex items-center gap-1.5">
          <svg
            width="14"
            height="14"
            className="h-3.5 w-3.5 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
          </svg>
          <span className="tnum">{eventCount}</span>
          <span>{eventCount === 1 ? 'event' : 'events'}</span>
        </span>
        <span className="h-1 w-1 rounded-full bg-zinc-300" />
        <span>{relativeTime(session.last_update)}</span>
      </div>
    </Link>
  )
}