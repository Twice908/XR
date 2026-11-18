import { ApiError, userAuth } from '../services/userAuth'
import { h } from '../ui/dom'
import { banner, brand, button, field, link, setLoading, toast } from '../ui/components'
import { go, type Page } from '../router'

function shell(title: string, subtitle: string, ...content: Node[]): HTMLElement {
  return h(
    'main',
    { class: 'auth' },
    h('div', { class: 'auth-card' }, brand(), h('div', { class: 'stack', style: 'gap:6px' }, h('h1', { class: 't-display' }, title), h('p', { class: 't-support' }, subtitle)), ...content),
  )
}

export function loginPage(): Page {
  const username = field({ label: 'Username', name: 'username', autocomplete: 'username', required: true })
  const password = field({ label: 'Password', name: 'password', type: 'password', autocomplete: 'current-password', required: true })
  const errorSlot = h('div')
  const submit = button('Sign In', { variant: 'primary', size: 'lg', block: true, type: 'submit' })

  const form = h(
    'form',
    { class: 'stack', novalidate: true },
    errorSlot,
    username.root,
    password.root,
    h('div', { class: 'row row-between' }, h('span'), link('Forgot password?', () => go('/forgot'))),
    submit,
  )

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    errorSlot.replaceChildren()
    username.setError(username.input.value.trim() ? null : 'Enter your username')
    password.setError(password.input.value ? null : 'Enter your password')
    if (!username.input.value.trim() || !password.input.value) return
    setLoading(submit, true, 'Sign In')
    try {
      await userAuth.login(username.input.value.trim(), password.input.value)
      go('/experiments')
    } catch (err) {
      errorSlot.replaceChildren(banner('error', (err as Error).message))
      setLoading(submit, false, 'Sign In')
    }
  })

  const el = shell(
    'Welcome back',
    'Sign in to start your experiments.',
    form,
    h('p', { class: 't-support', style: 'text-align:center' }, 'New here? ', link('Create an account', () => go('/register'))),
  )
  queueMicrotask(() => username.input.focus())
  return { el }
}

export function registerPage(): Page {
  const username = field({ label: 'Username', name: 'username', autocomplete: 'username', hint: '3–32 letters, numbers, . _ -', required: true })
  const email = field({ label: 'Email (optional)', name: 'email', type: 'email', autocomplete: 'email' })
  const password = field({ label: 'Password', name: 'password', type: 'password', autocomplete: 'new-password', hint: 'At least 8 characters', required: true })
  const errorSlot = h('div')
  const submit = button('Create account', { variant: 'primary', size: 'lg', block: true, type: 'submit' })

  const form = h('form', { class: 'stack', novalidate: true }, errorSlot, username.root, email.root, password.root, submit)
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    errorSlot.replaceChildren()
    const u = username.input.value.trim()
    const pw = password.input.value
    username.setError(/^[a-zA-Z0-9_.-]{3,32}$/.test(u) ? null : 'Use 3–32 letters, numbers, . _ -')
    password.setError(pw.length >= 8 ? null : 'Use at least 8 characters')
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(u) || pw.length < 8) return
    setLoading(submit, true, 'Create account')
    try {
      await userAuth.register(u, pw, email.input.value.trim())
      toast('Account created. Welcome to MMAXR Lab!')
      go('/experiments')
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) username.setError(err.message)
      else errorSlot.replaceChildren(banner('error', (err as Error).message))
      setLoading(submit, false, 'Create account')
    }
  })

  return {
    el: shell('Create your account', 'Your lab work is saved under a private ID, not your name.', form, h('p', { class: 't-support', style: 'text-align:center' }, 'Already registered? ', link('Sign In', () => go('/login')))),
  }
}

export function forgotPage(): Page {
  const slot = h('div', { class: 'stack' })
  const card = shell('Reset your password', 'Enter your username and we will start a reset.', slot)

  const showRequest = () => {
    const username = field({ label: 'Username', name: 'username', autocomplete: 'username', required: true })
    const errorSlot = h('div')
    const submit = button('Send reset link', { variant: 'primary', size: 'lg', block: true, type: 'submit' })
    const form = h('form', { class: 'stack', novalidate: true }, errorSlot, username.root, submit, h('div', { style: 'text-align:center' }, link('Back to Sign In', () => go('/login'))))
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      errorSlot.replaceChildren()
      if (!username.input.value.trim()) return username.setError('Enter your username')
      username.setError(null)
      setLoading(submit, true, 'Send reset link')
      try {
        const res = await userAuth.forgotPassword(username.input.value.trim())
        showReset(res.message, res.devResetToken)
      } catch (err) {
        errorSlot.replaceChildren(banner('error', (err as Error).message))
        setLoading(submit, false, 'Send reset link')
      }
    })
    slot.replaceChildren(form)
  }

  const showReset = (message: string, devToken?: string) => {
    const token = field({ label: 'Reset code', name: 'token', value: devToken ?? '', hint: devToken ? 'Filled in for you: no mail server is connected in development.' : 'Paste the code from your reset message.', required: true })
    const pw = field({ label: 'New password', name: 'password', type: 'password', autocomplete: 'new-password', hint: 'At least 8 characters', required: true })
    const errorSlot = h('div')
    const submit = button('Set new password', { variant: 'primary', size: 'lg', block: true, type: 'submit' })
    const form = h('form', { class: 'stack', novalidate: true }, banner('info', message), errorSlot, token.root, pw.root, submit)
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      errorSlot.replaceChildren()
      if (pw.input.value.length < 8) return pw.setError('Use at least 8 characters')
      pw.setError(null)
      setLoading(submit, true, 'Set new password')
      try {
        await userAuth.resetPassword(token.input.value.trim(), pw.input.value)
        toast('Password updated. Sign in with your new password.')
        go('/login')
      } catch (err) {
        errorSlot.replaceChildren(banner('error', (err as Error).message))
        setLoading(submit, false, 'Set new password')
      }
    })
    slot.replaceChildren(form)
  }

  showRequest()
  return { el: card }
}
