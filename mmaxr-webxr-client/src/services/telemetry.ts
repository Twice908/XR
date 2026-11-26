import type { TelemetryEvent, XapiVerb } from '@mmaxr/schema'
import { CONFIG, DEVICE } from '../config'

interface SessionContext {
  sessionId: string
  studentId: string
  token: string
}

type EventObject = TelemetryEvent['object']

/**
 * Batches xAPI events to the xapi-emitter. Raw sensor streams never go through here.
 * Events are kept in order and retried until accepted.
 */
export class TelemetryClient {
  private ctx: SessionContext | null = null
  private queue: TelemetryEvent[] = []
  private flushing = false
  private retryTimer: number | null = null
  private ended = false

  configure(ctx: SessionContext) {
    this.ctx = ctx
    this.queue = []
    this.ended = false
  }

  reset() {
    this.ctx = null
    this.queue = []
    this.ended = false
    if (this.retryTimer) window.clearTimeout(this.retryTimer)
  }

  /** `at` lets a lab stamp the moment the student acted (e.g. the click), when the event is sent after a server reply. */
  emit(verb: XapiVerb, object: EventObject, at?: number): TelemetryEvent | null {
    if (!this.ctx) return null
    const event: TelemetryEvent = {
      sessionId: this.ctx.sessionId,
      studentId: this.ctx.studentId,
      timestamp: at ?? Date.now(),
      device: DEVICE,
      verb,
      object,
    }
    this.queue.push(event)
    if (object.action === 'submit_analysis' || object.action === 'leave_lab') this.ended = true
    void this.flush()
    return event
  }

  /** A lab session is running and has been neither submitted nor left. */
  get inProgress() {
    return this.ctx !== null && !this.ended
  }

  /** Best-effort delivery on page close. */
  flushBeacon() {
    if (!this.ctx || this.queue.length === 0) return
    // sendBeacon cannot set an Authorization header, so the session token travels in the body.
    const body = JSON.stringify({ token: this.ctx.token, events: this.queue })
    navigator.sendBeacon(CONFIG.TELEMETRY_URL, new Blob([body], { type: 'application/json' }))
    this.queue = []
  }

  get pending() {
    return this.queue.length
  }

  private async flush() {
    if (this.flushing || this.queue.length === 0 || !this.ctx) return
    this.flushing = true
    try {
      while (this.queue.length > 0 && this.ctx) {
        const batch = this.queue.slice()
        const res = await fetch(CONFIG.TELEMETRY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.ctx.token}` },
          body: JSON.stringify({ events: batch }),
        })
        if (!res.ok) throw new Error(`Telemetry ${res.status}`)
        this.queue.splice(0, batch.length)
      }
    } catch (err) {
      console.warn('[telemetry] flush failed, retrying in 2s', err)
      this.retryTimer = window.setTimeout(() => void this.flush(), 2000)
    } finally {
      this.flushing = false
    }
  }
}

export const telemetry = new TelemetryClient()
