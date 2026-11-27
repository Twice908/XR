import type { RewardCard } from '@mmaxr/schema'
import { h } from '../ui/dom'
import { RARITY_LABEL, SET_LABEL } from './rarity'

/** Sets whose subtitle is a symbol, formula or unit: that makes a good placeholder glyph. The rest show initials. */
const SYMBOL_SETS = new Set(['elements', 'compounds', 'fundamental-quantities', 'derived-quantities', 'symbols', 'powers', 'formulas'])

/** The big text in the placeholder art slot. */
export function placeholderGlyph(card: Pick<RewardCard, 'set' | 'title' | 'subtitle'>): string {
  if (SYMBOL_SETS.has(card.set)) return card.subtitle
  return card.title
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')
}

/** Illustrated art for a card, when the designers have drawn it: the 118 elements and the 27 physics quantities. */
export interface CardArt {
  front: string
  frontSmall: string
  back: string
}

const ART_ROOT = `${import.meta.env.BASE_URL ?? '/'}cards`

/** Physics quantities with drawn art (the key in `phys-base-<key>` / `phys-der-<key>`). */
const PHYSICS_ART = new Set([
  'length', 'mass', 'time', 'current', 'temperature', 'amount', 'luminous',
  'area', 'volume', 'density', 'speed', 'acceleration', 'frequency', 'force', 'momentum', 'pressure', 'energy', 'power',
  'charge', 'voltage', 'resistance', 'torque', 'capacitance', 'flux-density', 'flux', 'inductance', 'power-of-lens',
])

const artAt = (base: string): CardArt => ({ front: `${base}-front.webp`, frontSmall: `${base}-front-sm.webp`, back: `${base}-back.webp` })

export function cardArt(card: Pick<RewardCard, 'id'>): CardArt | null {
  const el = /^chem-el-([A-Z][a-z]?)$/.exec(card.id)
  if (el) return artAt(`${ART_ROOT}/elements/${el[1]}`)
  const phys = /^phys-(?:base|der)-([a-z-]+)$/.exec(card.id)
  if (phys && PHYSICS_ART.has(phys[1])) return artAt(`${ART_ROOT}/physics/${phys[1]}`)
  return null
}

export interface CardFaceOptions {
  /** Start showing the card's cover instead of its face. */
  faceDown?: boolean
  isNew?: boolean
  shards?: number
  foil?: boolean
  /** Extra line under the card, such as "Mastery guarantee". */
  note?: string | null
  /** Rendered width in CSS px, so the browser fetches the right art size. Default 200. */
  displayWidth?: number
  /** Lean toward the pointer with a holographic glare once face up. */
  tilt?: boolean
}

export interface CardFaceHandle {
  el: HTMLElement
  /** The rotating part: the reveal animation spins this. */
  inner: HTMLElement
  hasArt: boolean
  flipUp(): void
  /** Show or hide the fun fact over the face. */
  toggleFact(show?: boolean): void
  readonly isUp: boolean
}

/**
 * One card. Cards with illustrated art (see cardArt) show the drawn front, and turn over to the drawn info side.
 * The rest still use the PLACEHOLDER face: text and a rarity-coloured frame (see CARD_SPEC.md for the slots).
 * Everything is driven by data attributes (rarity, subject, set), so styles can vary by any of them.
 */
