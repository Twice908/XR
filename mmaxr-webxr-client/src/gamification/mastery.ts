import type { PersonalBest } from '@mmaxr/schema'
import { h } from '../ui/dom'

const mins = (ms: number) => {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** The tooltip line for a lab's personal bests. */
export function bestSummary(b: PersonalBest): string {
  const parts = [`Mastery ${b.masteryLevel} of 5`]
  if (b.bestPercent !== null) parts.push(`best ${Math.round(b.bestPercent)}%`)
  if (b.fastestMs !== null) parts.push(`fastest ${mins(b.fastestMs)}`)
  parts.push(`${b.completions} ${b.completions === 1 ? 'finish' : 'finishes'}`)
  return parts.join(' · ')
}

/** Five pips for a lab's mastery level, with the personal bests in its label. */
export function masteryBadge(b: PersonalBest): HTMLElement {
  const label = bestSummary(b)
  return h(
    'span',
    { class: 'sky-badge mx-mastery', title: label, 'aria-label': label, 'data-level': String(b.masteryLevel) },
    ...Array.from({ length: 5 }, (_, i) => h('span', { class: i < b.masteryLevel ? 'mx-pip is-on' : 'mx-pip', 'aria-hidden': 'true' })),
    b.bestPercent !== null ? h('span', { class: 'mx-mastery-best', 'aria-hidden': 'true' }, `${Math.round(b.bestPercent)}%`) : null,
  )
}
