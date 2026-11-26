import type { RewardPack } from '@mmaxr/schema'
import { go } from '../router'
import { listPacks, packStore } from '../services/rewards'
import { h } from '../ui/dom'
import { sealedPack } from './cardFace'
import { lessonTitle, loadLessonTitles } from './lessonTitles'
import { packPerks, tierLabel } from './rarity'

const ago = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}

/**
 * The "Packs" button for the top bar of the experiments page, with a count of unopened packs and a panel that
 * lists them. Returns the button and a dispose function.
 */
export function packsButton(onCue?: (cue: 'open' | 'close' | 'select') => void) {
  const count = h('span', { class: 'mx-count', hidden: true })
  const button = h('button', { type: 'button', class: 'ghost-button mx-packs-button', 'aria-haspopup': 'dialog' }, h('span', { class: 'mx-packs-icon', 'aria-hidden': 'true' }), 'Packs', count)
  const list = h('ul', { class: 'mx-pack-list' })
  const empty = h('p', { class: 'mx-empty' }, 'No packs waiting. Finish a lab to earn one.')
  const closeButton = h('button', { type: 'button', class: 'ghost-button', 'aria-label': 'Close' }, 'Close')
  const dialog = h(
    'dialog',
    { class: 'settings-dialog mx-drawer', 'aria-labelledby': 'mx-drawer-title' },
    h('header', null, h('h2', { id: 'mx-drawer-title' }, 'Card packs'), closeButton),
    h('p', { class: 'mx-drawer-lede' }, 'You earn a pack each time you finish a lab. Open them whenever you like.'),
    list,
    empty,
  ) as HTMLDialogElement

  const unsubscribe = packStore.subscribe((n) => {
    count.hidden = n === 0
    count.textContent = String(n)
    button.setAttribute('aria-label', n ? `Packs, ${n} unopened` : 'Packs')
    button.classList.toggle('has-packs', n > 0)
  })

  const row = (p: RewardPack) => {
    const open = h('button', { type: 'button', class: 'mx-btn mx-btn-primary mx-btn-sm' }, 'Open')
    open.addEventListener('click', () => {
      onCue?.('select')
      dialog.close()
      go(`/packs/${p.id}`)
    })
    const perks = packPerks(p)
    return h(
      'li',
      { class: 'mx-pack-row', 'data-tier': p.tier },
      h('div', { class: 'mx-pack-row-art' }, sealedPack(p.tier, String(p.cardCount))),
      h(
        'div',
        { class: 'mx-pack-row-body' },
        h('p', { class: 'mx-pack-row-title' }, tierLabel(p)),
        h('p', { class: 'mx-pack-row-sub' }, `${lessonTitle(p.lessonId)} · ${p.cardCount} cards · ${ago(p.createdAt)}`),
        perks.length ? h('p', { class: 'mx-pack-row-perks' }, perks.join(' · ')) : null,
      ),
      open,
    )
  }

  const render = async () => {
    list.replaceChildren(h('li', { class: 'mx-empty' }, 'Loading…'))
    empty.hidden = true
    try {
      const [{ packs }] = await Promise.all([listPacks(true), loadLessonTitles()])
      packStore.set(packs.length)
      list.replaceChildren(...packs.map(row))
      empty.hidden = packs.length > 0
    } catch (err) {
      list.replaceChildren(h('li', { class: 'mx-empty' }, (err as Error).message))
    }
  }

  button.addEventListener('click', () => {
    void render()
    dialog.showModal()
    onCue?.('open')
  })
  closeButton.addEventListener('click', () => dialog.close())
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close()
  })
  dialog.addEventListener('close', () => onCue?.('close'))
  void packStore.refresh()

  return {
    button,
    dialog,
    dispose() {
      unsubscribe()
      if (dialog.open) dialog.close()
    },
  }
}
