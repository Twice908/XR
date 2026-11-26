import type { OpenPackResponse, RewardPack } from '@mmaxr/schema'
import { departOut, revealIn } from '../ambience/index.js'
import { cardFace, sealedPack, type CardFaceHandle } from '../gamification/cardFace'
import { lessonTitle, loadLessonTitles } from '../gamification/lessonTitles'
import { packPerks, RARITY_LABEL, revealPlan, summarise, tierLabel, type RevealStep } from '../gamification/rarity'
import { go, type Page } from '../router'
import { listPacks, openPack, packStore } from '../services/rewards'
import { getStage } from '../stage/index.js'
import { DASHBOARD_PALETTE } from '../stage/theme.js'
import { h } from '../ui/dom'

const wait = (ms: number) => new Promise<void>((done) => window.setTimeout(done, ms))

const GUARANTEE_NOTE = { mastery: 'Mastery guarantee', pity: 'Lucky-streak guarantee' } as const

/**
 * Opening a card pack, in three beats: anticipation (a sealed pack you choose to open), reveal (cards flip one at a
 * time, rarer cards building longer), celebration (a burst sized to the rarity, then a calm summary). Every beat
 * can be skipped, and reduced motion removes the waiting and the bursts.
 */
export function packOpenPage(packId: string): Page {
  const stage = getStage()
  const { sound } = stage
  const reduced = stage.reducedMotion

  const back = h('button', { type: 'button', class: 'ghost-button' }, '← Labs')
  back.addEventListener('click', () => go('/experiments'))
  const heading = h('h1', { class: 'mx-open-title' }, 'Card pack')
  const sub = h('p', { class: 'mx-open-sub' })
  const header = h('header', { class: 'mx-open-header' }, back, h('div', null, heading, sub))
  const floor = h('div', { class: 'mx-open-floor' })
  const hint = h('p', { class: 'mx-open-hint', 'aria-live': 'polite' })
  const controls = h('div', { class: 'mx-open-controls' })
  const flash = h('div', { class: 'mx-flash', 'aria-hidden': 'true' })
  const el = h('div', { class: 'mx-open', 'data-phase': 'loading' }, header, floor, hint, controls, flash)

  let destroyed = false
  let pack: RewardPack | null = null
  let opened: OpenPackResponse | null = null
  let faces: { step: RevealStep; face: CardFaceHandle }[] = []
  let revealing = false

  const setPhase = (phase: 'loading' | 'sealed' | 'reveal' | 'summary' | 'error') => (el.dataset.phase = phase)

  const fail = (message: string) => {
    setPhase('error')
    hint.textContent = message
    floor.replaceChildren()
    controls.replaceChildren(h('button', { type: 'button', class: 'mx-btn mx-btn-primary', onclick: () => go('/experiments') }, 'Back to labs'))
  }

  // ---------- beat 1: anticipation ----------
  const showSealed = (p: RewardPack) => {
    setPhase('sealed')
    heading.textContent = tierLabel(p)
    sub.textContent = `${lessonTitle(p.lessonId)} · ${p.cardCount} cards`
    const packEl = sealedPack(p.tier, `${p.cardCount} cards`)
    const button = h('button', { type: 'button', class: 'mx-pack-button', 'aria-label': `Open ${tierLabel(p)}` }, packEl)
    const perks = packPerks(p)
    floor.replaceChildren(button, perks.length ? h('div', { class: 'mx-open-perks' }, ...perks.map((x) => h('span', { class: 'mx-chip' }, x))) : '')
    hint.textContent = 'Tap the pack to open it'
    controls.replaceChildren()
    button.addEventListener('click', () => void tear(button), { once: true })
    button.focus({ preventScroll: true })
    sound.cue('open')
  }

  const tear = async (button: HTMLElement) => {
    hint.textContent = 'Opening…'
    sound.cue('select', { midi: 60 })
    button.classList.add('is-tearing')
    try {
      const [res] = await Promise.all([openPack(packId), wait(reduced ? 0 : 650)])
      if (destroyed) return
      opened = res
      if (!res.alreadyOpened) packStore.set(packStore.unopened - 1)
      deal(res, false)
    } catch (err) {
      if (!destroyed) fail((err as Error).message)
    }
  }

  // ---------- beat 2: reveal ----------
  const deal = (res: OpenPackResponse, faceUp: boolean) => {
    setPhase('reveal')
    const steps = revealPlan(res.cards, reduced)
    faces = steps.map((step) => {
      const c = res.cards.find((x) => x.slot === step.slot)!
      const face = cardFace(c.card, { faceDown: !faceUp, isNew: c.isNew, shards: c.shardsAwarded, note: c.guaranteed ? GUARANTEE_NOTE[c.guaranteed] : null })
      face.el.tabIndex = 0
      face.el.addEventListener('click', () => onCardTap(step.slot))
      face.el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onCardTap(step.slot)
        }
      })
      return { step, face }
    })
    const row = h('div', { class: 'mx-card-row', 'data-count': String(faces.length) }, ...faces.map((f) => f.face.el))
    floor.replaceChildren(row)
    void revealIn(faces.map((f) => f.face.el), { delayMs: 60, staggerMs: 110, reducedMotion: reduced })
    if (faceUp) return showSummary()
    hint.textContent = 'Tap each card to turn it over'
    const all = h('button', { type: 'button', class: 'mx-btn mx-btn-ghost' }, 'Reveal all')
    all.addEventListener('click', () => void revealAll())
    controls.replaceChildren(all)
    faces[0]?.face.el.focus({ preventScroll: true })
  }

  const onCardTap = (slot: number) => {
    const f = faces.find((x) => x.step.slot === slot)
    if (!f) return
    if (f.face.isUp) {
      f.face.toggleFact()
      sound.cue('tick')
      return
    }
    void reveal(f)
  }

  const reveal = async (f: { step: RevealStep; face: CardFaceHandle }) => {
    if (f.face.isUp || f.face.el.classList.contains('is-charging')) return
    if (f.step.holdMs) {
      f.face.el.classList.add('is-charging')
      await wait(f.step.holdMs)
      if (destroyed) return
      f.face.el.classList.remove('is-charging')
    }
    f.face.flipUp()
    sound.cue('snap', { midi: f.step.note })
    // ---------- beat 3: celebration, sized to the rarity ----------
    if (f.step.burst >= 2) sound.cue('confirm', { midi: f.step.note })
    if (!reduced && f.step.burst > 0) {
      f.face.el.classList.add(`burst-${f.step.burst}`)
      if (f.step.burst === 3) {
        flash.classList.remove('is-on')
        void flash.offsetWidth
        flash.classList.add('is-on')
      }
    }
    hint.textContent = `${RARITY_LABEL[f.step.rarity]}! Tap it again for a fact`
    if (faces.every((x) => x.face.isUp)) {
      await wait(reduced ? 0 : 700)
      if (!destroyed) showSummary()
    }
  }

  const revealAll = async () => {
    if (revealing) return
    revealing = true
    for (const f of faces) {
      if (destroyed) return
      if (!f.face.isUp) await reveal(f)
      await wait(reduced ? 0 : 180)
    }
  }

  const showSummary = async () => {
    if (!opened || el.dataset.phase === 'summary') return
    setPhase('summary')
    const s = summarise(opened.cards)
    hint.textContent = 'Tap any card for a fact'
    sound.cue('place')
    const stats = h(
      'div',
      { class: 'mx-summary', role: 'status' },
      h('div', { class: 'mx-stat' }, h('strong', null, String(s.newCards)), h('span', null, s.newCards === 1 ? 'new card' : 'new cards')),
      h('div', { class: 'mx-stat' }, h('strong', null, RARITY_LABEL[s.best]), h('span', null, 'best pull')),
      h('div', { class: 'mx-stat' }, h('strong', null, `+${s.shards}`), h('span', null, 'shards')),
    )
    const done = h('button', { type: 'button', class: 'mx-btn mx-btn-ghost' }, 'Back to labs')
    done.addEventListener('click', () => go('/experiments'))
    controls.replaceChildren(stats, h('div', { class: 'mx-open-actions' }, done))
    try {
      const { packs } = await listPacks(true)
      packStore.set(packs.length)
      const next = packs.find((p) => p.id !== packId)
      if (next && !destroyed) {
        const more = h('button', { type: 'button', class: 'mx-btn mx-btn-primary' }, `Open next pack (${packs.length})`)
        more.addEventListener('click', () => go(`/packs/${next.id}`))
        controls.querySelector('.mx-open-actions')?.append(more)
      }
    } catch {
      /* no next-pack button */
    }
  }

  const onKey = (e: KeyboardEvent) => {
    if (el.dataset.phase !== 'reveal' || (e.key !== 'ArrowRight' && e.key !== 'n')) return
    const next = faces.find((f) => !f.face.isUp)
    if (next) void reveal(next)
  }

  const load = async () => {
    try {
      const [{ packs }] = await Promise.all([listPacks(), loadLessonTitles()])
      if (destroyed) return
      pack = packs.find((p) => p.id === packId) ?? null
      if (!pack) return fail('This pack could not be found.')
      if (pack.openedAt) {
        // Opened before: show its cards face up straight away.
        heading.textContent = tierLabel(pack)
        sub.textContent = `${lessonTitle(pack.lessonId)} · opened`
        opened = await openPack(packId)
        if (!destroyed) deal(opened, true)
        return
      }
      showSealed(pack)
    } catch (err) {
      if (!destroyed) fail((err as Error).message)
    }
  }

  return {
    el,
    mounted() {
      stage.setCosmic(true)
      stage.setQuiet(false)
      stage.cosmos.setPalette(DASHBOARD_PALETTE, stage.time(900))
      if (stage.veil.showing) void stage.veil.hide(stage.time(500))
      document.addEventListener('keydown', onKey)
      void load()
    },
    async leave() {
      await departOut(el, { lift: 0, scale: 0.98, durationMs: 320, reducedMotion: reduced })
    },
    destroy() {
      destroyed = true
      document.removeEventListener('keydown', onKey)
    },
  }
}
