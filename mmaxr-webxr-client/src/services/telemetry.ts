import type { TelemetryEvent, XapiVerb } from '@mmaxr/schema'
import { CONFIG } from '../config'

interface SessionContext {
  sessionId: string
  token: string
  studentId: string
  lessonId: string
}

class TelemetryClient {
  private ctx: SessionContext | null = null
  private queue: TelemetryEvent[] = []
  private flushing = false

  configure(ctx: SessionContext) {
    this.ctx = ctx
  }

  emit(verb: XapiVerb, object: string, context: Record<string, unknown> = {}) {
    if (!this.ctx) {
      console.warn('[telemetry] emit before configure() — dropping', verb)
      return
    }
    const event: TelemetryEvent = {
      // Assumes TelemetryEvent shape { sessionId, studentId, lessonId, verb, object, context, timestamp }
      sessionId: this.ctx.sessionId,
      studentId: this.ctx.studentId,
      lessonId: this.ctx.lessonId,
      timestamp: new Date().toISOString(),
      verb,
      object,
      context,
    } as TelemetryEvent

    this.queue.push(event)
    void this.flush()
  }

  private async flush() {
    if (this.flushing || this.queue.length === 0 || !this.ctx) return
    this.flushing = true
    try {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, this.queue.length)
        const res = await fetch(CONFIG.TELEMETRY_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.ctx.token}`,
          },
          body: JSON.stringify({ events: batch }),
        })
        if (!res.ok) {
          this.queue.unshift(...batch)
          throw new Error(`Telemetry ${res.status}`)
        }
      }
    } catch (err) {
      console.warn('[telemetry] flush failed, retrying in 2s', err)
      setTimeout(() => void this.flush(), 2000)
    } finally {
      this.flushing = false
    }
  }
}

export const telemetry = new TelemetryClient()