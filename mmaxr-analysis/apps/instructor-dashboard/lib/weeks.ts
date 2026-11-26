/** ISO weeks ("2026-W48"), Monday to Sunday, in the viewer's local time. */

const DAY = 86_400_000

export function weekKey(date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dow = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dow)
  const year = d.getUTCFullYear()
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / DAY + 1) / 7)
  return `${year}-W${String(week).padStart(2, '0')}`
}

/** The Monday a week key starts on (local midnight). */
export function weekStart(key: string): Date {
  const m = /^(\d{4})-W(\d{2})$/.exec(key)
  if (!m) throw new Error(`Bad week ${key}`)
  const year = Number(m[1])
  const jan4 = new Date(year, 0, 4)
  const monday = new Date(year, 0, 4 - ((jan4.getDay() || 7) - 1))
  monday.setDate(monday.getDate() + (Number(m[2]) - 1) * 7)
  return monday
}

export function shiftWeek(key: string, by: number): string {
  const d = weekStart(key)
  d.setDate(d.getDate() + by * 7 + 3)
  return weekKey(d)
}

/** "24 – 30 Nov 2026" */
export function weekLabel(key: string): string {
  const start = weekStart(key)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const day = (d: Date) => d.toLocaleDateString(undefined, { day: 'numeric' })
  const full = (d: Date) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  return start.getMonth() === end.getMonth() ? `${day(start)} – ${full(end)}` : `${start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${full(end)}`
}
