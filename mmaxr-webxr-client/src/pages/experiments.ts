import type { LessonSummary } from '@mmaxr/schema'
import { createSoundToggle, departOut, ease, revealIn, type CelestialBody, type Orbit, type SoundMood } from '../ambience/index.js'
import { listLessons } from '../services/lessons'
import { ApiError, userAuth } from '../services/userAuth'
import { h } from '../ui/dom'
import { toast } from '../ui/components'
import { go, type Page, type RouteContext } from '../router'
import { getStage } from '../stage/index.js'
import {
  DASHBOARD_MOOD,
  DASHBOARD_PALETTE,
  LOGIN_PALETTE,
  SUBJECT_ORDER,
  lessonPalette,
  planetLook,
  rememberLessonType,
  systemLook,
  type PlanetLook,
} from '../stage/theme.js'
import { transitionFor, viewOf } from '../stage/transitions.js'

/** Labs the WebXR client can run today. Others are listed, but not launchable yet. */
const SUPPORTED = new Set(['chemistry_indicators', 'chemistry_metals', 'biology_digestive_system', 'biology_respiratory_system', 'physics_optics', 'physics_waves_sound', 'physics_mechanics_sandbox', 'physics_electromagnetism', 'physics_circuits', 'physics_simple_machines', 'physics_fundamentals_sandbox', 'science_matter_properties'])

/** The subject a lab belongs to: its `subject` field, or the prefix of its type. */
function subjectOf(lesson: LessonSummary): string {
  const named = lesson.subject?.trim().toLowerCase()
  if (named && SUBJECT_ORDER.some((s) => s.id === named)) return named
  const prefix = lesson.type.split('_')[0]
  return SUBJECT_ORDER.some((s) => s.id === prefix) ? prefix : 'science'
}

interface PlanetEntry {
  lesson: LessonSummary
  look: PlanetLook
  body: CelestialBody
  link: HTMLElement
  mood: SoundMood
}

interface PlanetItem {
  element: HTMLElement
  lesson: LessonSummary
  look: PlanetLook
  anchor: HTMLElement
  link: HTMLElement
}

/**
 * The experiments page as a small universe: each subject is a star system and each lab a planet
 * in orbit. Pointing at a planet recolours the sky and retunes the music.
 */
