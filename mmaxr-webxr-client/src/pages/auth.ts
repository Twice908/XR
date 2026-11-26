import { createSoundToggle, departOut, ease, revealIn, shake, type CelestialBody } from '../ambience/index.js'
import { ApiError, userAuth } from '../services/userAuth'
import { h } from '../ui/dom'
import { toast } from '../ui/components'
import { go, type Page, type RouteContext } from '../router'
import { getStage } from '../stage/index.js'
import { DASHBOARD_PALETTE, DENY_PALETTE, LOGIN_HORIZON, LOGIN_MOOD, LOGIN_PALETTE, LOGIN_SUN } from '../stage/theme.js'
import { transitionFor, viewOf } from '../stage/transitions.js'

/** A labelled input in the cosmic style. */
interface SkyField {
  root: HTMLElement
  input: HTMLInputElement
  setInvalid(invalid: boolean): void
}

let fieldCount = 0

function skyField(label: string, attrs: Record<string, string | boolean>, hint?: string, extra?: HTMLElement): SkyField {
  const id = `sky-field-${++fieldCount}`
  const hintId = hint ? `${id}-hint` : undefined
  const input = h('input', { id, spellcheck: 'false', ...attrs, 'aria-describedby': hintId }) as HTMLInputElement
  const root = h(
    'div',
    { class: 'sky-field' },
    h('label', { for: id }, label),
    extra ? h('div', { class: 'code-row' }, input, extra) : input,
    hint ? h('p', { id: hintId, class: 'field-hint' }, hint) : null,
  )
  return {
    root,
    input,
    setInvalid(invalid) {
      if (invalid) input.setAttribute('aria-invalid', 'true')
      else input.removeAttribute('aria-invalid')
    },
  }
}

/** A password field with a Show/Hide button. */
function passwordField(label: string, autocomplete: string, hint?: string): SkyField {
  const toggle = h('button', { type: 'button', class: 'ghost-button', 'aria-pressed': 'false' }, 'Show')
  const field = skyField(label, { name: 'password', type: 'password', autocomplete, required: true }, hint, toggle)
  toggle.addEventListener('click', () => {
    const show = field.input.type === 'password'
    field.input.type = show ? 'text' : 'password'
    toggle.textContent = show ? 'Hide' : 'Show'
    toggle.setAttribute('aria-pressed', String(show))
    getStage().sound.cue('tick')
  })
  return field
}

function skyLink(text: string, path: string): HTMLButtonElement {
  return h('button', { type: 'button', class: 'sky-link', onclick: () => go(path) }, text)
}

interface SkyAuth {
  page: Page
  /** Show a message with a soft "deny" sound, a shake and a brief warm flash. */
  deny(message: string, field?: SkyField): void
  /** Show a calm success message. */
  note(message: string): void
  clear(): void
  /** Light up the sky after a successful sign-in. */
  accept(): void
  setBusy(button: HTMLButtonElement, busy: boolean): void
}

/**
 * The sign-in pages: a card in orbit above a giant planet backlit by a distant sun. Signing in
 * jumps to light speed; moving between the sign-in pages crossfades the card.
 */
