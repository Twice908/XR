import { CONFIG } from '../config'

export interface ChatMessage {
  role: 'coach' | 'student' | 'system'
  text: string
  timestamp: string
  flagged?: boolean
}

export interface AiCoachContext {
  sessionId: string
  studentId: string
  lessonId: string
  token: string
}

type Handler = (msg: ChatMessage) => void

class AiCoachClient {
  private ws: WebSocket | null = null
  private handlers = new Set<Handler>()
  private outbox: string[] = []
  private reconnectDelay = 1000
  private ctx: AiCoachContext | null = null
  private manuallyClosed = false

  connect(ctx: AiCoachContext) {
    this.manuallyClosed = false
    this.ctx = ctx
    const url = new URL(CONFIG.AI_COACH_WS)
    url.searchParams.set('sessionId', ctx.sessionId)
    url.searchParams.set('studentId', ctx.studentId)
    url.searchParams.set('lessonId', ctx.lessonId)
    url.searchParams.set('token', ctx.token)

    this.ws = new WebSocket(url.toString())

    this.ws.onopen = () => {
      this.reconnectDelay = 1000
      while (this.outbox.length) this.ws!.send(this.outbox.shift()!)
    }

    this.ws.onmessage = (ev) => {
      this.handleIncoming(ev.data)
    }

    this.ws.onclose = () => {
      if (this.manuallyClosed) return
      this.scheduleReconnect()
    }
    this.ws.onerror = (e) => console.warn('[ai-coach] ws error', e)
  }

  /**
   * Accepts every reasonable shape the backend might send:
   *  - plain string                → "Hello there"
   *  - JSON string                 → "\"Hello there\""
   *  - object with text            → { role: 'coach', text: '...', timestamp: '...' }
   *  - object with message/content → { role: 'coach', message: '...' }
   *  - history batch               → { type: 'history', messages: [...] }
   */
  private handleIncoming(raw: string | Blob) {
    if (typeof raw !== 'string') return

    // Try JSON parse first
    let parsed: unknown = null
    try {
      parsed = JSON.parse(raw)
    } catch {
      // Not JSON → treat as raw coach string
      this.dispatch({
        role: 'coach',
        text: raw,
        timestamp: new Date().toISOString(),
      })
      return
    }

    // Primitive string: "Hello"
    if (typeof parsed === 'string') {
      this.dispatch({
        role: 'coach',
        text: parsed,
        timestamp: new Date().toISOString(),
      })
      return
    }

    // Batch history
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as { type?: string }).type === 'history' &&
      Array.isArray((parsed as { messages?: unknown }).messages)
    ) {
      const batch = (parsed as { messages: unknown[] }).messages
      for (const item of batch) {
        const m = this.normaliseMessage(item)
        if (m) this.dispatch(m)
      }
      return
    }

    // Single object
    const m = this.normaliseMessage(parsed)
    if (m) this.dispatch(m)
  }

  /** Coerce whatever the backend object uses (text / message / content) into a ChatMessage */
  private normaliseMessage(input: unknown): ChatMessage | null {
    if (!input || typeof input !== 'object') return null
    const obj = input as Record<string, unknown>

    const text =
      (typeof obj.text === 'string' && obj.text) ||
      (typeof obj.message === 'string' && obj.message) ||
      (typeof obj.content === 'string' && obj.content) ||
      (typeof obj.reply === 'string' && obj.reply) ||
      ''

    if (!text) return null

    const rawRole = typeof obj.role === 'string' ? obj.role : 'coach'
    const role: ChatMessage['role'] =
      rawRole === 'student' || rawRole === 'system' || rawRole === 'coach'
        ? rawRole
        : 'coach'

    const timestamp =
      typeof obj.timestamp === 'string' ? obj.timestamp : new Date().toISOString()

    return { role, text, timestamp, flagged: Boolean(obj.flagged) }
  }

  private dispatch(msg: ChatMessage) {
    if (msg.role === 'system' || msg.flagged) {
      this.handlers.forEach((h) => h({ ...msg, role: 'system', flagged: true }))
      return
    }
    this.handlers.forEach((h) => h(msg))
  }

  private scheduleReconnect() {
    if (!this.ctx) return
    setTimeout(() => this.connect(this.ctx!), this.reconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000)
  }

  sendStudentMessage(text: string) {
    const payload = JSON.stringify({
      role: 'student',
      text,
      timestamp: new Date().toISOString(),
    })
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(payload)
    else this.outbox.push(payload)
  }

  subscribe(handler: Handler): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  disconnect() {
    this.manuallyClosed = true
    this.ws?.close()
    this.ws = null
  }
}

export const aiCoach = new AiCoachClient()