export function EmptyState() {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-zinc-300 bg-white/60 p-12 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100">
        <svg
          className="h-6 w-6 text-zinc-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.8}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
      </div>
      <h3 className="mt-4 text-base font-semibold text-zinc-900">No sessions yet</h3>
      <p className="mt-1 text-sm text-zinc-500">
        Launch the WebXR client once and sessions will appear here automatically.
      </p>
    </div>
  )
}