function skyAuth(
  context: RouteContext,
  options: { title: string; lede: string; form: HTMLElement; foot: (Node | null)[]; focus: () => HTMLElement | null },
): SkyAuth {
  const stage = getStage()
  const { cosmos, sound, veil } = stage
  const message = h('p', { class: 'form-error', role: 'alert' })
  const soundToggle = createSoundToggle(sound)
  const sunAnchor = h('div', { class: 'login-sun', 'aria-hidden': 'true' })
  const horizonAnchor = h('div', { class: 'login-horizon', 'aria-hidden': 'true' })
  const header = h('div', { class: 'login-head' }, h('span', { class: 'shell-mark', 'aria-hidden': 'true' }, 'M'), h('p', { class: 'shell-eyebrow' }, 'MMAXR LAB'))
  const title = h('h1', { id: 'login-title' }, options.title)
  const lede = h('p', { class: 'lede' }, options.lede)
  const submitButton = options.form.querySelector('button[type="submit"]')
  if (submitButton) submitButton.before(message)
  else options.form.prepend(message)
  const foot = h('div', { class: 'login-foot' }, ...options.foot)
  const card = h('section', { class: 'login-card', 'aria-labelledby': 'login-title' }, header, title, lede, options.form, foot)
  const el = h('main', { class: 'login-page' }, horizonAnchor, sunAnchor, h('div', { class: 'screen-corner' }, soundToggle.element), card)

  let sun: CelestialBody | null = null
  let horizon: CelestialBody | null = null
  let denyTimer = 0
  const onFieldFocus = (event: FocusEvent) => {
    if (event.target instanceof HTMLInputElement) sound.cue('tick')
  }
  options.form.addEventListener('focusin', onFieldFocus)

  const page: Page = {
    el,
    mounted() {
      stage.setCosmic(true)
      sun = cosmos.addStar(LOGIN_SUN)
      sun.anchorTo(sunAnchor)
      horizon = cosmos.addPlanet({ ...LOGIN_HORIZON, lightFrom: sun })
      horizon.anchorTo(horizonAnchor)

      const entry = transitionFor(viewOf(context.from), { name: 'login' })
      cosmos.setPalette(LOGIN_PALETTE, entry.kind === 'open' ? 0 : stage.time(1600))
      sound.setMood(LOGIN_MOOD, 2.6)
      sound.setBedLevel(1, 2)
      if (entry.kind === 'depart') {
        void cosmos.warpTo(0, stage.time(1300), ease.outCubic)
        sound.arrive()
      }
      if (veil.showing) void veil.hide(stage.time(entry.kind === 'open' ? 1500 : 500))
      const quick = entry.kind === 'fade'
      void revealIn(quick ? [title, lede, options.form, foot] : [header, title, lede, options.form, foot], {
        delayMs: entry.kind === 'open' ? 420 : quick ? 60 : 260,
        staggerMs: quick ? 50 : undefined,
        reducedMotion: stage.reducedMotion,
      })
      if (!quick) void revealIn([soundToggle.element], { delayMs: 900, reducedMotion: stage.reducedMotion })
      options.focus()?.focus()
    },
    async leave(to) {
      window.clearTimeout(denyTimer)
      const exit = transitionFor({ name: 'login' }, viewOf(to) ?? { name: 'other' })
      if (exit.kind === 'launch' && !stage.reducedMotion) {
        // Light speed: the card rushes past, the planet drops away and the stars stretch.
        sound.sweep('warp', 1.05)
        cosmos.setPalette(DASHBOARD_PALETTE, 1400)
        const easing = 'cubic-bezier(0.55, 0, 0.75, 0.2)'
        horizonAnchor.animate([{ transform: 'translate(-50%, 0)' }, { transform: 'translate(-50%, 55vh)' }], { duration: 1100, easing, fill: 'forwards' })
        sunAnchor.animate([{ transform: 'translate(0, 0)' }, { transform: 'translate(18vw, -14vh) scale(0.6)' }], { duration: 1100, easing, fill: 'forwards' })
        await Promise.all([
          cosmos.warpTo(1, 1050, ease.inCubic),
          departOut(card, { scale: 1.12, lift: 0, durationMs: 700 }),
          departOut(soundToggle.element, { durationMs: 400 }),
        ])
        return
      }
      if (exit.kind === 'launch') cosmos.setPalette(DASHBOARD_PALETTE, stage.time(600))
      if (exit.kind === 'fade') {
        // Another sign-in page: keep the sky, swap the card.
        sound.cue('tick')
        await departOut(card, { durationMs: 260, reducedMotion: stage.reducedMotion })
        return
      }
      await departOut(card, { reducedMotion: stage.reducedMotion })
    },
    destroy() {
      window.clearTimeout(denyTimer)
      options.form.removeEventListener('focusin', onFieldFocus)
      soundToggle.dispose()
      sun?.remove()
      horizon?.remove()
    },
  }

  return {
    page,
    deny(text, field) {
      message.classList.remove('is-ok')
      message.textContent = text
      if (field) {
        field.setInvalid(true)
        field.input.focus()
      }
      sound.cue('deny')
      shake(card, stage.reducedMotion)
      cosmos.setPalette(DENY_PALETTE, stage.time(220))
      window.clearTimeout(denyTimer)
      denyTimer = window.setTimeout(() => cosmos.setPalette(LOGIN_PALETTE, stage.time(1600)), 520)
    },
    note(text) {
      message.textContent = text
      message.classList.add('is-ok')
    },
    clear() {
      message.textContent = ''
      message.classList.remove('is-ok')
      for (const input of options.form.querySelectorAll('input')) input.removeAttribute('aria-invalid')
    },
    accept() {
      sound.cue('confirm')
      sun?.setHighlight(true)
      horizon?.setHighlight(true)
    },
    setBusy(button, busy) {
      button.disabled = busy
      if (busy) sound.cue('tick')
    },
  }
}

const USERNAME_RULE = /^[a-zA-Z0-9_.-]{3,32}$/

export function loginPage(context: RouteContext): Page {
  const username = skyField('Username', { name: 'username', type: 'text', autocomplete: 'username', autocapitalize: 'off', maxlength: '32', required: true })
  const password = passwordField('Password', 'current-password')
  const submit = h('button', { type: 'submit', class: 'primary-button' }, 'Sign in')
  const form = h(
    'form',
    { class: 'login-form', novalidate: true },
    username.root,
    password.root,
    h('div', { class: 'login-row' }, skyLink('Forgot password?', '/forgot')),
    submit,
  )
  const auth = skyAuth(context, {
    title: 'Science experiments',
    lede: 'Sign in to start your experiments.',
    form,
    foot: [h('p', { class: 'fine-print' }, 'New here? ', skyLink('Create an account', '/register'))],
    focus: () => username.input,
  })

  let busy = false
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (busy) return
    auth.clear()
    const name = username.input.value.trim()
    if (!name) return auth.deny('Enter your username.', username)
    if (!password.input.value) return auth.deny('Enter your password.', password)
    busy = true
    auth.setBusy(submit, true)
    try {
      await userAuth.login(name, password.input.value)
      auth.accept()
      go('/experiments')
    } catch (err) {
      password.input.value = ''
      auth.deny((err as Error).message, err instanceof ApiError && err.status === 401 ? password : undefined)
    } finally {
      busy = false
      auth.setBusy(submit, false)
    }
  })
  return auth.page
}

