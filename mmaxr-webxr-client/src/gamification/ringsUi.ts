import type { RingGoalLevel, RingsResponse } from '@mmaxr/schema'
import { go } from '../router'
import { packStore, ringsStore, setGoalLevel } from '../services/rewards'
import { h } from '../ui/dom'
import { sealedPack } from './cardFace'
import { arc, celebrated, daysLeft, LEVEL_INFO, markCelebrated, remaining, RING_INFO, RING_ORDER, ringNudge, type RingKey } from './rings'

const SVG = 'http://www.w3.org/2000/svg'
const svg = (tag: string, attrs: Record<string, string | number>) => {
  const el = document.createElementNS(SVG, tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  return el
}

export interface RingsWidget {
  el: SVGSVGElement
  set(r: Pick<RingsResponse, RingKey> | null): void
}

/**
 * Three nested rings, outer to inner: Complete, Master, Explore. Each arc grows from the top; a closed ring is
 * drawn solid with a soft glow. With `labels` the ring names sit under the arcs for screen readers.
 */
export function ringsWidget(size: number, opts: { stroke?: number; animate?: boolean } = {}): RingsWidget {
  const stroke = opts.stroke ?? Math.max(4, size * 0.085)
  const gap = stroke * 0.35
  const el = svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'mx-rings', role: 'img' }) as SVGSVGElement
  const arcs = RING_ORDER.map((key, i) => {
    const r = size / 2 - stroke / 2 - i * (stroke + gap)
    const color = RING_INFO[key].color
    const track = svg('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: color, 'stroke-opacity': 0.18, 'stroke-width': stroke })
    const fill = svg('circle', {
      cx: size / 2, cy: size / 2, r, fill: 'none', stroke: color, 'stroke-width': stroke, 'stroke-linecap': 'round',
      transform: `rotate(-90 ${size / 2} ${size / 2})`, 'stroke-dasharray': arc(0, r).dash, class: `mx-ring-arc${opts.animate === false ? '' : ' is-animated'}`,
    })
    el.append(track, fill)
    return { key, r, fill }
  })
  return {
    el,
    set(r) {
      const parts: string[] = []
      for (const a of arcs) {
        const ring = r?.[a.key]
        a.fill.setAttribute('stroke-dasharray', arc(ring?.percent ?? 0, a.r).dash)
        a.fill.classList.toggle('is-closed', !!ring?.closed)
        if (ring) parts.push(`${RING_INFO[a.key].name} ${ring.value} of ${ring.goal}`)
      }
      el.setAttribute('aria-label', parts.length ? `This week: ${parts.join(', ')}` : 'This week’s rings')
    },
  }
}

/** The rings button for the top bar, and the panel it opens. */
export function ringsButton(onCue?: (cue: 'open' | 'close' | 'select' | 'confirm') => void) {
  const mini = ringsWidget(28, { stroke: 4 })
  const button = h('button', { type: 'button', class: 'ghost-button mx-rings-button', 'aria-haspopup': 'dialog' }, mini.el, h('span', { class: 'mx-rings-button-label' }, 'This week'))

  const big = ringsWidget(168)
  const rows = h('ul', { class: 'mx-ring-rows' })
  const bonus = h('div', { class: 'mx-ring-bonus' })
  const resets = h('p', { class: 'mx-ring-resets' })
  const levelButtons = (['light', 'standard', 'stretch'] as RingGoalLevel[]).map((level) =>
    h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', 'data-level': level }, LEVEL_INFO[level]),
  )
  const levels = h('div', { class: 'segmented mx-levels', role: 'radiogroup', 'aria-label': 'Weekly goal' }, ...levelButtons)
  const closeButton = h('button', { type: 'button', class: 'ghost-button' }, 'Close')
  const dialog = h(
    'dialog',
    { class: 'settings-dialog mx-drawer mx-rings-panel', 'aria-labelledby': 'mx-rings-title' },
    h('header', null, h('h2', { id: 'mx-rings-title' }, 'This week’s rings'), closeButton),
    h('div', { class: 'mx-rings-hero' }, big.el, h('div', { class: 'mx-rings-side' }, rows, resets)),
    bonus,
    h('section', { class: 'mx-rings-goal' }, h('h3', null, 'Your weekly goal'), h('p', null, 'Pick what fits your week. You can change it any time.'), levels),
  ) as HTMLDialogElement

  const render = (r: RingsResponse | null) => {
    mini.set(r)
    big.set(r)
    button.classList.toggle('is-closed', !!r?.allClosed)
    if (!r) {
      rows.replaceChildren(h('li', { class: 'mx-empty' }, 'Loading…'))
      return
    }
    rows.replaceChildren(
      ...RING_ORDER.map((key) => {
        const ring = r[key]
        const left = remaining(key, ring)
        return h(
          'li',
          { class: 'mx-ring-row', style: `--ring:${RING_INFO[key].color}` },
          h('span', { class: 'mx-ring-dot', 'aria-hidden': 'true' }),
          h(
            'div',
            null,
            h('p', { class: 'mx-ring-name' }, RING_INFO[key].name, h('span', { class: 'mx-ring-value' }, `${ring.value} / ${ring.goal}`)),
            h('p', { class: 'mx-ring-counts' }, RING_INFO[key].counts),
            h('p', { class: ring.closed ? 'mx-ring-left is-done' : 'mx-ring-left' }, left ?? 'Closed'),
          ),
        )
      }),
    )
    const days = daysLeft()
    resets.textContent = `Resets Monday · ${days} ${days === 1 ? 'day' : 'days'} left`
    for (const b of levelButtons) b.setAttribute('aria-checked', String(b.dataset.level === r.level))
    if (r.bonusPackId) {
      // One bonus a week: once earned it stays earned, even if the goal is raised afterwards.
      const open = h('button', { type: 'button', class: 'mx-btn mx-btn-primary mx-btn-sm' }, 'See bonus pack')
      open.addEventListener('click', () => {
        dialog.close()
        go(`/packs/${r.bonusPackId}`)
      })
      bonus.replaceChildren(h('p', null, 'This week\u2019s bonus pack is earned.'), open)
    } else {
      bonus.replaceChildren(h('p', null, 'Close all three rings this week to earn a bonus pack.'))
    }
  }

  for (const b of levelButtons) {
    b.addEventListener('click', async () => {
      const level = b.dataset.level as RingGoalLevel
      if (ringsStore.current?.level === level) return
      onCue?.('select')
      try {
        await setGoalLevel(level)
        const r = await ringsStore.refresh()
        if (r?.bonusPackId && r.allClosed) void packStore.refresh()
      } catch {
        /* the radio simply stays where it was */
      }
    })
  }

  const unsubscribe = ringsStore.subscribe(render)
  button.addEventListener('click', () => {
    void ringsStore.refresh()
    dialog.showModal()
    onCue?.('open')
  })
  closeButton.addEventListener('click', () => dialog.close())
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close()
  })
  dialog.addEventListener('close', () => onCue?.('close'))

  return {
    button,
    dialog,
    dispose() {
      unsubscribe()
      if (dialog.open) dialog.close()
    },
  }
}

