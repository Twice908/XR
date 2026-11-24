import { CONFIG } from '../config'

export interface Vec3Like {
  x: number
  y: number
  z: number
}

/**
 * Buffers 30 Hz head + hand samples and uploads the CSV once, when the session ends.
 * On desktop the "hand" is the pointer projected into the lab; in XR it will be the controller / hand joint.
 */
export class SensorTracker {
  private timer: number | null = null
  private rows: string[] = []
  private sessionId: string | null = null
  private getHead: () => Vec3Like = () => ({ x: 0, y: 0, z: 0 })
  private getHand: () => Vec3Like = () => ({ x: 0, y: 0, z: 0 })

  start(sessionId: string, getHead: () => Vec3Like, getHand: () => Vec3Like) {
    this.stop(false)
    this.sessionId = sessionId
    this.getHead = getHead
    this.getHand = getHand
    this.rows = ['timestamp,head_x,head_y,head_z,hand_x,hand_y,hand_z']
    this.timer = window.setInterval(() => this.capture(), 1000 / 30)
    window.addEventListener('pagehide', this.onPageHide)
  }

  private capture() {
    const h = this.getHead()
    const p = this.getHand()
    const f = (n: number) => n.toFixed(4)
    this.rows.push(`${Date.now()},${f(h.x)},${f(h.y)},${f(h.z)},${f(p.x)},${f(p.y)},${f(p.z)}`)
  }

  private onPageHide = () => {
    this.upload(true)
  }

  private upload(useBeacon: boolean) {
    if (!this.sessionId || this.rows.length <= 1) return
    // sensor-stream takes a multipart upload with the CSV in a `file` field.
    const body = new FormData()
    body.append('file', new Blob([this.rows.join('\n')], { type: 'text/csv' }), `sensor_${this.sessionId}.csv`)
    const url = `${CONFIG.SENSOR_UPLOAD_URL}/${this.sessionId}`
    if (useBeacon) navigator.sendBeacon(url, body)
    else void fetch(url, { method: 'POST', body, keepalive: true }).catch(() => {})
    this.rows = this.rows.slice(0, 1)
  }

  get sampleCount() {
    return Math.max(0, this.rows.length - 1)
  }

  stop(upload = true) {
    if (this.timer) window.clearInterval(this.timer)
    this.timer = null
    window.removeEventListener('pagehide', this.onPageHide)
    if (upload) this.upload(false)
  }
}

export const sensorTracker = new SensorTracker()
