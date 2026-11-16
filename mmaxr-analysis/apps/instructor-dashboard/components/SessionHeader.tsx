import Link from 'next/link'
import type { SessionDetail, SessionSummary } from '@/lib/types'

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return iso
  }
}

export function SessionHeader({
  sessionId,
  summary,
  analysis,
}: {
  sessionId: string
  summary?: SessionSummary
  analysis: SessionDetail
}) {
  const student = summary?.studentId?.trim()
  const lesson = summary?.lessonId?.trim()
  const status = summary?.status

  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-900"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          All sessions
        </Link>

        <h1 className="mt-2 truncate text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
          {student || 'Session analysis'}
        </h1>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500">
          <span className="font-mono text-xs text-zinc-600">{sessionId}</span>
          {lesson && (
            <>
              <span className="h-1 w-1 rounded-full bg-zinc-300" />
              <span>{lesson}</span>
            </>
          )}
          <span className="h-1 w-1 rounded-full bg-zinc-300" />
          <span>Analyzed {formatTimestamp(analysis.timestamp)}</span>
        </div>
      </div>

      {status && (
        <div className="flex shrink-0 items-center gap-2">
          <StatusPill status={status} />
        </div>
      )}
    </header>
  )
}

function StatusPill({ status }: { status: 'active' | 'completed' | 'abandoned' }) {
  const map = {
    active: {
      label: 'Active',
      classes: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      dot: 'bg-emerald-500',
    },
    completed: {
      label: 'Completed',
      classes: 'border-blue-200 bg-blue-50 text-blue-700',
      dot: 'bg-blue-500',
    },
    abandoned: {
      label: 'Abandoned',
      classes: 'border-zinc-200 bg-zinc-100 text-zinc-600',
      dot: 'bg-zinc-400',
    },
  } as const
  const v = map[status]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${v.classes}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${v.dot}`} />
      {v.label}
    </span>
  )
}