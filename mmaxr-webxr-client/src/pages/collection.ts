import type { CardSubject, CollectionCard, CollectionResponse, RewardCard } from '@mmaxr/schema'
import { departOut, revealIn } from '../ambience/index.js'
import { openCardDetail } from '../gamification/cardDetail'
import { cardFace, placeholderGlyph } from '../gamification/cardFace'
import { elementPosition } from '../gamification/periodic'
import { RARITY_LABEL } from '../gamification/rarity'
import { go, type Page } from '../router'
import { getCollection } from '../services/rewards'
import { getStage } from '../stage/index.js'
import { DASHBOARD_PALETTE } from '../stage/theme.js'
import { h } from '../ui/dom'

const SUBJECTS: { id: CardSubject; label: string }[] = [
  { id: 'chemistry', label: 'Chemistry' },
  { id: 'physics', label: 'Physics' },
  { id: 'mathematics', label: 'Mathematics' },
  { id: 'biology', label: 'Biology' },
]

const TAB_KEY = 'mmaxr.collection.subject'
const savedTab = (): CardSubject => {
  try {
    const v = localStorage.getItem(TAB_KEY) as CardSubject | null
    return v && SUBJECTS.some((s) => s.id === v) ? v : 'chemistry'
  } catch {
    return 'chemistry'
  }
}

type Owned = Extract<CollectionCard, { owned: true }>

/**
 * The collection book. Every card has a place, so missing ones show as empty outlines: completing a set is a
 * term-long goal you can see. Elements are laid out as a real periodic table.
 */
