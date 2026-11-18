import { h } from './dom'

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive'
type Size = 'sm' | 'md' | 'lg'

export interface ButtonOpts {
  variant?: Variant
  size?: Size
  block?: boolean
  type?: 'button' | 'submit'
  disabled?: boolean
  onClick?: (e: MouseEvent) => void
}

export function button(label: string, opts: ButtonOpts = {}): HTMLButtonElement {
  const cls = ['btn']
  if (opts.variant && opts.variant !== 'secondary') cls.push(`btn-${opts.variant}`)
  if (opts.size && opts.size !== 'md') cls.push(`btn-${opts.size}`)
  if (opts.block) cls.push('btn-block')
  const el = h('button', { class: cls.join(' '), type: opts.type ?? 'button' }, label)
  setDisabled(el, !!opts.disabled)
  el.addEventListener('click', (e) => {
    if (el.getAttribute('aria-disabled') === 'true') {
      e.preventDefault()
      return
    }
    opts.onClick?.(e)
  })
  return el
}

/** aria-disabled keeps the control focusable and explains itself, as Astryx buttons do. */
export function setDisabled(el: HTMLElement, disabled: boolean) {
  if (disabled) el.setAttribute('aria-disabled', 'true')
  else el.removeAttribute('aria-disabled')
}

export function setLoading(el: HTMLButtonElement, loading: boolean, label: string) {
  el.textContent = ''
  if (loading) el.append(h('span', { class: 'spinner' }), 'Please wait…')
  else el.append(label)
  setDisabled(el, loading)
}

export interface FieldOpts {
  label: string
  name: string
  type?: string
  placeholder?: string
  hint?: string
  autocomplete?: string
  required?: boolean
  value?: string
}

let fieldId = 0
export function field(opts: FieldOpts) {
  const id = `f${++fieldId}`
  const input = h('input', {
    class: 'input',
    id,
    name: opts.name,
    type: opts.type ?? 'text',
    placeholder: opts.placeholder,
    autocomplete: opts.autocomplete,
    required: opts.required,
    value: opts.value,
    spellcheck: 'false',
    autocapitalize: 'none',
  })
  const error = h('div', { class: 'error-text', role: 'alert', hidden: true })
  const root = h(
    'div',
    { class: 'field' },
    h('label', { for: id }, opts.label),
    input,
    opts.hint ? h('div', { class: 'hint' }, opts.hint) : null,
    error,
  )
  return {
    root,
    input,
    setError(message: string | null) {
      error.hidden = !message
      error.textContent = message ?? ''
      input.setAttribute('aria-invalid', message ? 'true' : 'false')
    },
  }
}

export function banner(kind: 'error' | 'success' | 'info', text: string) {
  return h('div', { class: `banner banner-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, text)
}

export function badge(text: string, kind: 'neutral' | 'info' | 'success' | 'warning' | 'error' = 'neutral') {
  return h('span', { class: kind === 'neutral' ? 'badge' : `badge badge-${kind}` }, text)
}

export function link(text: string, onClick: () => void) {
  return h('button', { class: 'link', type: 'button', onclick: onClick }, text)
}

export function brand() {
  return h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, 'M'), 'MMAXR Lab')
}

export interface DialogHandle {
  root: HTMLElement
  body: HTMLElement
  close: () => void
}

export function dialog(opts: { title: string; description?: string; wide?: boolean; dismissable?: boolean; onClose?: () => void }): DialogHandle {
  const body = h('div', { class: 'stack' })
  const panel = h(
    'div',
    { class: opts.wide ? 'dialog dialog-wide' : 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title },
    h('div', { class: 'stack', style: 'gap:6px' }, h('h2', { class: 't-title' }, opts.title), opts.description ? h('p', { class: 't-support' }, opts.description) : null),
    body,
  )
  const root = h('div', { class: 'dialog-backdrop' }, panel)
  const close = () => {
    root.remove()
    document.removeEventListener('keydown', onKey)
    opts.onClose?.()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && opts.dismissable !== false) close()
  }
  document.addEventListener('keydown', onKey)
  if (opts.dismissable !== false) root.addEventListener('mousedown', (e) => e.target === root && close())
  document.body.appendChild(root)
  return { root, body, close }
}

let toastHost: HTMLElement | null = null
export function toast(message: string, kind: 'info' | 'error' = 'info') {
  if (!toastHost || !toastHost.isConnected) {
    toastHost = h('div', { class: 'toasts', 'aria-live': 'polite' })
    document.body.appendChild(toastHost)
  }
  const el = h('div', { class: kind === 'error' ? 'toast toast-error' : 'toast' }, message)
  toastHost.appendChild(el)
  window.setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3500)
}

export function segmented<T extends string>(label: string, options: { value: T; label: string }[], value: T, onChange: (v: T) => void) {
  const root = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label })
  const render = (current: T) => {
    root.textContent = ''
    for (const o of options) {
      root.append(
        h('button', { type: 'button', role: 'radio', 'aria-checked': String(o.value === current), onclick: () => { render(o.value); onChange(o.value) } }, o.label),
      )
    }
  }
  render(value)
  return root
}
