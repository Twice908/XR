import type { MissionsNarration } from '@mmaxr/schema'
import { CONFIG } from '../config'
import { h } from '../ui/dom'
import { Narrator } from './narrator'

/** A lab's recorded narration: `say(cueId)` speaks one line with a caption. Unknown cues are ignored. */
export interface LabNarration {
  say(cueId: string): void
  /** Speaks a cue the first time only, for lines tied to a moment that can repeat (a phase change, a reveal). */
  once(cueId: string): void
  stop(): void
  dispose(): void
}

const silent: LabNarration = { say() {}, once() {}, stop() {}, dispose() {} }

/**
 * Loads the lines for a lab (served by the lesson loader from mmaxr-assets/narration) and puts their caption in `mount`.
 * Narration is a nice-to-have: if it cannot load, the lab runs silently instead of failing.
 */
export async function loadLabNarration(lessonId: string, mount: HTMLElement): Promise<LabNarration> {
  let cues: Record<string, MissionsNarration>
  try {
    const res = await fetch(`${CONFIG.LESSONS_URL}/${encodeURIComponent(lessonId)}/narration`)
    if (!res.ok) return silent
    cues = ((await res.json()) as { cues?: Record<string, MissionsNarration> }).cues ?? {}
  } catch {
    return silent
  }
  if (Object.keys(cues).length === 0) return silent

  const caption = h('p', { class: 'lab-caption', 'aria-live': 'polite' })
  mount.appendChild(caption)
  // `once` lines wait for the line being spoken to end instead of cutting it off. Only the newest waits:
  // a student who moves on quickly hears where they are now, not a backlog.
  let speaking = false
  let waiting: string | null = null
  let waitTimer = 0
  const narrator = new Narrator(caption, (now) => {
    speaking = now
    if (now || !waiting) return
    window.clearTimeout(waitTimer)
    waitTimer = window.setTimeout(() => {
      if (speaking || !waiting) return
      const next = waiting
      waiting = null
      say(next)
    }, 400)
  })
  const spoken = new Set<string>()
  const say = (cueId: string) => {
    const line = cues[cueId]
    if (!line) return
    spoken.add(cueId)
    narrator.say(line)
  }
  return {
    say,
    once(cueId) {
      if (spoken.has(cueId) || !cues[cueId]) return
      spoken.add(cueId)
      if (speaking) waiting = cueId
      else say(cueId)
    },
    stop: () => {
      waiting = null
      narrator.stop()
    },
    dispose() {
      waiting = null
      window.clearTimeout(waitTimer)
      narrator.dispose()
      caption.remove()
    },
  }
}
