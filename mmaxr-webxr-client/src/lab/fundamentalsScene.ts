import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { MotionLessonContract } from '@mmaxr/schema'
import { stageSet } from './stage'
import { BoldArrow, type Gauge, type MotionSceneEvents, type SandboxScene } from './motionScene'
import * as kin from './fund/kinematics'
import * as dyn from './fund/dynamics'
import * as nrg from './fund/energy'
import * as mea from './fund/measure'

/*
 * The Fundamental Physics lab: four benches in one scene (a circular track, a crash lab, an energy workshop and a
 * measurement workstation). Each bench lives in its own file under ./fund and draws with the small kit below.
 * The scene only simulates and draws; what a result means comes from the server once the student has watched it.
 */
export const MODULE_X: Record<string, number> = { kinematics_vectors: 0, dynamics_impulse: 400, work_energy: 800, fundamental_quantities: 1200 }
export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
export type Ease = (t: number) => number
export const easeInOut: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
export const clamp01 = (t: number) => Math.max(0, Math.min(1, t))
export const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))
export const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
export const fx = (n: number, d = 1) => (Math.abs(n) < 0.5 * Math.pow(10, -d) ? (0).toFixed(d) : n.toFixed(d))

export interface Job {
  update(dt: number): number | null
  done(): void
}

/** A flat panel with a canvas you can draw on every frame: graphs, dials, displays. */
export class CanvasPanel extends THREE.Mesh {
  readonly ctx: CanvasRenderingContext2D
  private readonly tex: THREE.CanvasTexture
  constructor(w: number, h: number, px = 512) {
    const c = document.createElement('canvas')
    c.width = px
    c.height = Math.round((px * h) / w)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    super(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }))
    this.ctx = c.getContext('2d')!
    this.tex = tex
    this.renderOrder = 6
  }
  get W() {
    return this.ctx.canvas.width
  }
  get H() {
    return this.ctx.canvas.height
  }
  /** Clears to a rounded dark card. */
  card(bg = 'rgba(8,12,20,0.86)') {
    const x = this.ctx
    x.clearRect(0, 0, this.W, this.H)
    x.fillStyle = bg
    x.beginPath()
    x.roundRect(4, 4, this.W - 8, this.H - 8, 24)
    x.fill()
  }
  text(s: string, x: number, y: number, size: number, color = '#e6edf7', align: CanvasTextAlign = 'center', weight = 700) {
    const c = this.ctx
    c.fillStyle = color
    c.font = `${weight} ${size}px system-ui, sans-serif`
    c.textAlign = align
    c.textBaseline = 'middle'
    c.fillText(s, x, y)
  }
  flush() {
    this.tex.needsUpdate = true
  }
}

export class FundamentalsScene implements SandboxScene {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  readonly clock = new THREE.Clock()
  private readonly pointer = new THREE.Vector2(10, 10)
  private readonly raycaster = new THREE.Raycaster()
  private readonly handPoint = new THREE.Vector3(0, 1, 0.5)
  private readonly handPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  readonly groups: Record<string, THREE.Group> = {}
  /** Whatever the current question put on the bench: cleared and rebuilt for each question. */
  readonly stuff: Record<string, THREE.Group> = {}
  moduleId = 'kinematics_vectors'
  private tweens = new Set<(dt: number) => boolean>()
  job: Job | null = null
  private lingerLeft: number | null = null
  private resolveJob: (() => void) | null = null
  private flightId = 0
  insetsPx = { left: 0, right: 0, top: 0, bottom: 0 }
  insetsTarget = { left: 0, right: 0, top: 0, bottom: 0 }
  disposed = false
  private running = false
  private gaugeClock = 0
  /** Loaded models by asset name (car, stopwatch, ruler, spring, cylinder, thermometer, multimeter, crate). */
  readonly models: Record<string, THREE.Object3D | null> = {}
  /** Per-frame animations that keep going between questions (spinning stopwatch hands, glowing bulbs…). */
  readonly idle = new Set<(dt: number) => void>()
  private readonly onResize = () => this.resize()
  private readonly bg = new THREE.Color(0x0b0d12)