export function collectionPage(): Page {
  const stage = getStage()
  const { sound } = stage
  let destroyed = false
  let subject = savedTab()
  let shards = 0
  let data: CollectionResponse | null = null

  const back = h('button', { type: 'button', class: 'ghost-button' }, '← Labs')
  back.addEventListener('click', () => go('/experiments'))
  const totals = h('p', { class: 'mx-open-sub' })
  const tabButtons = SUBJECTS.map((s) => {
    const b = h('button', { type: 'button', role: 'tab', 'aria-selected': 'false', 'data-subject': s.id }, s.label)
    b.addEventListener('click', () => {
      if (subject === s.id) return
      subject = s.id
      try {
        localStorage.setItem(TAB_KEY, s.id)
      } catch {
        /* per-viewer convenience only */
      }
      sound.cue('select')
      void load()
    })
    return b
  })
  const tabs = h('div', { class: 'mx-levels mx-tabs', role: 'tablist', 'aria-label': 'Subject' }, ...tabButtons)
  const body = h('div', { class: 'mx-col-body', role: 'tabpanel' })
  const el = h(
    'div',
    { class: 'mx-col' },
    h('header', { class: 'mx-open-header' }, back, h('div', null, h('h1', { class: 'mx-open-title' }, 'Collection'), totals)),
    tabs,
    body,
  )

  const openOwned = (card: Owned) =>
    openCardDetail(card, {
      shards,
      host: el,
      onCue: (cue) => sound.cue(cue),
      onFoil: (left) => {
        shards = left
        card.foil = true
        renderTotals()
        render()
      },
    })

  /** A card in a grid: the real card when owned, an outline when not. */
  const tile = (card: CollectionCard) => {
    if (!card.owned) {
      return h(
        'div',
        { class: 'mx-slot', 'data-rarity': card.rarity, title: 'Not collected yet: finish labs to find it', 'aria-label': `${card.title}, not collected yet` },
        h('span', { class: 'mx-slot-glyph', 'aria-hidden': 'true' }, placeholderGlyph(card)),
        h('span', { class: 'mx-slot-title' }, card.title),
      )
    }
    const face = cardFace(card as RewardCard, { foil: card.foil, displayWidth: 132 })
    face.el.tabIndex = 0
    face.el.classList.add('is-small')
    if (card.count > 1) face.el.append(h('span', { class: 'mx-card-count' }, `×${card.count}`))
    face.el.addEventListener('click', () => openOwned(card))
    face.el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openOwned(card)
      }
    })
    return face.el
  }

  /** Elements as a periodic table: owned cells light up in their rarity colour. */
  const periodicTable = (cards: CollectionCard[]) => {
    const grid = h('div', { class: 'mx-ptable', role: 'grid', 'aria-label': 'Periodic table of your element cards' })
    for (const card of cards) {
      const z = card.order
      const { row, col } = elementPosition(z)
      const cell = h(
        card.owned ? 'button' : 'div',
        {
          class: `mx-el${card.owned ? ' is-owned' : ''}${card.owned && card.foil ? ' is-foil' : ''}`,
          'data-rarity': card.rarity,
          style: `grid-row:${row};grid-column:${col}`,
          'aria-label': `${z} ${card.title}${card.owned ? '' : ', not collected yet'}`,
          title: card.owned ? `${card.title}: open` : `${card.title}: not collected yet`,
          ...(card.owned ? { type: 'button' } : {}),
        },
        h('span', { class: 'mx-el-z' }, String(z)),
        h('span', { class: 'mx-el-sym' }, card.subtitle),
      )
      if (card.owned) cell.addEventListener('click', () => openOwned(card as Owned))
      grid.append(cell)
    }
    // Markers for where the two f-block rows belong.
    grid.append(
      h('div', { class: 'mx-el-gap', style: 'grid-row:6;grid-column:3', 'aria-hidden': 'true' }, '57–71'),
      h('div', { class: 'mx-el-gap', style: 'grid-row:7;grid-column:3', 'aria-hidden': 'true' }, '89–103'),
    )
    const legend = h(
      'div',
      { class: 'mx-legend' },
      ...(['common', 'rare', 'epic', 'legendary'] as const).map((r) => h('span', { class: 'mx-legend-item', 'data-rarity': r }, RARITY_LABEL[r])),
    )
    return h('div', { class: 'mx-ptable-wrap' }, h('div', { class: 'mx-ptable-scroll' }, grid), legend)
  }

  const renderTotals = () => {
    if (!data) return
    totals.textContent = `${data.totals.owned} of ${data.totals.total} cards · ${shards} shards`
  }

  const render = () => {
    if (!data) return
    for (const b of tabButtons) b.setAttribute('aria-selected', String(b.dataset.subject === subject))
    const sections = data.sets.map((set) => {
      const cards = data!.cards.filter((c) => c.set === set.set).sort((a, b) => a.order - b.order)
      const pct = Math.round((set.owned / set.total) * 100)
      const bar = h('div', { class: 'mx-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(set.total), 'aria-valuenow': String(set.owned), 'aria-label': `${set.title}: ${set.owned} of ${set.total}` }, h('span', { style: `width:${pct}%` }))
      return h(
        'section',
        { class: `mx-set${set.complete ? ' is-complete' : ''}` },
        h('header', { class: 'mx-set-head' }, h('h2', null, set.title), h('span', { class: 'mx-set-count' }, set.complete ? 'Complete set' : `${set.owned} / ${set.total}`), bar),
        set.set === 'elements' ? periodicTable(cards) : h('div', { class: 'mx-grid' }, ...cards.map(tile)),
      )
    })
    body.replaceChildren(...sections)
    void revealIn(sections, { delayMs: 40, staggerMs: 80, reducedMotion: stage.reducedMotion })
  }

  let request = 0
  const load = async () => {
    const mine = ++request
    for (const b of tabButtons) b.setAttribute('aria-selected', String(b.dataset.subject === subject))
    body.replaceChildren(h('p', { class: 'mx-empty' }, 'Opening your collection…'))
    try {
      const res = await getCollection(subject)
      // A later tab click wins over a slower earlier reply.
      if (destroyed || mine !== request) return
      data = res
      shards = res.shards
      // The totals in the reply cover every subject, not just this tab.
      renderTotals()
      render()
    } catch (err) {
      if (!destroyed) body.replaceChildren(h('p', { class: 'mx-empty' }, (err as Error).message))
    }
  }

  return {
    el,
    mounted() {
      stage.setCosmic(true)
      stage.setQuiet(false)
      stage.cosmos.setPalette(DASHBOARD_PALETTE, stage.time(900))
      if (stage.veil.showing) void stage.veil.hide(stage.time(500))
      void load()
    },
    async leave() {
      await departOut(el, { lift: 0, scale: 0.98, durationMs: 320, reducedMotion: stage.reducedMotion })
    },
    destroy() {
      destroyed = true
    },
  }
}
