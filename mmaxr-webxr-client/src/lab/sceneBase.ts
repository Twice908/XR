import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { Gauge, MotionSceneEvents, SandboxScene } from './motionScene'

export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
export type Ease = (t: number) => number
export const easeInOut: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
export const smooth = (a: number, b: number, t: number) => easeInOut(Math.max(0, Math.min(1, (t - a) / (b - a))))
export const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
export const f1 = (n: number) => (Math.abs(n) < 0.05 ? '0.0' : n.toFixed(1))
export const f2 = (n: number) => (Math.abs(n) < 0.005 ? '0.00' : n.toFixed(2))

export interface Job {
  /** Return null to keep going, or the milliseconds to linger on the final picture before finishing. */
  update(dt: number): number | null
  done(): void
}

/**
 * The shared plumbing of a lab scene: renderer, camera and controls, module groups, tweens, the one running
 * experiment ("job"), gauges and the HUD insets. A lab extends it and adds its own equipment and experiments.
 */
export abstract class SceneBase implements SandboxScene {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  protected readonly clock = new THREE.Clock()
  protected readonly raycaster = new THREE.Raycaster()
  protected readonly pointer = new THREE.Vector2(10, 10)
  protected readonly handPoint = new THREE.Vector3(0, 1, 0.5)
  protected readonly handPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  protected groups: Record<string, THREE.Group> = {}
  protected moduleId = ''
  protected tweens = new Set<(dt: number) => boolean>()
  protected job: Job | null = null
  protected lingerLeft: number | null = null
  protected resolveJob: (() => void) | null = null
  protected flightId = 0
  protected insetsPx = { left: 0, right: 0, top: 0, bottom: 0 }
  protected insetsTarget = { left: 0, right: 0, top: 0, bottom: 0 }
  protected disposed = false
  protected running = false
  protected gaugeClock = 0
  private readonly onResize = () => this.resize()