export function cardFace(card: RewardCard, opts: CardFaceOptions = {}): CardFaceHandle {
  const art = cardArt(card)
  const fact = h('div', { class: 'mx-card-fact', 'aria-hidden': 'true' }, h('p', { class: 'mx-card-fact-label' }, 'Did you know?'), h('p', null, card.funFact))
  let info: HTMLImageElement | null = null
  let front: HTMLElement
  let back: HTMLElement
  const cover = h('div', { class: 'mx-card-cover' }, h('span', { class: 'mx-card-back-mark' }, 'M'))
  if (art) {
    const img = h('img', {
      class: 'mx-card-img',
      src: art.frontSmall,
      srcset: `${art.frontSmall} 310w, ${art.front} 620w`,
      sizes: `${opts.displayWidth ?? 200}px`,
      alt: '',
      draggable: 'false',
      decoding: 'async',
      loading: opts.faceDown ? 'eager' : 'lazy',
    })
    front = h('div', { class: 'mx-card-front has-art', style: `--art: url("${art.front}")` }, img, h('div', { class: 'mx-card-glare' }))
    // The info side (data, fact, question) is drawn on the art's back; it loads the first time it is turned to.
    info = h('img', { class: 'mx-card-img mx-card-info', alt: '', draggable: 'false', decoding: 'async' })
    back = h('div', { class: 'mx-card-back has-art', 'aria-hidden': 'true' }, cover, info)
  } else {
    front = h(
      'div',
      { class: 'mx-card-front' },
      h('div', { class: 'mx-card-top' }, h('span', { class: 'mx-card-set', 'data-slot': 'set' }, SET_LABEL[card.set] ?? card.set), h('span', { class: 'mx-card-rarity', 'data-slot': 'rarity' }, RARITY_LABEL[card.rarity])),
      h('div', { class: 'mx-card-art', 'data-slot': 'art' }, h('span', { class: 'mx-card-glyph' }, placeholderGlyph(card))),
      h('div', { class: 'mx-card-name' }, h('h3', { class: 'mx-card-title', 'data-slot': 'title' }, card.title), h('p', { class: 'mx-card-subtitle', 'data-slot': 'subtitle' }, card.subtitle)),
      fact,
      h('div', { class: 'mx-card-glare' }),
    )
    back = h('div', { class: 'mx-card-back', 'aria-hidden': 'true' }, cover)
  }
  const tags = h(
    'div',
    { class: 'mx-card-tags' },
    opts.isNew ? h('span', { class: 'mx-tag mx-tag-new' }, 'New') : null,
    opts.shards ? h('span', { class: 'mx-tag' }, `+${opts.shards} shards`) : null,
  )
  const inner = h('div', { class: 'mx-card-inner' }, back, front)
  const el = h(
    'div',
    {
      class: `mx-card${opts.faceDown ? '' : ' is-up'}${opts.foil ? ' is-foil' : ''}${art ? ' has-art' : ''}`,
      'data-rarity': card.rarity,
      'data-subject': card.subject,
      'data-set': card.set,
      role: 'group',
      'aria-label': `${RARITY_LABEL[card.rarity]} card: ${card.title}, ${card.subtitle}`,
    },
    h('div', { class: 'mx-card-rays', 'aria-hidden': 'true' }),
    h('div', { class: 'mx-card-tilt' }, inner),
    tags,
    opts.note ? h('p', { class: 'mx-card-note' }, opts.note) : null,
  )
  if (opts.tilt) addTilt(el)
  let up = !opts.faceDown
  return {
    el,
    inner,
    hasArt: !!art,
    flipUp() {
      up = true
      el.classList.add('is-up')
    },
    toggleFact(show) {
      const next = show ?? !el.classList.contains('show-fact')
      if (info && art && next && !info.getAttribute('src')) info.src = art.back
      el.classList.toggle('show-fact', next)
      ;(info ? back : fact).setAttribute('aria-hidden', String(!next))
    },
    get isUp() {
      return up
    },
  }
}

/** Lean the card toward the pointer and slide a glare across it, like holding a foil card to the light. */
function addTilt(el: HTMLElement) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !matchMedia('(hover: hover)').matches) return
  let frame = 0
  el.addEventListener('pointermove', (e) => {
    if (!el.classList.contains('is-up')) return
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      const r = el.getBoundingClientRect()
      const x = (e.clientX - r.left) / r.width
      const y = (e.clientY - r.top) / r.height
      el.style.setProperty('--tilt-x', `${(0.5 - y) * 16}deg`)
      el.style.setProperty('--tilt-y', `${(x - 0.5) * 20}deg`)
      el.style.setProperty('--glare-x', `${x * 100}%`)
      el.style.setProperty('--glare-y', `${y * 100}%`)
      el.classList.add('is-tilting')
    })
  })
  el.addEventListener('pointerleave', () => {
    cancelAnimationFrame(frame)
    el.classList.remove('is-tilting')
    el.style.removeProperty('--tilt-x')
    el.style.removeProperty('--tilt-y')
  })
}

/** A sealed pack. Placeholder art as well: a rounded foil block coloured by the pack's tier. */
export function sealedPack(tier: string, label: string): HTMLElement {
  return h(
    'div',
    { class: 'mx-pack', 'data-tier': tier, 'aria-hidden': 'true' },
    h('div', { class: 'mx-pack-crimp' }),
    h('div', { class: 'mx-pack-body' }, h('span', { class: 'mx-pack-mark' }, 'M'), h('span', { class: 'mx-pack-label' }, label)),
    h('div', { class: 'mx-pack-crimp' }),
  )
}