export function registerPage(context: RouteContext): Page {
  const username = skyField('Username', { name: 'username', type: 'text', autocomplete: 'username', autocapitalize: 'off', maxlength: '32', required: true }, '3–32 letters, numbers, . _ -')
  const email = skyField('Email (optional)', { name: 'email', type: 'email', autocomplete: 'email' })
  const password = passwordField('Password', 'new-password', 'At least 8 characters')
  const submit = h('button', { type: 'submit', class: 'primary-button' }, 'Create account')
  const form = h('form', { class: 'login-form', novalidate: true }, username.root, email.root, password.root, submit)
  const auth = skyAuth(context, {
    title: 'Create your account',
    lede: 'Your lab work is saved under a private ID, not your name.',
    form,
    foot: [h('p', { class: 'fine-print' }, 'Already registered? ', skyLink('Sign in', '/login'))],
    focus: () => username.input,
  })

  let busy = false
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (busy) return
    auth.clear()
    const name = username.input.value.trim()
    if (!USERNAME_RULE.test(name)) return auth.deny('Use 3–32 letters, numbers, . _ -', username)
    if (password.input.value.length < 8) return auth.deny('Use at least 8 characters for your password.', password)
    busy = true
    auth.setBusy(submit, true)
    try {
      await userAuth.register(name, password.input.value, email.input.value.trim())
      auth.accept()
      toast('Account created. Welcome to MMAXR Lab!')
      go('/experiments')
    } catch (err) {
      auth.deny((err as Error).message, err instanceof ApiError && err.status === 409 ? username : undefined)
    } finally {
      busy = false
      auth.setBusy(submit, false)
    }
  })
  return auth.page
}

export function forgotPage(context: RouteContext): Page {
  const slot = h('div', { class: 'login-form' })
  const auth = skyAuth(context, {
    title: 'Reset your password',
    lede: 'Enter your username and we will start a reset.',
    form: slot,
    foot: [h('p', { class: 'fine-print' }, skyLink('Back to sign in', '/login'))],
    focus: () => slot.querySelector('input'),
  })
  // The status line lives in `slot`; each step swaps the form after it.
  const status = slot.firstElementChild!

  const showRequest = () => {
    const username = skyField('Username', { name: 'username', type: 'text', autocomplete: 'username', autocapitalize: 'off', required: true })
    const submit = h('button', { type: 'submit', class: 'primary-button' }, 'Send reset code')
    const form = h('form', { class: 'login-form', novalidate: true }, username.root, submit)
    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      auth.clear()
      if (!username.input.value.trim()) return auth.deny('Enter your username.', username)
      auth.setBusy(submit, true)
      try {
        const res = await userAuth.forgotPassword(username.input.value.trim())
        getStage().sound.cue('confirm')
        showReset(res.message, res.devResetToken)
      } catch (err) {
        auth.deny((err as Error).message)
        auth.setBusy(submit, false)
      }
    })
    slot.replaceChildren(status, form)
  }

  const showReset = (message: string, devToken?: string) => {
    const token = skyField(
      'Reset code',
      { name: 'token', type: 'text', autocomplete: 'one-time-code', value: devToken ?? '', required: true },
      devToken ? 'Filled in for you: no mail server is connected in development.' : 'Paste the code from your reset message.',
    )
    const password = passwordField('New password', 'new-password', 'At least 8 characters')
    const submit = h('button', { type: 'submit', class: 'primary-button' }, 'Set new password')
    const form = h('form', { class: 'login-form', novalidate: true }, token.root, password.root, submit)
    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      auth.clear()
      if (!token.input.value.trim()) return auth.deny('Enter the reset code.', token)
      if (password.input.value.length < 8) return auth.deny('Use at least 8 characters for your password.', password)
      auth.setBusy(submit, true)
      try {
        await userAuth.resetPassword(token.input.value.trim(), password.input.value)
        getStage().sound.cue('confirm')
        toast('Password updated. Sign in with your new password.')
        go('/login')
      } catch (err) {
        auth.deny((err as Error).message)
        auth.setBusy(submit, false)
      }
    })
    slot.replaceChildren(status, form)
    auth.note(message)
    ;(devToken ? password.input : token.input).focus()
  }

  showRequest()
  return auth.page
}
