import { Suspense } from 'react'
import { SessionView } from './session-view'

export default function SessionPage() {
  return (
    <Suspense fallback={<SessionSkeleton />}>
      <SessionView />
    </Suspense>
  )
}

function SessionSkeleton() {
  return (
    <main className="mx-auto max-w-7xl p-6 space-y-6">
      <div className="h-24 animate-pulse rounded-2xl bg-gray-100" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <div className="h-80 animate-pulse rounded-2xl bg-gray-100" />
          <div className="h-56 animate-pulse rounded-2xl bg-gray-100" />
        </div>
        <div className="lg:col-span-2 h-96 animate-pulse rounded-2xl bg-gray-100" />
      </div>
    </main>
  )
}