export function experimentsPage(context: RouteContext): Page {
  const stage = getStage()
  const { cosmos, sound, veil } = stage
  const account = userAuth.current()!
  const username = account.user.username

  const menuToggle = h(
    'button',
    { type: 'button', class: 'menu-toggle', 'aria-label': 'Menu', 'aria-expanded': 'false', 'aria-controls': 'sky-topbar-menu' },
    h('span', { class: 'menu-bar' }),
    h('span', { class: 'menu-bar' }),
    h('span', { class: 'menu-bar' }),
  )
  const soundToggle = createSoundToggle(sound)
  const settingsButton = h('button', { type: 'button', class: 'ghost-button' }, 'Settings')
  const signOutButton = h('button', { type: 'button', class: 'ghost-button' }, 'Sign out')
  const topbar = h(
    'header',
    { class: 'sky-topbar' },
    h('div', { class: 'sky-brand' }, h('span', { class: 'shell-mark', 'aria-hidden': 'true' }, 'M'), h('span', null, 'MMAXR Lab')),
    menuToggle,
    h(
      'div',
      { id: 'sky-topbar-menu', class: 'topbar-actions' },
      h('span', { class: 'user-chip' }, h('span', { class: 'sky-avatar', 'aria-hidden': 'true' }, username.slice(0, 1).toUpperCase()), h('span', { class: 'user-name' }, username)),
      soundToggle.element,
      settingsButton,
      signOutButton,
    ),
  )
  const welcome = h(
    'section',
    { class: 'welcome' },
    h('p', { class: 'shell-eyebrow' }, 'YOUR UNIVERSE'),
    h('h1', { id: 'dashboard-title' }, `Hi, ${username}`),
    h('p', { class: 'lede' }, 'Choose a planet to start an experiment. You will predict, test and explain: how you think matters more than the final answer.'),
  )
  const status = h('div', { class: 'galaxy-status', role: 'status' })
  const galaxy = h('div', { class: 'galaxy' })
  const main = h('main', { class: 'dashboard-main', 'aria-labelledby': 'dashboard-title' }, welcome, status, galaxy)
  const settings = buildSettingsDialog(() => soundToggle.sync())
  const el = h('div', { class: 'dashboard' }, topbar, main, settings.dialog)

  const planets = new Map<string, PlanetEntry>()
  const stars: CelestialBody[] = []
  const orbits: Orbit[] = []
  const planetListeners: (() => void)[] = []
  let destroyed = false
  let ready = false
  let pendingSurface: string | null = null

  // Navigation is carried by colour and sound: the focused planet tints the nebula and the pad
  // glides to its subject's chord; leaving it glides back.
  let focusedId: string | null = null
  let unfocusTimer = 0
  const focusPlanet = (id: string) => {
    window.clearTimeout(unfocusTimer)
    if (focusedId === id) return
    if (focusedId) planets.get(focusedId)?.body.setHighlight(false)
    focusedId = id
    const entry = planets.get(id)
    if (!entry) return
    entry.body.setHighlight(true)
    cosmos.focus(entry.body)
    cosmos.setPalette(entry.look.palette, stage.time(900))
    sound.setMood(entry.mood, 1.6)
    const rect = entry.link.getBoundingClientRect()
    const pan = ((rect.left + rect.width / 2) / Math.max(1, window.innerWidth)) * 1.4 - 0.7
    sound.cue('hover', { midi: entry.look.note, pan })
  }
  const unfocusPlanet = () => {
    window.clearTimeout(unfocusTimer)
    unfocusTimer = window.setTimeout(() => {
      if (!focusedId) return
      planets.get(focusedId)?.body.setHighlight(false)
      focusedId = null
      cosmos.focus(null)
      cosmos.setPalette(DASHBOARD_PALETTE, stage.time(1300))
      sound.setMood(DASHBOARD_MOOD, 2.4)
    }, 160)
  }

  const renderPlanet = (lesson: LessonSummary): PlanetItem => {
    const look = planetLook(lesson.type)
    const launchable = SUPPORTED.has(lesson.type)
    const anchor = h('span', { class: 'planet-anchor', 'aria-hidden': 'true' })
    const meta = h(
      'span',
      { class: 'card-meta' },
      lesson.durationMinutes ? h('span', { class: 'sky-badge' }, `${lesson.durationMinutes} min`) : null,
      lesson.difficulty ? h('span', { class: 'sky-badge' }, lesson.difficulty) : null,
      launchable ? null : h('span', { class: 'sky-badge status-draft' }, 'Coming soon'),
    )
    const link = launchable
      ? h(
          'a',
          { class: 'planet-link', href: `#/lab/${encodeURIComponent(lesson.lessonId)}`, 'aria-label': `Open ${lesson.title}`, title: lesson.summary ?? undefined },
          anchor,
          h('h3', { class: 'planet-name' }, lesson.title),
          meta,
          h('span', { class: 'planet-cta', 'aria-hidden': 'true' }, 'Open'),
        )
      : h(
          'div',
          { class: 'planet-link is-locked', tabindex: '0', 'aria-label': `${lesson.title} (coming soon)`, title: lesson.summary ?? undefined },
          anchor,
          h('h3', { class: 'planet-name' }, lesson.title),
          meta,
        )
    const element = h('li', { class: 'experiment-card planet', 'data-experiment': lesson.lessonId }, link)
    element.style.setProperty('--planet-size', `${look.size}px`)
    element.style.setProperty('--planet-a', look.planet.colors[0])
    element.style.setProperty('--planet-b', look.planet.colors[1])
    element.style.setProperty('--planet-c', look.planet.colors[2])
    element.style.setProperty('--planet-atmosphere', look.planet.atmosphere)
    return { element, lesson, look, anchor, link }
  }

  const renderSystems = (lessons: LessonSummary[]) => {
    const sections = SUBJECT_ORDER.map((subject) => ({
      subject,
      lessons: lessons
        .filter((lesson) => subjectOf(lesson) === subject.id)
        .sort((a, b) => Number(SUPPORTED.has(b.type)) - Number(SUPPORTED.has(a.type))),
    })).filter((section) => section.lessons.length > 0)

    const systems = sections.map(({ subject, lessons: own }) => {
      const look = systemLook(subject.id)
      const headingId = `subject-${subject.id}`
      const starAnchor = h('div', { class: 'system-star', 'aria-hidden': 'true' })
      starAnchor.style.setProperty('--star-size', `${look.size}px`)
      starAnchor.style.setProperty('--star-core', look.star.core)
      starAnchor.style.setProperty('--star-edge', look.star.edge)
      const items = own.map(renderPlanet)
      const element = h(
        'section',
        { class: `system${own.length > 3 ? ' is-wide' : ''}`, 'aria-labelledby': headingId, 'data-subject': subject.id },
        starAnchor,
        h('h2', { id: headingId }, subject.label),
        h('p', { class: 'system-count' }, `${own.length} ${own.length === 1 ? 'experiment' : 'experiments'}`),
        h('ul', { class: 'experiment-list' }, ...items.map((item) => item.element)),
      )
      element.style.setProperty('--system-accent', look.accent)
      return { element, look, items, starAnchor }
    })
    galaxy.replaceChildren(...systems.map((system) => system.element))

    // Build the sky behind the DOM: stars first, so planets can take their light from them.
    for (const system of systems) {
      const star = cosmos.addStar(system.look.star)
      star.anchorTo(system.starAnchor)
      stars.push(star)
      system.items.forEach((item, index) => {
        const body = cosmos.addPlanet({ ...item.look.planet, lightFrom: star, lightDepth: 0.55 })
        body.anchorTo(item.anchor)
        orbits.push(cosmos.addOrbit(star, body, { color: system.look.orbitColor, phase: index * 0.37 }))
        rememberLessonType(item.lesson.lessonId, item.lesson.type)
        planets.set(item.lesson.lessonId, { lesson: item.lesson, look: item.look, body, link: item.link, mood: system.look.mood })
        const enter = () => focusPlanet(item.lesson.lessonId)
        const pointerEnter = (event: PointerEvent) => {
          if (event.pointerType !== 'touch') enter()
        }
        item.link.addEventListener('pointerenter', pointerEnter)
        item.link.addEventListener('pointerleave', unfocusPlanet)
        item.link.addEventListener('focus', enter)
        item.link.addEventListener('blur', unfocusPlanet)
        planetListeners.push(() => {
          item.link.removeEventListener('pointerenter', pointerEnter)
          item.link.removeEventListener('pointerleave', unfocusPlanet)
          item.link.removeEventListener('focus', enter)
          item.link.removeEventListener('blur', unfocusPlanet)
        })
      })
    }
    ready = true
    void revealIn(systems.map((system) => system.element), { delayMs: 80, staggerMs: 90, reducedMotion: stage.reducedMotion })
    if (pendingSurface) riseFrom(pendingSurface)
  }

  // Coming back from a lab: rise out of its planet once the planets exist.
  const riseFrom = (lessonId: string) => {
    pendingSurface = null
    const from = planets.get(lessonId)
    if (!from || stage.reducedMotion) {
      cosmos.setPalette(DASHBOARD_PALETTE, stage.time(900))
      void veil.hide(stage.time(500))
      return
    }
    from.body.setTravel(1)
    cosmos.focus(from.body)
    void cosmos.warpTo(0.3, 0).then(() => cosmos.warpTo(0, 1600, ease.outCubic))
    sound.sweep('rise', 1.3)
    void veil.hide(650)
    void from.body.travel(0, 1500).then(() => {
      if (!focusedId) cosmos.focus(null)
      cosmos.setPalette(DASHBOARD_PALETTE, 1400)
    })
  }

  const load = async () => {
    status.replaceChildren(h('p', { class: 'galaxy-loading' }, 'Charting the experiments…'))
    try {
      const lessons = await listLessons()
      if (destroyed) return
      status.replaceChildren()
      if (!lessons.length) status.append(h('p', { class: 'galaxy-loading' }, 'No experiments are published yet.'))
      renderSystems(lessons)
    } catch (err) {
      if (destroyed) return
      if (pendingSurface) void veil.hide(stage.time(400))
      pendingSurface = null
      const retry = h('button', { type: 'button', class: 'ghost-button', onclick: () => void load() }, 'Try again')
      status.replaceChildren(h('p', { class: 'form-error' }, `${(err as Error).message}. Make sure the lesson service is running.`), retry)
      sound.cue('deny')
    }
  }

  // On phones the options sit in a dropdown opened by the menu button.
  const setMenuOpen = (open: boolean) => {
    if (topbar.classList.contains('is-menu-open') === open) return
    topbar.classList.toggle('is-menu-open', open)
    menuToggle.setAttribute('aria-expanded', String(open))
    sound.cue(open ? 'open' : 'close')
  }
  const onDocumentClick = (event: MouseEvent) => {
    if (topbar.classList.contains('is-menu-open') && !topbar.contains(event.target as Node)) setMenuOpen(false)
  }
  const onDocumentKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && topbar.classList.contains('is-menu-open')) {
      setMenuOpen(false)
      menuToggle.focus()
    }
  }
  menuToggle.addEventListener('click', () => setMenuOpen(!topbar.classList.contains('is-menu-open')))
  settingsButton.addEventListener('click', () => {
    setMenuOpen(false)
    settings.open()
  })
  signOutButton.addEventListener('click', () => {
    setMenuOpen(false)
    userAuth.clear()
    go('/login')
  })

  return {
    el,
    mounted() {
      stage.setCosmic(true)
      document.addEventListener('click', onDocumentClick)
      document.addEventListener('keydown', onDocumentKeydown)
      const entry = transitionFor(viewOf(context.from), { name: 'dashboard' })
      sound.setMood(DASHBOARD_MOOD, 2.4)
      const intro = [topbar, welcome, status]
      switch (entry.kind) {
        case 'launch':
          cosmos.setPalette(DASHBOARD_PALETTE, stage.time(1200))
          void cosmos.warpTo(0, stage.time(1700), ease.outCubic)
          sound.arrive()
          void revealIn(intro, { delayMs: 420, staggerMs: 110, reducedMotion: stage.reducedMotion })
          break
        case 'surface':
          pendingSurface = entry.experimentId
          sound.setBedLevel(1, 2.6)
          cosmos.setPalette(lessonPalette(entry.experimentId), 0)
          void revealIn(intro, { delayMs: stage.reducedMotion ? 0 : 700, staggerMs: 80, reducedMotion: stage.reducedMotion })
          break
        default:
          cosmos.setPalette(DASHBOARD_PALETTE, entry.kind === 'open' ? 0 : stage.time(900))
          sound.setBedLevel(1, 2)
          if (veil.showing) void veil.hide(stage.time(entry.kind === 'open' ? 1400 : 500))
          void revealIn(intro, { delayMs: entry.kind === 'open' ? 300 : 120, staggerMs: 90, reducedMotion: stage.reducedMotion })
      }
      void load()
    },
    async leave(to) {
      window.clearTimeout(unfocusTimer)
      setMenuOpen(false)
      const exit = transitionFor({ name: 'dashboard' }, viewOf(to) ?? { name: 'other' })
      if (exit.kind === 'dive') {
        const target = planets.get(exit.experimentId)
        const palette = target?.look.palette ?? DASHBOARD_PALETTE
        veil.setLabel(`Opening ${target?.lesson.title ?? 'experiment'}`)
        sound.setBedLevel(0, 2.2)
        if (target && ready && !stage.reducedMotion) {
          // Fall into the planet: the page dissolves, the planet swells to fill the sky.
          sound.cue('select', { midi: target.look.note })
          sound.sweep('dive', 1.35)
          cosmos.focus(target.body)
          cosmos.setPalette(palette, 900)
          for (const [id, other] of planets) if (id !== exit.experimentId) other.body.setHighlight(false)
          target.body.setHighlight(true)
          const veilDelay = window.setTimeout(() => void veil.show(palette, 520), 980)
          await Promise.all([
            target.body.travel(1, 1450),
            cosmos.warpTo(0.32, 1300, ease.inCubic),
            departOut(main, { scale: 0.97, lift: 0, durationMs: 520 }),
            departOut(topbar, { lift: -10, durationMs: 420 }),
          ])
          window.clearTimeout(veilDelay)
          await veil.show(palette, 260)
          return
        }
        await veil.show(palette, stage.time(420))
        return
      }
      if (exit.kind === 'depart') {
        sound.sweep('warp', 0.75)
        cosmos.setPalette(LOGIN_PALETTE, stage.time(1200))
        await Promise.all([
          cosmos.warpTo(0.7, stage.time(750), ease.inCubic),
          departOut(main, { scale: 0.94, durationMs: 520, reducedMotion: stage.reducedMotion }),
          departOut(topbar, { durationMs: 420, reducedMotion: stage.reducedMotion }),
        ])
        return
      }
      await departOut(main, { reducedMotion: stage.reducedMotion })
    },
    destroy() {
      destroyed = true
      window.clearTimeout(unfocusTimer)
      for (const remove of planetListeners) remove()
      document.removeEventListener('click', onDocumentClick)
      document.removeEventListener('keydown', onDocumentKeydown)
      settings.dispose()
      soundToggle.dispose()
      cosmos.focus(null)
      for (const orbit of orbits) orbit.remove()
      for (const { body } of planets.values()) body.remove()
      for (const star of stars) star.remove()
    },
  }
}

