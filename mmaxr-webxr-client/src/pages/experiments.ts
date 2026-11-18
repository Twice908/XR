import type { LessonSummary } from '@mmaxr/schema'
import { listLessons } from '../services/lessons'
import { ApiError, userAuth } from '../services/userAuth'
import { h } from '../ui/dom'
import { badge, banner, brand, button, dialog, field, setLoading, toast } from '../ui/components'
import { go, type Page } from '../router'

/** Labs the WebXR client can run today. Others are listed, but not launchable yet. */
const SUPPORTED = new Set(['chemistry_indicators'])

export function experimentsPage(): Page {
  const account = userAuth.current()!
  const grid = h('div', { class: 'grid-cards' })
  const status = h('div')

  const menuList = h('div', { class: 'menu-list', hidden: true, role: 'menu' })
  const avatar = h('button', { class: 'avatar', type: 'button', 'aria-label': 'Account menu', 'aria-haspopup': 'menu' }, account.user.username.slice(0, 1).toUpperCase())
  const closeMenu = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) menuList.hidden = true
  }
  const menu = h('div', { class: 'menu' }, avatar, menuList)
  avatar.addEventListener('click', () => (menuList.hidden = !menuList.hidden))
  document.addEventListener('click', closeMenu)

  menuList.append(
    h('div', { style: 'padding:8px 12px' }, h('div', { class: 't-label' }, account.user.username), h('div', { class: 't-support' }, 'Student')),
    h('button', { class: 'menu-item', role: 'menuitem', onclick: () => { userAuth.clear(); go('/login') } }, 'Sign out'),
    h('button', { class: 'menu-item danger', role: 'menuitem', onclick: () => { menuList.hidden = true; confirmDelete() } }, 'Delete account…'),
  )

  function confirmDelete() {
    const d = dialog({ title: 'Delete your account?', description: 'This permanently removes your account and sign-in. Lab records are kept under an anonymous ID that can no longer be traced to you.' })
    const pw = field({ label: 'Confirm with your password', name: 'password', type: 'password', autocomplete: 'current-password' })
    const err = h('div')
    const del = button('Delete account', { variant: 'destructive' })
    d.body.append(err, pw.root, h('div', { class: 'dialog-actions' }, button('Cancel', { variant: 'ghost', onClick: d.close }), del))
    del.addEventListener('click', async () => {
      if (del.getAttribute('aria-disabled') === 'true') return
      err.replaceChildren()
      if (!pw.input.value) return pw.setError('Enter your password to confirm')
      setLoading(del, true, 'Delete account')
      try {
        await userAuth.deleteAccount(pw.input.value)
        d.close()
        toast('Your account was deleted.')
        go('/login')
      } catch (e) {
        pw.setError(e instanceof ApiError && e.status === 401 ? 'That password is not correct' : null)
        if (!(e instanceof ApiError && e.status === 401)) err.replaceChildren(banner('error', (e as Error).message))
        setLoading(del, false, 'Delete account')
      }
    })
    queueMicrotask(() => pw.input.focus())
  }

  const card = (l: LessonSummary) => {
    const ready = SUPPORTED.has(l.type)
    const thumb = h('div', { class: `exp-thumb ${l.subject === 'Chemistry' ? 'exp-chem' : 'exp-phys'}`, 'aria-hidden': 'true' }, l.subject === 'Chemistry' ? '🧪' : '⚛️')
    const el = h(
      'button',
      { class: 'card card-clickable', 'aria-disabled': ready ? null : 'true', 'aria-label': `${l.title}${ready ? '' : ' (coming soon)'}`, onclick: () => ready && go(`/lab/${l.lessonId}`) },
      thumb,
      h('div', { class: 'row row-between' }, badge(l.subject ?? 'Experiment', 'info'), ready ? badge(l.difficulty ?? 'Open', 'neutral') : badge('Coming soon', 'warning')),
      h('h3', { class: 't-heading' }, l.title),
      h('p', { class: 't-support' }, l.summary ?? ''),
      h('div', { class: 't-support' }, l.durationMinutes ? `About ${l.durationMinutes} min` : ''),
    )
    return el
  }

  const load = async () => {
    status.replaceChildren(h('div', { class: 'row', style: 'justify-content:center;padding:48px' }, h('span', { class: 'spinner' }), h('span', { class: 't-support' }, 'Loading experiments…')))
    grid.replaceChildren()
    try {
      const lessons = await listLessons()
      status.replaceChildren()
      if (!lessons.length) status.append(banner('info', 'No experiments are published yet.'))
      lessons.sort((a, b) => Number(SUPPORTED.has(b.type)) - Number(SUPPORTED.has(a.type)))
      grid.replaceChildren(...lessons.map(card))
    } catch (err) {
      status.replaceChildren(banner('error', `${(err as Error).message}. Make sure the lesson service is running.`), h('div', { style: 'margin-top:12px' }, button('Try again', { onClick: () => void load() })))
    }
  }
  void load()

  const el = h(
    'div',
    null,
    h('header', { class: 'topbar' }, brand(), menu),
    h(
      'main',
      { class: 'page' },
      h('div', { class: 'stack', style: 'gap:6px' }, h('h1', { class: 't-display' }, `Hi, ${account.user.username}`), h('p', { class: 't-support' }, 'Pick an experiment. You will predict, test and explain: how you think matters more than the final answer.')),
      status,
      grid,
    ),
  )
  return { el, destroy: () => document.removeEventListener('click', closeMenu) }
}
