import type { OpenPackResponse, RewardPack } from '@mmaxr/schema'
import { departOut, revealIn } from '../ambience/index.js'
import { cardFace, sealedPack, type CardFaceHandle } from '../gamification/cardFace'
import { Splash, SPLASH_COLORS } from '../gamification/splash'
import { lessonTitle, loadLessonTitles } from '../gamification/lessonTitles'
import { packPerks, RARITY_LABEL, RARITY_RANK, revealPlan, summarise, tierLabel, type RevealStep } from '../gamification/rarity'
import { go, type Page } from '../router'
import { listPacks, openPack, packStore } from '../services/rewards'
import { getStage } from '../stage/index.js'
import { DASHBOARD_PALETTE } from '../stage/theme.js'
import { h } from '../ui/dom'

const wait = (ms: number) => new Promise<void>((done) => window.setTimeout(done, ms))

const GUARANTEE_NOTE = { mastery: 'Mastery guarantee', pity: 'Lucky-streak guarantee' } as const

const TIER_COLORS: Record<string, string[]> = {
  standard: ['#a99cff', '#8b38d6', '#ffffff', '#5fe1ff'],
  mastery: ['#ffc44d', '#ffe08a', '#ffffff', '#ff9f43'],
  weekly: ['#5fe1ff', '#7fe6b5', '#ffffff', '#4ea1ff'],
}

/** How hard each rarity celebrates: extra half-turns in the flip, how high the card pops, and the splash. */
const FLIP = [
  { turns: 0, ms: 720, pop: 1.12, lift: 18, count: 40, power: 520, sparkle: 0.7 },
  { turns: 1, ms: 1000, pop: 1.22, lift: 34, count: 90, power: 720, sparkle: 0.45 },
  { turns: 2, ms: 1250, pop: 1.32, lift: 50, count: 150, power: 900, sparkle: 0.4 },
  { turns: 3, ms: 1650, pop: 1.42, lift: 64, count: 220, power: 1100, sparkle: 0.35 },
] as const

