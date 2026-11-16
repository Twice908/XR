'use client'
import { useSessionList } from '@/hooks/useSessionData'
import { PageHeader } from '@/components/PageHeader'
import { SessionCard } from '@/components/SessionCard'
import { EmptyState } from '@/components/EmptyState'

export default function SessionsPage() {
  const { data, error, isLoading } = useSessionList()
  const rows = data ?? []

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="Sessions"
        subtitle={
          isLoading
            ? 'Loading…'
            : error
            ? 'Failed to load'
            : `${rows.length} ${rows.length === 1 ? 'session' : 'sessions'} in this run`
        }
        showLive={!isLoading && !error}
      />

      {isLoading && <SessionListSkeleton />}

      {error && (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
          <div className="font-semibold">Failed to load sessions</div>
          <div className="mt-1 text-sm text-red-600">{String(error)}</div>
          <div className="mt-3 text-xs text-red-500">
            Check that{' '}
            <code className="rounded bg-red-100 px-1.5 py-0.5 font-mono">
              GET http://localhost:3002/sessions
            </code>{' '}
            is reachable.
          </div>
        </div>
      )}

      {!isLoading && !error && rows.length === 0 && <EmptyState />}

      {!isLoading && !error && rows.length > 0 && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((s) => (
            <SessionCard key={s.session_id} session={s} />
          ))}
        </div>
      )}
    </main>
  )
}

function SessionListSkeleton() {
  return (
    <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-32 animate-pulse rounded-2xl bg-zinc-100" />
      ))}
    </div>
  )
}