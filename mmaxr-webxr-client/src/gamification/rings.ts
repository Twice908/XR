import type { LearningRing, RingGoalLevel, RingsResponse } from '@mmaxr/schema'

export type RingKey = 'explore' | 'master' | 'complete'

/** Outer to inner, as drawn. */
export const RING_ORDER: RingKey[] = ['complete', 'master', 'explore']

export const RING_INFO: Record<RingKey, { name: string; counts: string; unit: (n: number) => string; color: string }> = {
  complete: { name: 'Complete', counts: 'Different labs you finished this week', unit: (n) => (n === 1 ? 'lab' : 'labs'), color: '#ff5c7a' },
  master: { name: 'Master', counts: 'Labs finished at the mastery score', unit: (n) => (n === 1 ? 'mastered lab' : 'mastered labs'), color: '#a6f05c' },
  explore: { name: 'Explore', counts: 'Active minutes in labs (idle time does not count)', unit: (n) => (n === 1 ? 'minute' : 'minutes'), color: '#45d4ff' },
}

export const LEVEL_INFO: Record<RingGoalLevel, string> = {
  light: 'Light',
  standard: 'Standard',
  stretch: 'Stretch',
}

/** What is still needed to close one ring, e.g. "2 more labs". Null when it is closed. */
export function remaining(key: RingKey, ring: LearningRing): string | null {
  if (ring.closed) return null
  const left = Math.max(0, ring.goal - ring.value)
  return `${left} more ${RING_INFO[key].unit(left)}`
}

/**
 * The open loop to show the student: the ring nearest to closing, phrased as one small next step.
 * Rings at the same percentage prefer finishing labs over minutes, because finishing is what earns packs.
 */
export function ringNudge(r: Pick<RingsResponse, RingKey | 'allClosed' | 'bonusPackId'>): string {
  if (r.allClosed) return r.bonusPackId ? 'All three rings closed this week. Your bonus pack is waiting.' : 'All three rings closed this week. Well done.'
  const open = RING_ORDER.filter((k) => !r[k].closed).sort((a, b) => r[b].percent - r[a].percent || RING_ORDER.indexOf(a) - RING_ORDER.indexOf(b))
  const key = open[0]
  const closedCount = RING_ORDER.length - open.length
  const step = remaining(key, r[key])!
  const tail = closedCount === 2 && !r.bonusPackId ?'and earn this week’s bonus pack' : `to close your ${RING_INFO[key].name} ring`
  return `${step} ${tail}.`
}

/** Days until the week resets (Monday 00:00 local time), counting today. */
export function daysLeft(now = new Date()): number {
  const dow = now.getDay() || 7 // Monday 1 … Sunday 7
  return 8 - dow
}

/** Stroke dash for one ring arc: `[filled, gap]` along a circle of radius `r`. */
export function arc(percent: number, r: number): { length: number; dash: string } {
  const length = 2 * Math.PI * r
  const filled = (Math.max(0, Math.min(100, percent)) / 100) * length
  return { length, dash: `${filled.toFixed(2)} ${length.toFixed(2)}` }
}

/** Has this viewer already seen the "all rings closed" celebration for this week? Per-browser only. */
const SEEN_KEY = (week: string) => `mmaxr.rings.celebrated.${week}`
export function celebrated(week: string): boolean {
  try {
    return localStorage.getItem(SEEN_KEY(week)) === '1'
  } catch {
    return false
  }
}
export function markCelebrated(week: string) {
  try {
    localStorage.setItem(SEEN_KEY(week), '1')
  } catch {
    /* storage unavailable: it may celebrate again, which is harmless */
  }
}