const center = (el: Element) => {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

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
  const splash = reduced ? null : new Splash(el)
  let packCenter: { x: number; y: number } | null = null

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
    packCenter = center(button)
    try {
      const [res] = await Promise.all([openPack(packId), wait(reduced ? 0 : 650)])
      if (destroyed) return
      // The pack bursts open in its tier colour.
      if (splash && packCenter) {
        splash.burst(packCenter.x, packCenter.y, { colors: TIER_COLORS[pack?.tier ?? 'standard'] ?? TIER_COLORS.standard, count: 110, power: 900, sparkle: 0.75, lift: 0.1 })
        flashOnce('pack')
      }
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
      const face = cardFace(c.card, { faceDown: !faceUp, isNew: c.isNew, shards: c.shardsAwarded, note: c.guaranteed ? GUARANTEE_NOTE[c.guaranteed] : null, displayWidth: 240, tilt: true })
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
    if (faceUp || reduced || !packCenter) void revealIn(faces.map((f) => f.face.el), { delayMs: 60, staggerMs: 110, reducedMotion: reduced })
    else dealFrom(packCenter)
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

  /** Cards fly out of the torn pack in a fan, tumbling in 3D before they land in their slots. */
  const dealFrom = (from: { x: number; y: number }) => {
    faces.forEach(({ face }, i) => {
      const to = center(face.el)
      const dx = from.x - to.x
      const dy = from.y - to.y
      const spin = (i - (faces.length - 1) / 2) * 14
      face.el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) rotateX(70deg) rotateZ(${spin * 2}deg) scale(0.3)`, opacity: 0 },
          { opacity: 1, offset: 0.25 },
          { transform: `translate(${dx * 0.3}px, ${dy * 0.3 - 80}px) rotateX(-20deg) rotateZ(${-spin}deg) scale(1.08)`, offset: 0.6 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: 760, delay: 80 + i * 120, easing: 'cubic-bezier(0.2, 0.8, 0.25, 1)', fill: 'backwards' },
      )
    })
  }

  const flashOnce = (kind: 'pack' | 'legendary' | 'epic') => {
    flash.dataset.kind = kind
    flash.classList.remove('is-on')
    void flash.offsetWidth
    flash.classList.add('is-on')
  }

  const shake = (strength: number) => {
    el.style.setProperty('--shake', `${strength}px`)
    el.classList.remove('is-shaking')
    void el.offsetWidth
    el.classList.add('is-shaking')
  }

  const reveal = async (f: { step: RevealStep; face: CardFaceHandle }) => {
    if (f.face.isUp || f.face.el.classList.contains('is-charging')) return
    const rank = RARITY_RANK[f.step.rarity]
    const cfg = FLIP[rank]
    // ---------- anticipation: the card lifts, trembles and its edge warms to the rarity colour ----------
    if (f.step.holdMs) {
      f.face.el.classList.add('is-charging')
      if (rank >= 2 && !reduced) el.classList.add('is-dimmed')
      await wait(f.step.holdMs)
      if (destroyed) return
      f.face.el.classList.remove('is-charging')
    }
    f.face.flipUp()
    sound.cue('snap', { midi: f.step.note })
    if (reduced) {
      el.classList.remove('is-dimmed')
      return afterReveal(f)
    }
    // ---------- the flip: rarer cards spin more turns and pop higher toward you ----------
    f.face.el.classList.add('is-popping')
    // From face down (180deg) to face up (any multiple of 360deg): half a turn plus a full turn per extra spin.
    const spinTo = -360 * cfg.turns
    f.face.inner.animate(
      [
        { transform: 'rotateY(180deg)' },
        { transform: `rotateY(${(180 + spinTo) / 2}deg) rotateX(12deg)`, offset: 0.55 },
        { transform: `rotateY(${spinTo}deg)` },
      ],
      { duration: cfg.ms, easing: 'cubic-bezier(0.3, 0.6, 0.2, 1)' },
    )
    const pop = f.face.el.animate(
      [
        { transform: 'none' },
        { transform: `translateY(${-cfg.lift}px) translateZ(80px) scale(${cfg.pop})`, offset: 0.45 },
        { transform: `translateY(${-cfg.lift * 0.4}px) scale(${cfg.pop * 0.96})`, offset: 0.7 },
        { transform: 'scale(0.97)', offset: 0.86 },
        { transform: 'none' },
      ],
      { duration: cfg.ms + 380, easing: 'cubic-bezier(0.25, 0.9, 0.3, 1)' },
    )
    // ---------- celebration, sized to the rarity, as the face lands ----------
    await wait(cfg.ms * 0.55)
    if (destroyed) return
    el.classList.remove('is-dimmed')
    if (f.step.burst >= 2) sound.cue('confirm', { midi: f.step.note })
    f.face.el.classList.add(`burst-${Math.max(1, f.step.burst)}`)
    callout(f)
    if (splash) {
      const c = center(f.face.el)
      splash.burst(c.x, c.y, { colors: [...SPLASH_COLORS[f.step.rarity]], count: cfg.count, power: cfg.power, sparkle: cfg.sparkle, lift: 0.35 })
      if (rank >= 2) window.setTimeout(() => !destroyed && splash.burst(c.x, c.y - 40, { colors: [...SPLASH_COLORS[f.step.rarity]], count: cfg.count / 2, power: cfg.power * 0.6, sparkle: 0.8, lift: 0.6 }), 220)
      if (rank === 3) splash.rain([...SPLASH_COLORS.legendary], 140, 1.6)
    }
    if (rank >= 2) {
      flashOnce(rank === 3 ? 'legendary' : 'epic')
      shake(rank === 3 ? 10 : 5)
    }
    await pop.finished.catch(() => undefined)
    f.face.el.classList.remove('is-popping')
    afterReveal(f)
  }

  /** A word that bursts up out of rare-or-better cards: "Rare!", "Epic!", "Legendary!" */
  const callout = (f: { step: RevealStep; face: CardFaceHandle }) => {
    if (RARITY_RANK[f.step.rarity] === 0) return
    const word = h('span', { class: 'mx-callout', 'aria-hidden': 'true' }, `${RARITY_LABEL[f.step.rarity]}!`)
    f.face.el.append(word)
    word.addEventListener('animationend', () => word.remove(), { once: true })
  }

  const afterReveal = async (f: { step: RevealStep; face: CardFaceHandle }) => {
    hint.textContent = `${RARITY_LABEL[f.step.rarity]}! Tap it again to turn it over`
    if (faces.every((x) => x.face.isUp)) {
      await wait(reduced ? 0 : 900)
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
    hint.textContent = 'Tap any card to turn it over'
    sound.cue('place')
    if (splash && faces.length && RARITY_RANK[s.best] >= 1) splash.rain([...SPLASH_COLORS[s.best]], 60 + 40 * RARITY_RANK[s.best], 1.4)
    const stats = h(
      'div',
      { class: 'mx-summary', role: 'status' },
      h('div', { class: 'mx-stat' }, h('strong', null, String(s.newCards)), h('span', null, s.newCards === 1 ? 'new card' : 'new cards')),
      h('div', { class: 'mx-stat' }, h('strong', null, RARITY_LABEL[s.best]), h('span', null, 'best pull')),
      h('div', { class: 'mx-stat' }, h('strong', null, `+${s.shards}`), h('span', null, 'shards')),
    )
    const done = h('button', { type: 'button', class: 'mx-btn mx-btn-ghost' }, 'Back to labs')
    done.addEventListener('click', () => go('/experiments'))
    const book = h('button', { type: 'button', class: 'mx-btn mx-btn-ghost' }, 'View collection')
    book.addEventListener('click', () => go('/collection'))
    controls.replaceChildren(stats, h('div', { class: 'mx-open-actions' }, done, book))
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
      splash?.destroy()
    },
  }
}
