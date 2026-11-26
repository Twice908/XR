import { sessionProgress } from '../services/rewards'
import { h } from '../ui/dom'
import { arc } from './rings'
import { ringsWidget } from './ringsUi'

/**
 * The block inside the leave-lab dialog: how far through the lab the student is, and what finishing would still
 * earn. It only ever shows what can be gained, never a threat of loss. Empty (and invisible) if the server is slow.
 */
export function leaveProgress(sessionId: string): HTMLElement {
  const el = h('div', { class: 'mx-leave', hidden: true })
  void sessionProgress(sessionId).then((p) => {
    if (!p || p.status !== 'in_progress' || !el.isConnected) return
    const size = 64
    const r = size / 2 - 5
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    ring.setAttribute('viewBox', `0 0 ${size} ${size}`)
    ring.setAttribute('class', 'mx-leave-ring')
    ring.setAttribute('aria-hidden', 'true')
    const { dash } = arc(p.progressPercent ?? 0, r)
    ring.innerHTML = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="currentColor" stroke-opacity="0.15" stroke-width="7"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#ff5c7a" stroke-width="7" stroke-linecap="round" stroke-dasharray="${dash}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-size="15" font-weight="700" fill="currentColor">${p.progressPercent === null ? '…' : `${p.progressPercent}%`}</text>`
    const week = ringsWidget(40, { stroke: 5, animate: false })
    week.set(p.rings)
    el.replaceChildren(
      ring,
      h('div', { class: 'mx-leave-body' }, h('p', { class: 'mx-leave-message' }, p.message), h('p', { class: 'mx-leave-week' }, week.el, `This week: ${p.rings.complete.value}/${p.rings.complete.goal} labs · ${p.rings.master.value}/${p.rings.master.goal} mastered · ${p.rings.explore.value}/${p.rings.explore.goal} min`)),
    )
    el.hidden = false
  })
  return el
}
