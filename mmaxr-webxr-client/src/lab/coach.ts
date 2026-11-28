import { XapiVerb } from '@mmaxr/schema'
import { CoachClient, loadMode, type CoachHello, type CoachServerMessage, type Snapshot } from '../services/aiCoach'
import type { LabSession } from '../services/session'
import { telemetry } from '../services/telemetry'
import { h } from '../ui/dom'
import { CoachPanel } from './coachPanel'

/** Where a lab puts the coach: its HUD's panel slot, or a floating button for labs without one. */
export interface CoachMount {
  attachPanel(panel: HTMLElement, toggle: HTMLElement, onOpenChange: (open: boolean) => void, overlay?: HTMLElement): void
  setPanelOpen(panel: HTMLElement, open: boolean): void
}

export interface CoachOptions {
  session: LabSession
  hello: CoachHello
  /** What the student can see right now (never hidden answers). */
  snapshot: () => Snapshot
  mount: CoachMount
  /** The lab is finished: no more idle nudges. */
  finished?: () => boolean
  /** Quiet time before the coach offers an unprompted nudge (proactive mode only). */
  idleMs?: number
  /** Where activity is watched for the idle nudge. */
  activityRoot: HTMLElement
  /** How the idle moment is described to the coach. */
  idleText?: string
}

export interface LabCoach {
  client: CoachClient
  panel: CoachPanel
  /** Counts as student activity for the idle nudge (for labs whose clicks the page cannot see). */
  markActive(): void
  dispose(): void
}

/**
 * The lab coach, the same in every lab: a chat panel where the student types questions, the connection to the coach
 * service, and the idle nudge. Every message the service sends ends up visible: replies, "thinking", and also the
 * reasons a question got no reply (limit reached, coach off, offline).
 */
export function startCoach(opts: CoachOptions): LabCoach {
  const client = new CoachClient()
  let info: { provider?: string; configured?: boolean } = {}
  const panel: CoachPanel = new CoachPanel({
    initialMode: loadMode(),
    setOpen: (open) => opts.mount.setPanelOpen(panel.el, open),
    onAsk: (text) => {
      if (client.status !== 'online') panel.addNote('The coach is not connected right now. Your question will be sent as soon as it is back.')
      client.ask(text, opts.snapshot())
      telemetry.emit(XapiVerb.INVESTIGATED, { action: 'ask_coach', data: { length: text.length } })
    },
    onMode: (mode) => {
      client.setMode(mode)
      telemetry.emit(XapiVerb.INVESTIGATED, { action: 'coach_mode', value: mode })
    },
  })
  opts.mount.attachPanel(panel.el, panel.toggle, (open) => panel.setOpenState(open), panel.bubble)

  client.onStatus((s) => panel.setStatus(s, info))
  client.onMessage((m: CoachServerMessage) => {
    switch (m.type) {
      case 'ready':
        info = { provider: m.provider, configured: m.configured }
        panel.setStatus('online', info)
        return
      case 'thinking':
        return panel.setThinking(true)
      case 'coach':
        panel.addCoach(m.text, m.reason, m.degraded)
        if (m.reason === 'wrapup') opts.mount.setPanelOpen(panel.el, true)
        return
      case 'coach_cancelled':
        return panel.setThinking(false)
      case 'coach_off':
        return panel.addNote('The coach is off. Switch it to "On request" or "Proactive" to ask a question.')
      case 'error':
        return panel.addNote(m.message)
      default:
        return // voice messages: not played in the browser yet
    }
  })
  client.connect({ sessionId: opts.session.sessionId, studentId: opts.session.studentId, token: opts.session.token }, opts.hello)

  // If the student goes quiet for a while, offer a nudge (the service rate-limits it and honours the mode).
  let lastActive = Date.now()
  const active = () => (lastActive = Date.now())
  opts.activityRoot.addEventListener('pointerdown', active)
  const idleMs = opts.idleMs ?? 75_000
  const idleTimer = window.setInterval(() => {
    if (!opts.finished?.() && Date.now() - lastActive > idleMs) {
      lastActive = Date.now()
      client.event('idle', opts.idleText ?? 'The student has not done anything for a while.', opts.snapshot())
    }
  }, 10_000)

  return {
    client,
    panel,
    markActive: active,
    dispose() {
      window.clearInterval(idleTimer)
      opts.activityRoot.removeEventListener('pointerdown', active)
      client.disconnect()
    },
  }
}

/**
 * For a lab without a HUD panel slot (the cell lab runs in its own frame): a small "Coach" button at the top right,
 * with the panel and the reply bubble beside it.
 */
export function floatingCoachMount(root: HTMLElement): CoachMount & { dispose(): void } {
  const dock = h('div', { class: 'coach-dock' })
  root.appendChild(dock)
  const listeners = new Map<HTMLElement, (open: boolean) => void>()
  return {
    attachPanel(panel, toggle, onOpenChange, overlay) {
      listeners.set(panel, onOpenChange)
      dock.appendChild(toggle)
      root.appendChild(panel)
      if (overlay) root.appendChild(overlay)
    },
    setPanelOpen(panel, open) {
      panel.classList.toggle('open', open)
      listeners.get(panel)?.(open)
    },
    dispose: () => dock.remove(),
  }
}
