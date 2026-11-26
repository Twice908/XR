import type { ClaimPackResponse } from '@mmaxr/schema'
import { go } from '../router'
import { h } from '../ui/dom'
import { sealedPack } from './cardFace'
import { lessonTitle } from './lessonTitles'
import { packPerks, tierLabel } from './rarity'

let current: HTMLElement | null = null

const pct = (n: number | null) => (n === null ? '' : `${Math.round(n)}%`)
const mins = (ms: number | null) => {
  if (ms === null) return ''
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Lines celebrating a personal record, if the claim reports one. Competence first: these are about the student's work. */
export function bestLines(best: ClaimPackResponse['personalBest']): string[] {
  if (!best) return []
  const lines: string[] = []
  if (best.newBestScore) lines.push(`New best score: ${pct(best.bestPercent)} (was ${pct(best.previousBestPercent)})`)
  if (best.newFastestTime) lines.push(`Fastest finish: ${mins(best.fastestMs)} (was ${mins(best.previousFastestMs)})`)
  if (best.levelUp) lines.push(`Mastery level ${best.masteryLevel} reached`)
  return lines
}

/**
 * The quiet "you earned a pack" card that slides in over the lab's results. It never covers the results themselves
 * and never opens the pack on its own: reading the feedback comes first, the reward second.
 */
export function showPackNotice(claim: ClaimPackResponse) {
  current?.remove()
  const { pack } = claim
  const close = () => {
    el.classList.add('is-leaving')
    window.setTimeout(() => el.remove(), 250)
    if (current === el) current = null
  }
  const open = h('button', { type: 'button', class: 'mx-btn mx-btn-primary' }, 'Open pack')
  const later = h('button', { type: 'button', class: 'mx-btn mx-btn-ghost' }, 'Later')
  open.addEventListener('click', () => {
    close()
    go(`/packs/${pack.id}`)
  })
  later.addEventListener('click', close)
  const perks = packPerks(pack)
  const bests = bestLines(claim.personalBest)
  const el = h(
    'aside',
    { class: 'mx-notice', role: 'status', 'aria-live': 'polite', 'data-tier': pack.tier },
    h('div', { class: 'mx-notice-pack' }, sealedPack(pack.tier, `${pack.cardCount}`)),
    h(
      'div',
      { class: 'mx-notice-body' },
      h('p', { class: 'mx-eyebrow' }, 'Lab complete'),
      h('h2', { class: 'mx-notice-title' }, `${tierLabel(pack)} earned`),
      h('p', { class: 'mx-notice-sub' }, `${lessonTitle(pack.lessonId)} · ${pack.cardCount} cards`),
      bests.length ? h('ul', { class: 'mx-notice-bests' }, ...bests.map((b) => h('li', null, b))) : null,
      perks.length ? h('div', { class: 'mx-notice-perks' }, ...perks.map((p) => h('span', { class: 'mx-chip' }, p))) : null,
      h('div', { class: 'mx-notice-actions' }, later, open),
    ),
  )
  document.body.appendChild(el)
  current = el
  requestAnimationFrame(() => el.classList.add('is-in'))
}
