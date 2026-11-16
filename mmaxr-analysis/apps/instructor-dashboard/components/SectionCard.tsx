import { ReactNode } from 'react'

export function SectionCard({
  title,
  subtitle,
  children,
  padded = true,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  padded?: boolean
}) {
  return (
    <section className="rounded-2xl border border-zinc-200/80 bg-white shadow-[0_1px_2px_rgba(24,24,27,0.04)]">
      <header className="border-b border-zinc-100 px-5 py-4">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-900">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
      </header>
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  )
}