/** One line under the greeting naming the next small step: the open loop that brings students back. */
export function ringsNudge() {
  const el = h('p', { class: 'mx-nudge', hidden: true, 'aria-live': 'polite' })
  const dot = ringsWidget(18, { stroke: 3, animate: false })
  dot.el.setAttribute('aria-hidden', 'true')
  const text = h('span')
  el.append(dot.el, text)
  const unsubscribe = ringsStore.subscribe((r) => {
    el.hidden = !r
    if (!r) return
    dot.set(r)
    text.textContent = ringNudge(r)
  })
  return { el, dispose: unsubscribe }
}

/**
 * The once-a-week moment: all three rings close in front of the student, then the bonus pack appears.
 * Shown once per browser per week, and only when the bonus pack exists.
 */
export function celebrateIfClosed(r: RingsResponse | null, opts: { reducedMotion: boolean; onCue?: (cue: 'confirm' | 'open') => void }) {
  if (!r?.allClosed || !r.bonusPackId || celebrated(r.week)) return
  markCelebrated(r.week)
  const rings = ringsWidget(220)
  const open = h('button', { type: 'button', class: 'mx-btn mx-btn-primary' }, 'Open bonus pack')
  const later = h('button', { type: 'button', class: 'mx-btn mx-btn-ghost' }, 'Later')
  const el = h(
    'div',
    { class: 'mx-celebrate', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mx-celebrate-title' },
    h(
      'div',
      { class: 'mx-celebrate-body' },
      rings.el,
      h('p', { class: 'mx-eyebrow' }, 'This week'),
      h('h2', { id: 'mx-celebrate-title' }, 'All three rings closed'),
      h('p', { class: 'mx-celebrate-sub' }, `${r.complete.value} labs finished, ${r.master.value} mastered, ${r.explore.value} minutes exploring.`),
      h('div', { class: 'mx-celebrate-pack' }, sealedPack('weekly', 'Bonus')),
      h('div', { class: 'mx-open-actions' }, later, open),
    ),
  )
  const close = () => {
    el.classList.add('is-leaving')
    window.setTimeout(() => el.remove(), 300)
    document.removeEventListener('keydown', onKey)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }
  later.addEventListener('click', close)
  open.addEventListener('click', () => {
    close()
    go(`/packs/${r.bonusPackId}`)
  })
  document.addEventListener('keydown', onKey)
  document.body.appendChild(el)
  opts.onCue?.('open')
  // Start empty, then close all three together.
  rings.set({ explore: { ...r.explore, percent: 0, closed: false }, master: { ...r.master, percent: 0, closed: false }, complete: { ...r.complete, percent: 0, closed: false } })
  requestAnimationFrame(() => {
    el.classList.add('is-in')
    window.setTimeout(() => {
      rings.set(r)
      window.setTimeout(() => opts.onCue?.('confirm'), opts.reducedMotion ? 0 : 900)
    }, opts.reducedMotion ? 0 : 250)
  })
  open.focus({ preventScroll: true })
}
