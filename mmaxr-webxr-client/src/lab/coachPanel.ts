import type { CoachMode, CoachStatus } from '../services/aiCoach'
import { h } from '../ui/dom'
import { button, segmented } from '../ui/components'

export interface CoachPanelOptions {
  onAsk(text: string): void
  onMode(mode: CoachMode): void
  /** Ask the HUD to open or close this panel. */
  setOpen(open: boolean): void
  initialMode: CoachMode
}

const MODE_LABEL: Record<CoachMode, string> = { proactive: 'Proactive', on_request: 'On request', off: 'Off' }

/** Typed coach chat. Messages are short and spoken-style so a voice layer can read them aloud later. */
export class CoachPanel {
  readonly el: HTMLElement
  readonly toggle: HTMLButtonElement
  readonly bubble: HTMLElement
  private log = h('div', { class: 'coach-log', role: 'log', 'aria-live': 'polite' })
  private statusDot = h('span', { class: 'coach-dot', 'aria-hidden': 'true' })
  private statusText = h('span', { class: 't-support' }, 'Connecting…')
  private input: HTMLInputElement
  private thinkingEl: HTMLElement | null = null
  private bubbleTimer: number | null = null
  private open = false
  private mode: CoachMode
  private basicNoticeShown = false

  constructor(opts: CoachPanelOptions) {
    this.mode = opts.initialMode
    this.input = h('input', { class: 'input', type: 'text', placeholder: 'Ask your coach…', autocomplete: 'off', maxlength: '500', 'aria-label': 'Message your coach' })
    const form = h('form', { class: 'coach-form' }, this.input, button('Send', { variant: 'primary', size: 'sm', type: 'submit' }))
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      const text = this.input.value.trim()
      if (!text) return
      this.input.value = ''
      this.addStudent(text)
      opts.onAsk(text)
    })

    this.el = h(
      'aside',
      { class: 'panel panel-coach', 'aria-label': 'Lab coach' },
      h('div', { class: 'panel-head' }, h('div', { class: 'row', style: 'gap:8px' }, h('h2', { class: 't-heading' }, 'Coach'), this.statusDot, this.statusText), h('button', { class: 'panel-close', type: 'button', 'aria-label': 'Close coach', onclick: () => opts.setOpen(false) }, '×')),
      segmented<CoachMode>('Coach mode', (Object.keys(MODE_LABEL) as CoachMode[]).map((m) => ({ value: m, label: MODE_LABEL[m] })), this.mode, (m) => {
        this.mode = m
        opts.onMode(m)
        this.input.disabled = m === 'off'
        this.input.placeholder = m === 'off' ? 'Coach is off' : 'Ask your coach…'
      }),
      this.log,
      form,
    )

    this.toggle = button('Coach', { size: 'sm', onClick: () => opts.setOpen(!this.open) })
    this.bubble = h('button', { class: 'coach-bubble', type: 'button', hidden: true, onclick: () => opts.setOpen(true) })
    this.input.disabled = this.mode === 'off'
    this.addCoach('Hi, I am your lab coach. I will not give you answers, but I will ask questions that help you work them out.', 'reply', false, false)
  }

  /** Called by the HUD whenever the panel actually opens or closes. */
  setOpenState(open: boolean) {
    this.open = open
    this.toggle.classList.remove('has-unread')
    if (open) {
      this.bubble.hidden = true
      queueMicrotask(() => this.input.focus())
    }
  }

  setStatus(status: CoachStatus, info?: { provider?: string; configured?: boolean }) {
    this.statusDot.className = `coach-dot ${status}`
    this.statusText.textContent = status === 'online' ? (info?.configured === false ? 'Basic mode' : 'Online') : status === 'connecting' ? 'Connecting…' : 'Offline'
  }

  setThinking(on: boolean) {
    this.thinkingEl?.remove()
    this.thinkingEl = null
    if (on) {
      this.thinkingEl = h('div', { class: 'coach-msg coach-from-coach coach-thinking', 'aria-label': 'Coach is thinking' }, h('span'), h('span'), h('span'))
      this.log.appendChild(this.thinkingEl)
      this.scroll()
    }
  }

  /** A line from the system, not the coach: a limit reached, the coach being off or offline. */
  addNote(text: string) {
    this.setThinking(false)
    this.log.appendChild(h('div', { class: 'coach-note', role: 'status' }, text))
    this.scroll()
  }

  /** Shown once the coach falls back to its simple questions (no AI model available). */
  markBasic() {
    this.statusText.textContent = 'Basic mode'
  }

  addStudent(text: string) {
    this.log.appendChild(h('div', { class: 'coach-msg coach-from-student' }, text))
    this.scroll()
  }

  addCoach(text: string, reason: 'reply' | 'nudge' | 'wrapup', degraded: boolean, announce = true) {
    this.setThinking(false)
    if (degraded && !this.basicNoticeShown) {
      this.basicNoticeShown = true
      this.markBasic()
      this.log.appendChild(h('div', { class: 'coach-note' }, 'The coach cannot reach its AI right now, so it can only ask simple guiding questions.'))
    }
    this.log.appendChild(h('div', { class: 'coach-msg coach-from-coach' }, text))
    this.scroll()
    if (!announce || this.open) return
    this.toggle.classList.add('has-unread')
    this.bubble.textContent = text
    this.bubble.hidden = false
    if (this.bubbleTimer !== null) window.clearTimeout(this.bubbleTimer)
    // A wrap-up deserves to be read, so it stays until dismissed or opened.
    if (reason !== 'wrapup') this.bubbleTimer = window.setTimeout(() => (this.bubble.hidden = true), 12_000)
  }

  setMode(mode: CoachMode) {
    this.mode = mode
  }

  private scroll() {
    this.log.scrollTop = this.log.scrollHeight
  }
}