  constructor(
    protected readonly canvas: HTMLCanvasElement,
    protected readonly events: MotionSceneEvents = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.95
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.xr.enabled = true
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400)
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.maxPolarAngle = Math.PI * 0.49
    this.controls.minDistance = 2
    this.controls.maxDistance = 40
    this.controls.addEventListener('start', () => (this.flightId += 1))
    const scene = this.scene
    scene.background = new THREE.Color(0x0b0d12)
    scene.fog = new THREE.Fog(0x0b0d12, 40, 160)
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.4
    scene.add(new THREE.HemisphereLight(0x9bb4ff, 0x1a1410, 0.28))
    window.addEventListener('resize', this.onResize)
    canvas.addEventListener('pointermove', this.onPointerMove)
  }

  /** Creates one hidden-until-shown group per module, `spacing` apart along x. */
  protected makeGroups(ids: string[], spacing = 300) {
    ids.forEach((id, i) => {
      const g = new THREE.Group()
      g.position.x = i * spacing
      g.visible = i === 0
      this.groups[id] = g
      this.scene.add(g)
    })
    this.moduleId = ids[0]
  }

  get head(): THREE.Vector3 {
    return this.camera.position
  }
  get hand(): THREE.Vector3 {
    return this.handPoint
  }
  get busy(): boolean {
    return this.job !== null
  }
  readonly isFreeDriving = false
  startFreeDrive() {}
  stopFreeDrive() {}
  driveInput() {}
  async runPushHeavy(): Promise<void> {}

  abstract load(): Promise<void>
  abstract goto(moduleId: string, instant?: boolean): Promise<void>
  abstract run(action: string, params?: Record<string, unknown>): Promise<void>

  /* ---------------- small builders ---------------- */
  protected label(text: string, color = '#e6edf7', scale = 1): THREE.Sprite {
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 128
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }))
    s.scale.set(2.4 * scale, 0.6 * scale, 1)
    s.userData = { canvas: c, color }
    this.relabel(s, text)
    return s
  }

  /** Changes the words on a label. */
  protected relabel(s: THREE.Sprite, text: string, color?: string) {
    if (color) s.userData.color = color
    const c = s.userData.canvas as HTMLCanvasElement
    const x = c.getContext('2d')!
    x.clearRect(0, 0, c.width, c.height)
    x.fillStyle = 'rgba(8,12,20,0.78)'
    x.beginPath()
    x.roundRect(8, 16, 496, 96, 26)
    x.fill()
    x.fillStyle = s.userData.color as string
    let size = 54
    x.font = `700 ${size}px system-ui, sans-serif`
    while (x.measureText(text).width > 470 && size > 24) {
      size -= 2
      x.font = `700 ${size}px system-ui, sans-serif`
    }
    x.textAlign = 'center'
    x.textBaseline = 'middle'
    x.fillText(text, 256, 66)
    ;(s.material as THREE.SpriteMaterial).map!.needsUpdate = true
  }

  /* ---------------- camera ---------------- */
  setInsets(i: { left: number; right: number; top: number; bottom: number }) {
    this.insetsTarget = { ...i }
  }
  private applyInsets(dt: number) {
    const k = 1 - Math.pow(0.001, dt)
    for (const key of ['left', 'right', 'top', 'bottom'] as const) this.insetsPx[key] += (this.insetsTarget[key] - this.insetsPx[key]) * k
    const W = this.canvas.clientWidth || window.innerWidth
    const H = this.canvas.clientHeight || window.innerHeight
    const a = this.insetsPx
    const cx = (a.left + (W - a.right)) / 2
    const cy = (a.top + (H - a.bottom)) / 2
    this.camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H)
  }
  protected animate(ms: number, fn: (k: number) => void, ease: Ease = (t) => t): Promise<void> {
    return new Promise((resolve) => {
      let el = 0
      const step = (dt: number) => {
        el += dt * 1000
        const k = Math.min(1, el / ms)
        fn(ease(k))
        if (k >= 1) {
          resolve()
          return false
        }
        return true
      }
      this.tweens.add(step)
    })
  }
  protected flyTo(pos: THREE.Vector3, target: THREE.Vector3, ms = 1400): Promise<void> {
    const id = ++this.flightId
    const p0 = this.camera.position.clone()
    const t0 = this.controls.target.clone()
    return this.animate(ms, (k) => {
      if (id !== this.flightId) return
      this.camera.position.lerpVectors(p0, pos, k)
      this.controls.target.lerpVectors(t0, target, k)
    }, easeInOut)
  }

  /* ---------------- jobs ---------------- */
  protected abort() {
    this.job?.done()
    this.job = null
    this.lingerLeft = null
    this.resolveJob?.()
    this.resolveJob = null
  }
  protected begin(job: Job): Promise<void> {
    this.abort()
    return new Promise((resolve) => {
      this.job = job
      this.resolveJob = resolve
    })
  }
  protected finish() {
    const r = this.resolveJob
    this.job?.done()
    this.job = null
    this.lingerLeft = null
    this.resolveJob = null
    r?.()
  }
  protected emitGauges(dt: number, g: () => Gauge[], force = false) {
    this.gaugeClock += dt
    if (force || this.gaugeClock >= 0.08) {
      this.gaugeClock = 0
      this.events.onGauges?.(g())
    }
  }
  reset() {
    this.abort()
    this.events.onGauges?.(null)
    this.events.onNote?.(null)
  }

  /** Per-frame work of the lab itself (drifting steam, shimmering light…). */
  protected tick(_dt: number, _time: number) {}

  /* ---------------- input + loop ---------------- */
  private onPointerMove = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect()
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const p = new THREE.Vector3()
    if (this.raycaster.ray.intersectPlane(this.handPlane, p)) this.handPoint.copy(p)
  }
  private resize() {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.fov = w / h < 1 ? 60 : 42
    this.camera.updateProjectionMatrix()
  }
  protected sizeNow() {
    this.resize()
  }
  start() {
    if (this.running) return
    this.running = true
    this.renderer.setAnimationLoop(() => this.frame())
  }
  private frame() {
    if (this.disposed) return
    const dt = Math.min(this.clock.getDelta(), 0.05)
    for (const tw of [...this.tweens]) if (!tw(dt)) this.tweens.delete(tw)
    if (this.job) {
      if (this.lingerLeft === null) {
        const end = this.job.update(dt)
        if (end !== null) this.lingerLeft = end
      } else {
        this.lingerLeft -= dt * 1000
        if (this.lingerLeft <= 0) this.finish()
      }
    }
    this.tick(dt, this.clock.elapsedTime)
    this.applyInsets(dt)
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }
  dispose() {
    this.disposed = true
    this.abort()
    this.renderer.setAnimationLoop(null)
    window.removeEventListener('resize', this.onResize)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.controls.dispose()
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Line || o instanceof THREE.Sprite) {
        ;(o as THREE.Mesh).geometry?.dispose()
        const mats = (o as THREE.Mesh).material
        for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
          for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose()
          m.dispose()
        }
      }
    })
    this.renderer.dispose()
  }
}