/** Account settings in the cosmic style: sound, sign out and deleting the account. */
function buildSettingsDialog(onSoundChanged: () => void) {
  const { sound } = getStage()
  const soundToggle = createSoundToggle(sound, 'sound-toggle is-wide')
  const close = h('button', { type: 'button', class: 'ghost-button' }, 'Close')
  const signOut = h('button', { type: 'button', class: 'ghost-button' }, 'Sign out')
  const password = h('input', { id: 'settings-password', type: 'password', autocomplete: 'current-password', 'aria-describedby': 'settings-status' }) as HTMLInputElement
  const status = h('p', { id: 'settings-status', class: 'form-error', role: 'status' })
  const remove = h('button', { type: 'submit', class: 'danger-button' }, 'Delete account')
  const deleteForm = h(
    'form',
    { class: 'settings-form', novalidate: true },
    h('label', { for: 'settings-password' }, 'Confirm with your password'),
    password,
    status,
    remove,
  )
  const dialog = h(
    'dialog',
    { class: 'settings-dialog', 'aria-labelledby': 'settings-title' },
    h('header', null, h('h2', { id: 'settings-title' }, 'Settings'), close),
    h(
      'section',
      { class: 'settings-info' },
      h('h3', null, 'Space sounds'),
      h('div', { class: 'settings-row' }, h('p', null, 'Music and sound effects on this screen.'), soundToggle.element),
      h('h3', null, 'Motion'),
      h('p', null, "Animations follow your device's reduce-motion setting."),
      h('h3', null, 'Delete your account'),
      h('p', null, 'This permanently removes your account and sign-in. Lab records are kept under an anonymous ID that can no longer be traced to you.'),
    ),
    deleteForm,
    h('footer', null, signOut),
  ) as HTMLDialogElement

  deleteForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    status.textContent = ''
    if (!password.value) {
      status.textContent = 'Enter your password to confirm.'
      sound.cue('deny')
      return
    }
    remove.disabled = true
    try {
      await userAuth.deleteAccount(password.value)
      dialog.close()
      toast('Your account was deleted.')
      go('/login')
    } catch (err) {
      status.textContent = err instanceof ApiError && err.status === 401 ? 'That password is not correct.' : (err as Error).message
      sound.cue('deny')
    } finally {
      remove.disabled = false
    }
  })
  close.addEventListener('click', () => dialog.close())
  signOut.addEventListener('click', () => {
    dialog.close()
    userAuth.clear()
    go('/login')
  })
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close()
  })
  dialog.addEventListener('close', () => {
    sound.cue('close')
    onSoundChanged()
  })

  return {
    dialog,
    open() {
      password.value = ''
      status.textContent = ''
      soundToggle.sync()
      dialog.showModal()
      sound.cue('open')
    },
    dispose() {
      soundToggle.dispose()
      if (dialog.open) dialog.close()
    },
  }
}
