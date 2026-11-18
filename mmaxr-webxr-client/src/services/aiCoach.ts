import { CONFIG } from '../config'

/*
 * Client for the ai-coach WebSocket. The message format is channel-agnostic: text goes in and out today,
 * and a speech-to-text / text-to-speech layer can sit on top of `ask()` and the 'coach' messages later
 * without changing the service.
 */

export type CoachMode = 'proactive' | 'on_request' | 'off'
export type CoachEventKind = 'prediction_mismatch' | 'revision' | 'ph_unlocked' | 'ready_to_submit' | 'idle'
export type CoachStatus = 'connecting' | 'online' | 'offline'

export interface TestView {
  tool: string
  predicted: string | null
  observed: string
  matched: boolean
  recorded: string | null
}
export interface TubeView {
  n: number
  tests: TestView[]
  conclusion: string | null
  revisions: number
  recordedPh: number | null
}
export interface Snapshot {
  phase: string
  tools: string[]
  activeTool: string | null
  tubes: TubeView[]
}
export interface TruthTube {
  tube: number
  name: string
  formula: string
  type: string
  ph: number
}
export interface SecretTube {
  tube: number
  terms: string[]
  verdict?: string
  ph?: number
}
export interface CoachHello {
  lessonId: string
  title: string
  labType: string
  summary?: string
  secrets?: SecretTube[]
}

export type CoachServerMessage =
  | { type: 'ready'; mode: CoachMode; provider: string; model: string; configured: boolean }
  | { type: 'thinking' }
  | { type: 'coach'; id: string; text: string; reason: 'reply' | 'nudge' | 'wrapup'; provider: string; blocked: boolean; degraded: boolean }
  | { type: 'mode'; mode: CoachMode }
  | { type: 'coach_off' }
  | { type: 'error'; message: string }

export interface CoachContext {
  sessionId: string
  studentId: string
  token: string
}

const MODE_KEY = 'mmaxr.coach.mode'

export function loadMode(): CoachMode {
  try {
    const v = localStorage.getItem(MODE_KEY)
    if (v === 'proactive' || v === 'on_request' || v === 'off') return v
  } catch {
    /* storage unavailable */
  }
  return 'proactive'
}

export class CoachClient {
  private ws: WebSocket | null = null
  private ctx: CoachContext | null = null
  private hello: CoachHello | null = null
  private outbox: string[] = []
  private messageHandlers = new Set<(m: CoachServerMessage) => void>()
  private statusHandlers = new Set<(s: CoachStatus) => void>()
  private reconnectDelay = 1000
  private reconnectTimer: number | null = null
  private closed = false
  mode: CoachMode = loadMode()
  status: CoachStatus = 'connecting'

  connect(ctx: CoachContext, hello: CoachHello) {
    this.ctx = ctx
    this.hello = hello
    this.closed = false
    this.open()
  }

  private open() {
    if (!this.ctx || this.closed) return
    this.setStatus('connecting')
    const url = new URL(CONFIG.AI_COACH_WS)
    url.searchParams.set('sessionId', this.ctx.sessionId)
    url.searchParams.set('studentId', this.ctx.studentId)
    url.searchParams.set('token', this.ctx.token)

    let ws: WebSocket
    try {
      ws = new WebSocket(url.toString())
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws = ws

    ws.onopen = () => {
      this.reconnectDelay = 1000
      this.setStatus('online')
      this.raw({ type: 'hello', ...this.hello })
      this.raw({ type: 'mode', mode: this.mode })
      while (this.outbox.length && ws.readyState === WebSocket.OPEN) ws.send(this.outbox.shift()!)
    }
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return
      try {
        const msg = JSON.parse(ev.data) as CoachServerMessage
        this.messageHandlers.forEach((h) => h(msg))
      } catch {
        /* ignore malformed frames */
      }
    }
    ws.onclose = (ev) => {
      this.setStatus('offline')
      // 4401/4403 mean the service refused this session; retrying will not help.
      if (!this.closed && ev.code !== 4401 && ev.code !== 4403) this.scheduleReconnect()
    }
    ws.onerror = () => {}
  }

  private scheduleReconnect() {
    if (this.closed || this.reconnectTimer !== null) return
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.open()
    }, this.reconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15_000)
  }

  private setStatus(s: CoachStatus) {
    this.status = s
    this.statusHandlers.forEach((h) => h(s))
  }

  private raw(msg: object) {
    const data = JSON.stringify(msg)
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data)
    else if (this.outbox.length < 20) this.outbox.push(data)
  }

  onMessage(h: (m: CoachServerMessage) => void) {
    this.messageHandlers.add(h)
    return () => this.messageHandlers.delete(h)
  }
  onStatus(h: (s: CoachStatus) => void) {
    this.statusHandlers.add(h)
    return () => this.statusHandlers.delete(h)
  }

  ask(text: string, snapshot: Snapshot) {
    this.raw({ type: 'ask', text, snapshot })
  }
  event(kind: CoachEventKind, detail: string, snapshot: Snapshot) {
    // Nudges are only useful live; do not queue them while offline.
    if (this.ws?.readyState === WebSocket.OPEN) this.raw({ type: 'event', kind, detail, snapshot })
  }
  reveal(truth: TruthTube[], snapshot: Snapshot) {
    this.raw({ type: 'reveal', truth, snapshot })
  }
  setMode(mode: CoachMode) {
    this.mode = mode
    try {
      localStorage.setItem(MODE_KEY, mode)
    } catch {
      /* ignore */
    }
    this.raw({ type: 'mode', mode })
  }

  disconnect() {
    this.closed = true
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.ws?.close()
    this.ws = null
    this.messageHandlers.clear()
    this.statusHandlers.clear()
  }
}
