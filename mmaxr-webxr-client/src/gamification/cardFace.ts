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

export interface CardFaceOptions {
  /** Start showing the card's cover instead of its face. */
  faceDown?: boolean
  isNew?: boolean
  shards?: number
  foil?: boolean
  /** Extra line under the card, such as "Mastery guarantee". */
  note?: string | null
}

export interface CardFaceHandle {
  el: HTMLElement
  flipUp(): void
  /** Show or hide the fun fact over the face. */
  toggleFact(show?: boolean): void
  readonly isUp: boolean
}

/**
 * One card. PLACEHOLDER ART: the face only draws text and a rarity-coloured frame. The final art comes from Figma;
 * see CARD_SPEC.md for the slots. Everything is driven by data attributes (rarity, subject, set) so the Figma
 * styles can replace this file's CSS without touching any page.
 */
export function cardFace(card: RewardCard, opts: CardFaceOptions = {}): CardFaceHandle {
  const fact = h('div', { class: 'mx-card-fact', 'aria-hidden': 'true' }, h('p', { class: 'mx-card-fact-label' }, 'Did you know?'), h('p', null, card.funFact))
  const front = h(
    'div',
    { class: 'mx-card-front' },
    h('div', { class: 'mx-card-top' }, h('span', { class: 'mx-card-set', 'data-slot': 'set' }, SET_LABEL[card.set] ?? card.set), h('span', { class: 'mx-card-rarity', 'data-slot': 'rarity' }, RARITY_LABEL[card.rarity])),
    h('div', { class: 'mx-card-art', 'data-slot': 'art' }, h('span', { class: 'mx-card-glyph' }, placeholderGlyph(card))),
    h('div', { class: 'mx-card-name' }, h('h3', { class: 'mx-card-title', 'data-slot': 'title' }, card.title), h('p', { class: 'mx-card-subtitle', 'data-slot': 'subtitle' }, card.subtitle)),
    fact,
  )
  const back = h('div', { class: 'mx-card-back', 'aria-hidden': 'true' }, h('span', { class: 'mx-card-back-mark' }, 'M'))
  const tags = h(
    'div',
    { class: 'mx-card-tags' },
    opts.isNew ? h('span', { class: 'mx-tag mx-tag-new' }, 'New') : null,
    opts.shards ? h('span', { class: 'mx-tag' }, `+${opts.shards} shards`) : null,
  )
  const el = h(
    'div',
    {
      class: `mx-card${opts.faceDown ? '' : ' is-up'}${opts.foil ? ' is-foil' : ''}`,
      'data-rarity': card.rarity,
      'data-subject': card.subject,
      'data-set': card.set,
      role: 'group',
      'aria-label': `${RARITY_LABEL[card.rarity]} card: ${card.title}`,
    },
    h('div', { class: 'mx-card-inner' }, back, front),
    tags,
    opts.note ? h('p', { class: 'mx-card-note' }, opts.note) : null,
  )
  let up = !opts.faceDown
  return {
    el,
    flipUp() {
      up = true
      el.classList.add('is-up')
    },
    toggleFact(show) {
      const next = show ?? !el.classList.contains('show-fact')
      el.classList.toggle('show-fact', next)
      fact.setAttribute('aria-hidden', String(!next))
    },
    get isUp() {
      return up
    },
  }
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