  constructor(
    private readonly canvas: HTMLCanvasElement,
    readonly lesson: MotionLessonContract,
    readonly events: MotionSceneEvents = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.95
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.xr.enabled = true
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 800)
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.maxPolarAngle = Math.PI * 0.49
    this.controls.minDistance = 3
    this.controls.maxDistance = 120
    this.controls.addEventListener('start', () => (this.flightId += 1))
    const scene = this.scene
    scene.background = this.bg
    scene.fog = new THREE.Fog(0x0b0d12, 120, 320)
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.5
    scene.add(new THREE.HemisphereLight(0x9bb4ff, 0x1a1410, 0.35))
    const stages: Record<string, Parameters<typeof stageSet>[1]> = {
      kinematics_vectors: { cx: 0, cz: 0, w: 64, d: 56, key: [10, 40, 24], aim: [0, 0, 0], keyI: 2600, rimI: 500, rimAt: [-24, 18, -16], dust: { n: 120, h: 18 } },
      dynamics_impulse: { cx: 0, cz: 0, w: 40, d: 18, wall: { z: -9, h: 20 }, key: [6, 26, 16], aim: [0, 2, 0], keyI: 1100, rimI: 240, rimAt: [14, 12, 8], dust: { n: 90, h: 16 } },
      work_energy: { cx: 0, cz: 0, w: 40, d: 18, wall: { z: -9, h: 20 }, key: [6, 26, 16], aim: [0, 2, 0], keyI: 1100, rimI: 240, rimAt: [14, 12, 8], dust: { n: 90, h: 16 } },
      fundamental_quantities: { cx: 0, cz: 0, w: 44, d: 18, wall: { z: -9, h: 18 }, key: [6, 26, 16], aim: [0, 2, 0], keyI: 1100, rimI: 240, rimAt: [14, 12, 8], dust: { n: 90, h: 14 } },
    }
    for (const id of Object.keys(MODULE_X)) {
      const g = new THREE.Group()
      g.position.x = MODULE_X[id]
      g.visible = id === this.moduleId
      this.groups[id] = g
      scene.add(g)
      stageSet(g, stages[id])
      const stuff = new THREE.Group()
      g.add(stuff)
      this.stuff[id] = stuff
    }
    this.resize()
    window.addEventListener('resize', this.onResize)
    canvas.addEventListener('pointermove', this.onPointerMove)
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

