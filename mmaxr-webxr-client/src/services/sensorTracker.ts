import { CONFIG } from '../config'
import type { ViewRig } from '../three/viewRig'

export class SensorTracker {
  private timer: number | null = null
  private rows: string[] = ['timestamp,head_x,head_y,head_z,hand_x,hand_y,hand_z']
  private viewRig: ViewRig | null = null
  private sessionId: string | null = null

  start(viewRig: ViewRig, sessionId: string) {
    this.viewRig = viewRig
    this.sessionId = sessionId
    
    // 30Hz = ~33.33ms
    this.timer = window.setInterval(() => this.capture(), 33)
    window.addEventListener('beforeunload', this.handleUnload)
  }

  private capture() {
    if (!this.viewRig) return
    const time = Date.now()
    const cam = this.viewRig.camera
    
    // Head position
    const hx = cam.position.x.toFixed(4)
    const hy = cam.position.y.toFixed(4)
    const hz = cam.position.z.toFixed(4)
    
    // Hand positions (zeros until XR controllers are mapped)
    const dx = '0', dy = '0', dz = '0'
    
    this.rows.push(`${time},${hx},${hy},${hz},${dx},${dy},${dz}`)
  }

  private handleUnload = () => {
    if (this.sessionId) this.upload(this.sessionId)
  }

  private upload(sessionId: string) {
    if (this.rows.length <= 1) return
    const csv = this.rows.join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    navigator.sendBeacon(`${CONFIG.SENSOR_UPLOAD_URL}/${sessionId}`, blob)
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    window.removeEventListener('beforeunload', this.handleUnload)
    if (this.sessionId) this.upload(this.sessionId)
  }
}

export const sensorTracker = new SensorTracker()