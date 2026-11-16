'use client'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useSessionData, useSessionSummary } from '@/hooks/useSessionData'
import { SessionHeader } from '@/components/SessionHeader'
import { KpiRow } from '@/components/KpiRow'
import { SectionCard } from '@/components/SectionCard'
import { RubricRadar } from '@/components/RubricRadar'
import { RubricScoreCard } from '@/components/RubricScoreCard'
import { ActionTimeline } from '@/components/ActionTimeline'
import { DIMENSIONS } from '@/lib/rubric'

export function SessionView() {
  const params = useParams<{ sessionId: string }>()
  const sessionId = params?.sessionId

  if (!sessionId || sessionId === 'undefined') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
          <div className="font-semibold">Session not found</div>
          <div className="mt-1 text-sm text-red-600">
            The URL is missing a valid session id.
          </div>
          <Link
            href="/"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-red-700 hover:text-red-900"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to sessions
          </Link>
        </div>
      </main>
    )
  }

  return <SessionContent sessionId={sessionId} />
}

function SessionContent({ sessionId }: { sessionId: string }) {
  const { data, error, isLoading } = useSessionData(sessionId)
  const summary = useSessionSummary(sessionId)

  if (isLoading) return <SessionDetailSkeleton />
  if (error) return <SessionError error={error} />
  if (!data) return null

  const scored = DIMENSIONS.map((d) => ({ ...d, value: data.scores[d.key] ?? 0 }))
  const avg = scored.reduce((a, b) => a + b.value, 0) / scored.length
  const strongest = scored.reduce((a, b) => (a.value >= b.value ? a : b))
  const weakest = scored.reduce((a, b) => (a.value <= b.value ? a : b))
  const eventCount = data.trace?.length ?? 0

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <SessionHeader sessionId={sessionId} summary={summary} analysis={data} />

      <div className="mt-6">
        <KpiRow avg={avg} events={eventCount} strongest={strongest} weakest={weakest} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <SectionCard title="Rubric Profile" subtitle="Six dimensions of learning formation">
            <RubricRadar scores={data.scores} />
          </SectionCard>
        </div>

        <div className="lg:col-span-7">
          <SectionCard title="Dimension Breakdown" subtitle="Individual scores per rubric dimension">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {DIMENSIONS.map((d) => (
                <RubricScoreCard
                  key={d.key}
                  label={d.label}
                  color={d.color}
                  value={data.scores[d.key] ?? 0}
                />
              ))}
            </div>
          </SectionCard>
        </div>

        <div className="lg:col-span-12">
          <SectionCard
            title="Action Trace"
            subtitle={`${eventCount} ${eventCount === 1 ? 'event' : 'events'} recorded`}
            padded={false}
          >
            <ActionTimeline events={data.trace} />
          </SectionCard>
        </div>
      </div>
    </main>
  )
}

function SessionDetailSkeleton() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="h-20 animate-pulse rounded-2xl bg-zinc-100" />
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-zinc-100" />
        ))}
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="h-96 animate-pulse rounded-2xl bg-zinc-100 lg:col-span-5" />
        <div className="h-96 animate-pulse rounded-2xl bg-zinc-100 lg:col-span-7" />
        <div className="h-64 animate-pulse rounded-2xl bg-zinc-100 lg:col-span-12" />
      </div>
    </main>
  )
}

function SessionError({ error }: { error: unknown }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
        <div className="font-semibold">Failed to load session analysis</div>
        <div className="mt-1 text-sm text-red-600">{String(error)}</div>
        <Link
          href="/"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-red-700 hover:text-red-900"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to sessions
        </Link>
      </div>
    </main>
  )
}