  /* ---------------- the kit ---------------- */
  label(text: string, color = '#e6edf7', scale = 1): THREE.Sprite {
    const font = '700 54px system-ui, sans-serif'
    const probe = document.createElement('canvas').getContext('2d')!
    probe.font = font
    const w = Math.max(512, Math.ceil(probe.measureText(text).width) + 80)
    const c = document.createElement('canvas')
    c.width = w
    c.height = 128
    const x = c.getContext('2d')!
    x.fillStyle = 'rgba(8,12,20,0.78)'
    x.beginPath()
    x.roundRect(8, 16, w - 16, 96, 26)
    x.fill()
    x.fillStyle = color
    x.font = font
    x.textAlign = 'center'
    x.textBaseline = 'middle'
    x.fillText(text, w / 2, 66)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }))
    s.scale.set(2.8 * scale * (w / 512), 0.7 * scale, 1)
    s.renderOrder = 8
    return s
  }
  /** A big emoji as a sprite: icons for the energy chain and the workstation. */
  icon(emoji: string, size = 2): THREE.Sprite {
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const x = c.getContext('2d')!
    x.font = '200px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'
    x.textAlign = 'center'
    x.textBaseline = 'middle'
    x.fillText(emoji, 128, 140)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }))
    s.scale.set(size, size, 1)
    s.renderOrder = 7
    return s
  }
  mat(color: number, metalness = 0.3, roughness = 0.5, extra: THREE.MeshStandardMaterialParameters = {}) {
    return new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra })
  }
  mesh(geo: THREE.BufferGeometry, m: THREE.Material, shadow = true): THREE.Mesh {
    const x = new THREE.Mesh(geo, m)
    x.castShadow = shadow
    x.receiveShadow = true
    return x
  }
  /** A model scaled to a target size, standing on y = 0 and centred on x, z. */
  fit(model: THREE.Object3D | null | undefined, o: { width?: number; height?: number; depth?: number; fallback: () => THREE.Object3D }): THREE.Group {
    const wrap = new THREE.Group()
    if (!model) {
      wrap.add(o.fallback())
      return wrap
    }
    const m = model.clone(true)
    const box = new THREE.Box3().setFromObject(m)
    const size = box.getSize(new THREE.Vector3())
    const k = o.width ? o.width / (size.x || 1) : o.height ? o.height / (size.y || 1) : (o.depth ?? 1) / (size.z || 1)
    m.scale.multiplyScalar(k)
    const b2 = new THREE.Box3().setFromObject(m)
    const c = b2.getCenter(new THREE.Vector3())
    m.position.set(-c.x, -b2.min.y, -c.z)
    m.traverse((x) => {
      if (x instanceof THREE.Mesh) {
        x.castShadow = true
        x.receiveShadow = true
      }
    })
    wrap.add(m)
    return wrap
  }
  /** A model turned first (in its own frame), then fitted. */
  fitTurned(model: THREE.Object3D | null | undefined, rot: [number, number, number], o: { width?: number; height?: number; depth?: number; fallback: () => THREE.Object3D }): THREE.Group {
    if (!model) return this.fit(null, o)
    const turned = new THREE.Group()
    const c = model.clone(true)
    c.rotation.set(...rot)
    turned.add(c)
    return this.fit(turned, o)
  }
  rope(points: THREE.Vector3[], r = 0.05, color = 0xd9c4a0): THREE.Mesh {
    const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.02)
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, points.length * 8), r, 6, false), this.mat(color, 0, 0.9))
    m.castShadow = true
    return m
  }
  setRope(m: THREE.Mesh, points: THREE.Vector3[]) {
    const r = (m.geometry as THREE.TubeGeometry).parameters.radius
    m.geometry.dispose()
    m.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.02), Math.max(8, points.length * 8), r, 6, false)
  }
  arrow(color: number, thick = 0.12): BoldArrow {
    const a = new BoldArrow(color, thick)
    a.visible = false
    return a
  }
  /** Points an arrow from `from` along `dir` with the given length (hidden when too short). */
  point(a: BoldArrow, from: THREE.Vector3, dir: THREE.Vector3, len: number, head = 0.7) {
    if (len < 0.05 || dir.lengthSq() < 1e-9) {
      a.visible = false
      return
    }
    a.position.copy(from)
    a.setDirection(dir)
    a.setLength(len, Math.min(head, len * 0.6), head * 0.85)
    a.visible = true
  }
  clear(id: string) {
    const g = this.stuff[id]
    g.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Points) o.geometry?.dispose()
    })
    g.clear()
    this.idle.clear()
    return g
  }
  emitGauges(dt: number, g: () => Gauge[], force = false) {
    this.gaugeClock += dt
    if (force || this.gaugeClock >= 0.08) {
      this.gaugeClock = 0
      this.events.onGauges?.(g())
    }
  }
  note(text: string | null) {
    this.events.onNote?.(text)
  }
  setBackground(color: number) {
    this.bg.set(color)
    ;(this.scene.fog as THREE.Fog).color.set(color)
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
  animate(ms: number, fn: (k: number) => void, ease: Ease = (t) => t): Promise<void> {
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
  /** Flies the camera; positions are relative to the current module's centre. */
  flyTo(pos: THREE.Vector3, target: THREE.Vector3, ms = 1100, moduleId = this.moduleId): Promise<void> {
    const id = ++this.flightId
    const X = MODULE_X[moduleId] ?? 0
    const p1 = pos.clone().add(V(X))
    const t1 = target.clone().add(V(X))
    const p0 = this.camera.position.clone()
    const t0 = this.controls.target.clone()
    if (ms <= 0) {
      this.camera.position.copy(p1)
      this.controls.target.copy(t1)
      return Promise.resolve()
    }
    return this.animate(ms, (k) => {
      if (id !== this.flightId) return
      this.camera.position.lerpVectors(p0, p1, k)
      this.controls.target.lerpVectors(t0, t1, k)
    }, easeInOut)
  }
  private home(id: string): { pos: THREE.Vector3; target: THREE.Vector3 } {
    switch (id) {
      case 'kinematics_vectors':
        return { pos: V(0, 30, 40), target: V(0, 0, 2) }
      case 'dynamics_impulse':
        return { pos: V(0, 9, 30), target: V(0, 4, 0) }
      case 'work_energy':
        return { pos: V(0, 9, 30), target: V(0, 4.5, 0) }
      default:
        return { pos: V(0, 9, 26), target: V(0, 4, 0) }
    }
  }

  async goto(moduleId: string, instant = false): Promise<void> {
    this.abort()
    this.moduleId = moduleId
    for (const [id, g] of Object.entries(this.groups)) g.visible = id === moduleId
    this.setBackground(0x0b0d12)
    this.events.onGauges?.(null)
    this.events.onNote?.(null)
    const v = this.home(moduleId)
    await this.flyTo(v.pos, v.target, instant ? 0 : 1300, moduleId)
  }

  /* ---------------- jobs ---------------- */
  abort() {
    this.job?.done()
    this.job = null
    this.lingerLeft = null
    this.resolveJob?.()
    this.resolveJob = null
  }
  begin(job: Job): Promise<void> {
    this.abort()
    return new Promise((resolve) => {
      this.job = job
      this.resolveJob = resolve
    })
  }
  private finish() {
    const r = this.resolveJob
    this.job?.done()
    this.job = null
    this.lingerLeft = null
    this.resolveJob = null
    r?.()
  }
  reset() {
    this.abort()
    this.events.onGauges?.(null)
    this.events.onNote?.(null)
  }

  /** Sets the bench for a question before it is answered, without running it. */
  stage(action: string, params: Record<string, unknown> = {}) {
    if (this.busy) return
    this.events.onNote?.(null)
    const m = this.moduleId
    if (kin.ACTIONS.includes(action)) kin.stage(this, action, params)
    else if (dyn.ACTIONS.includes(action)) dyn.stage(this, action, params)
    else if (nrg.ACTIONS.includes(action)) nrg.stage(this, action, params)
    else if (mea.ACTIONS.includes(action)) mea.stage(this, action, params)
    void m
  }

  async run(action: string, params: Record<string, unknown> = {}): Promise<void> {
    this.events.onNote?.(null)
    if (kin.ACTIONS.includes(action)) return kin.run(this, action, params)
    if (dyn.ACTIONS.includes(action)) return dyn.run(this, action, params)
    if (nrg.ACTIONS.includes(action)) return nrg.run(this, action, params)
    if (mea.ACTIONS.includes(action)) return mea.run(this, action, params)
  }

  /* ---------------- loading ---------------- */
  async load(): Promise<void> {
    const loader = new GLTFLoader()
    const a = this.lesson.assets
    const names = Object.keys(a)
    let done = 0
    await Promise.all(
      names.map(async (name) => {
        const r = await loader
          .loadAsync(a[name])
          .then((x) => x.scene)
          .catch((err) => {
            console.warn('[fundamentals] model failed to load, using a stand-in', a[name], err)
            return null
          })
        this.models[name] = r
        this.events.onProgress?.(++done, names.length)
      }),
    )
    if (this.disposed) return
    kin.build(this)
    dyn.build(this)
    nrg.build(this)
    mea.build(this)
  }

  /* ---------------- frame ---------------- */
  private onPointerMove = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect()
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    this.raycaster.ray.intersectPlane(this.handPlane, this.handPoint)
  }
  private resize() {
    const w = this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || 800
    const h = this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || 600
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }
  start() {
    this.running = true
    this.renderer.setAnimationLoop(() => this.frame())
  }
  frame() {
    if (this.disposed || !this.running) return
    const dt = Math.min(this.clock.getDelta(), 0.05)
    for (const tw of [...this.tweens]) if (!tw(dt)) this.tweens.delete(tw)
    for (const f of this.idle) f(dt)
    if (this.job) {
      if (this.lingerLeft === null) {
        const end = this.job.update(dt)
        if (end !== null) this.lingerLeft = end
      } else {
        this.lingerLeft -= dt * 1000
        if (this.lingerLeft <= 0) this.finish()
      }
    }
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
