import type { CollectionCard, RewardCard } from '@mmaxr/schema'
import { upgradeFoil } from '../services/rewards'
import { h } from '../ui/dom'
import { cardFace } from './cardFace'
import { FOIL_COST } from './periodic'
import { RARITY_LABEL, SET_LABEL } from './rarity'

type OwnedCard = Extract<CollectionCard, { owned: true }>

/** Data fields worth showing under the card, in a readable order, per set. */
const FIELDS: Record<string, [string, string][]> = {
  elements: [['atomicNumber', 'Atomic number'], ['atomicMass', 'Atomic mass'], ['category', 'Category'], ['group', 'Group'], ['period', 'Period']],
  compounds: [['formula', 'Formula'], ['bondType', 'Bonding']],
  'fundamental-quantities': [['unitName', 'SI unit'], ['unit', 'Symbol']],
  'derived-quantities': [['unitName', 'SI unit'], ['unit', 'Symbol'], ['definedAs', 'Defined as'], ['baseUnits', 'In base units']],
  symbols: [['symbol', 'Symbol'], ['meaning', 'Means']],
  powers: [['rule', 'Rule'], ['example', 'Example']],
  formulas: [['formula', 'Formula'], ['gives', 'Gives']],
  cells: [['foundIn', 'Found in'], ['job', 'Main job']],
  systems: [['job', 'Main job'], ['organs', 'Key parts']],
  nomenclature: [['binomial', 'Scientific name'], ['genus', 'Genus'], ['kingdom', 'Kingdom'], ['ranks', 'Ranks']],
}

const show = (v: unknown) => (Array.isArray(v) ? v.join(v.length > 4 ? ' → ' : ', ') : String(v))

/**
 * One card up close: the card itself (tap to flip to its fact), its real data, a one-tap question, and the foil
 * upgrade. The question is practice only: nothing is recorded or scored.
 */
export function openCardDetail(card: OwnedCard, opts: { shards: number; host: HTMLElement; onFoil?: (shards: number) => void; onCue?: (cue: 'open' | 'close' | 'confirm' | 'deny' | 'select') => void }) {
  const face = cardFace(card as RewardCard, { foil: card.foil })
  face.el.tabIndex = 0
  const flip = () => {
    face.toggleFact()
    opts.onCue?.('select')
  }
  face.el.addEventListener('click', flip)
  face.el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      flip()
    }
  })

  const facts = h(
    'dl',
    { class: 'mx-detail-facts' },
    ...(FIELDS[card.set] ?? [])
      .filter(([k]) => card.data[k] !== undefined)
      .flatMap(([k, label]) => [h('dt', null, label), h('dd', null, show(card.data[k]))]),
  )

  // ---------- the one-tap question ----------
  // Test first, then learn: the details stay hidden until the student has tried to recall the answer.
  const quiz = h('section', { class: 'mx-quiz' })
  const q = card.question
  const locked = h('p', { class: 'mx-detail-locked' }, 'Answer the quick check to see this card\u2019s details.')
  if (q) facts.hidden = true
  else locked.hidden = true
  const unlock = () => {
    facts.hidden = false
    locked.hidden = true
  }
  if (q) {
    const feedback = h('p', { class: 'mx-quiz-feedback', 'aria-live': 'polite' })
    const choices = q.choices.map((choice, i) => {
      const b = h('button', { type: 'button', class: 'mx-quiz-choice' }, choice)
      b.addEventListener('click', () => {
        for (const other of choices) other.disabled = true
        choices[q.answerIndex].classList.add('is-right')
        unlock()
        if (i === q.answerIndex) {
          feedback.textContent = 'Correct!'
          opts.onCue?.('confirm')
        } else {
          b.classList.add('is-wrong')
          feedback.textContent = `Not quite: it's ${q.choices[q.answerIndex]}.`
          opts.onCue?.('deny')
        }
      })
      return b
    })
    quiz.append(h('h3', null, 'Quick check'), h('p', { class: 'mx-quiz-prompt' }, q.prompt), h('div', { class: 'mx-quiz-choices' }, ...choices), feedback)
  }

  // ---------- foil ----------
  const cost = FOIL_COST[card.rarity]
  const foilStatus = h('p', { class: 'mx-foil-status' })
  const foilButton = h('button', { type: 'button', class: 'mx-btn mx-btn-ghost mx-btn-sm' }, `Make foil · ${cost} shards`)
  let shards = opts.shards
  const renderFoil = (foil: boolean) => {
    if (foil) {
      foilStatus.textContent = 'Foil edition'
      foilButton.hidden = true
      return
    }
    foilStatus.textContent = `You have ${shards} shards. Duplicate cards turn into shards.`
    foilButton.disabled = shards < cost
    foilButton.title = shards < cost ? `Needs ${cost} shards` : ''
  }
  foilButton.addEventListener('click', async () => {
    foilButton.disabled = true
    try {
      const res = await upgradeFoil(card.id)
      shards = res.shards
      face.el.classList.add('is-foil')
      renderFoil(true)
      opts.onFoil?.(res.shards)
      opts.onCue?.('confirm')
    } catch (err) {
      foilStatus.textContent = (err as Error).message
      foilButton.disabled = false
      opts.onCue?.('deny')
    }
  })
  renderFoil(card.foil)

  const closeButton = h('button', { type: 'button', class: 'ghost-button' }, 'Close')
  const dialog = h(
    'dialog',
    { class: 'settings-dialog mx-detail', 'aria-label': card.title },
    h('header', null, h('h2', null, card.title), closeButton),
    h(
      'div',
      { class: 'mx-detail-body' },
      h('div', { class: 'mx-detail-card' }, face.el, h('p', { class: 'mx-detail-hint' }, 'Tap the card for a fact')),
      h(
        'div',
        { class: 'mx-detail-info' },
        h('p', { class: 'mx-detail-meta' }, `${RARITY_LABEL[card.rarity]} · ${SET_LABEL[card.set]} · owned ×${card.count}`),
        quiz,
        locked,
        facts,
        h('section', { class: 'mx-foil' }, foilStatus, foilButton),
      ),
    ),
  ) as HTMLDialogElement
  closeButton.addEventListener('click', () => dialog.close())
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close()
  })
  dialog.addEventListener('close', () => {
    opts.onCue?.('close')
    dialog.remove()
  })
  opts.host.appendChild(dialog)
  dialog.showModal()
  opts.onCue?.('open')
  return dialog
}
