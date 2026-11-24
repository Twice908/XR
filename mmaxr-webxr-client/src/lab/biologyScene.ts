import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { BiologyCheckpoint, BiologyLessonContract } from '@mmaxr/schema'
import { sound } from './sound'

/*
 * The anatomy theatre. A teaching torso stands on a pedestal; detailed models of the tooth, stomach and liver
 * float beside it as magnified insets. The salivary glands and the pancreas have no downloaded model, so they are built here from simple shapes. A food bolus travels the digestive path and the camera flies with it.
 * Nothing in this file names an answer: reveal labels come from the server.
 */

const TORSO_SCALE = 1.55 // raw model is 0.82 m tall
const FLOOR_Y = 0

export interface BiologySceneEvents {
  onProgress?(done: number, total: number): void
}

type Ease = (t: number) => number
const easeInOut: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const easeOut: Ease = (t) => 1 - Math.pow(1 - t, 3)
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)

/** Path the food takes, in torso model space. */
const PATH: [number, number, number][] = [
  [-0.012, 0.77, 0.02],
  [-0.005, 0.68, 0.02],
  [0.02, 0.6, 0.03],
  [0.04, 0.53, 0.035],
  [0.0, 0.47, 0.04],
  [-0.03, 0.38, 0.04],
  [0.02, 0.32, 0.04],
  [-0.03, 0.27, 0.04],
  [-0.075, 0.3, 0.04],
  [-0.075, 0.38, 0.04],
  [0.0, 0.41, 0.04],
  [0.07, 0.38, 0.04],
  [0.07, 0.3, 0.04],
  [0.03, 0.2, 0.035],
  [-0.01, 0.1, 0.03],
]

interface Inset {
  key: 'tooth' | 'stomach' | 'liver' | 'salivary' | 'pancreas'
  group: THREE.Group
  home: THREE.Vector3
  baseScale: number
  ready: boolean
  shown: number
  target: number
  light: THREE.PointLight
  line: THREE.Line
}

interface Particle {
  mesh: THREE.Mesh
  vel: THREE.Vector3
  life: number
  max: number
  gravity: number
  swirl?: { center: THREE.Vector3; speed: number }
}

export class BiologyScene {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  private readonly clock = new THREE.Clock()
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2(10, 10)
  private readonly handPoint = new THREE.Vector3(0, 1, 0.5)
  private readonly handPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -0.4)
  private insets: Record<string, Inset> = {}
  private halos: THREE.Mesh[] = []
  private anchors: THREE.Vector3[] = []
  private tAt: number[] = []
  private path: THREE.CatmullRomCurve3
  private bolus: THREE.Mesh
  private bolusLight: THREE.PointLight
  private bolusT = 0
  private activeHalo = -1
  private tweens = new Set<(dt: number) => boolean>()
  private particles: Particle[] = []
  private temps: THREE.Object3D[] = []
  private dust: THREE.Points | null = null
  private insetsPx = { left: 0, right: 0, top: 0, bottom: 0 }
  private insetsTarget = { left: 0, right: 0, top: 0, bottom: 0 }
  private disposed = false
  private running = false
  private busy = false
  private flightId = 0
  private readonly onResize = () => this.resize()

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly lesson: BiologyLessonContract,
    private readonly events: BiologySceneEvents = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.xr.enabled = true

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.03, 30)
    this.camera.position.set(0.4, 1.35, 3.2)
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.target.set(0, 0.8, 0)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.enablePan = false
    this.controls.minDistance = 0.45
    this.controls.maxDistance = 4
    this.controls.minPolarAngle = Math.PI * 0.25
    this.controls.maxPolarAngle = Math.PI * 0.62
    this.controls.minAzimuthAngle = -Math.PI * 0.45
    this.controls.maxAzimuthAngle = Math.PI * 0.45
    this.controls.rotateSpeed = 0.55
    this.controls.addEventListener('start', () => (this.flightId += 1)) // the student took over

    this.path = new THREE.CatmullRomCurve3(PATH.map(([x, y, z]) => V(x * TORSO_SCALE, y * TORSO_SCALE, z * TORSO_SCALE)), false, 'catmullrom', 0.4)
    this.bolus = new THREE.Mesh(new THREE.SphereGeometry(0.02, 20, 16), new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.95 }))
    this.bolusLight = new THREE.PointLight(0xffa24a, 0.8, 0.5)
    this.bolus.add(this.bolusLight)
    this.bolus.position.copy(this.path.getPoint(0))
    this.scene.add(this.bolus)

    this.buildStage()
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

  /* ---------------- stage ---------------- */
  private buildStage() {
    const scene = this.scene
    scene.background = new THREE.Color(0x090b10)
    scene.fog = new THREE.Fog(0x090b10, 5, 11)
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.55
    scene.add(new THREE.HemisphereLight(0xbcd0ff, 0x1a1410, 0.5))

    const key = new THREE.SpotLight(0xfff1dd, 55, 9, Math.PI / 5, 0.6, 1.5)
    key.position.set(1.2, 3.2, 2.4)
    key.target.position.set(0, 0.8, 0)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.bias = -0.0004
    scene.add(key, key.target)
    const rimA = new THREE.PointLight(0x4f8cff, 8, 6)
    rimA.position.set(-2, 1.6, -1.2)
    const rimB = new THREE.PointLight(0xff7ab6, 6, 6)
    rimB.position.set(2.2, 1.2, -1)
    scene.add(rimA, rimB)

    const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 64), new THREE.MeshStandardMaterial({ color: 0x10131a, roughness: 0.5, metalness: 0.3 }))
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    scene.add(floor)
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 0.9, 96), new THREE.MeshBasicMaterial({ color: 0x4f8cff, transparent: true, opacity: 0.35, side: THREE.DoubleSide }))
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.002
    scene.add(ring)
    const ring2 = new THREE.Mesh(new THREE.RingGeometry(1.45, 1.47, 96), new THREE.MeshBasicMaterial({ color: 0x4f8cff, transparent: true, opacity: 0.15, side: THREE.DoubleSide }))
    ring2.rotation.x = -Math.PI / 2
    ring2.position.y = 0.002
    scene.add(ring2)

    const n = 160
    const pos = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 5
      pos[i * 3 + 1] = Math.random() * 2.6
      pos[i * 3 + 2] = (Math.random() - 0.5) * 4
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.dust = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xaecbff, size: 0.01, transparent: true, opacity: 0.4, depthWrite: false }))
    scene.add(this.dust)
  }

  /* ---------------- loading ---------------- */
  /** Loads the torso (needed now); the heavy close-up models load in the background. */
  async load(): Promise<void> {
    const loader = new GLTFLoader()
    const base = await loader.loadAsync(this.lesson.assets.digestiveSystem).catch((err) => {
      console.warn('[biology] torso failed to load', err)
      return null
    })
    this.events.onProgress?.(1, 1)
    if (base) this.placeTorso(base.scene)
    this.buildAnchors()
    this.addProceduralInsets()
    void this.loadInsets(loader)
  }

  private placeTorso(model: THREE.Object3D) {
    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    const k = (0.82 * TORSO_SCALE) / (size.y || 1)
    model.scale.multiplyScalar(k)
    const b2 = new THREE.Box3().setFromObject(model)
    const c = b2.getCenter(new THREE.Vector3())
    model.position.x -= c.x
    model.position.z -= c.z
    model.position.y -= b2.min.y - FLOOR_Y
    model.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true
        o.receiveShadow = true
      }
    })
    const g = new THREE.Group()
    g.add(model)
    this.scene.add(g)
  }

  private buildAnchors() {
    this.anchors = this.lesson.checkpoints.map((cp) => V(cp.modelAnchor.x * TORSO_SCALE, cp.modelAnchor.y * TORSO_SCALE, cp.modelAnchor.z * TORSO_SCALE))
    // Where along the path is each stop?
    const samples = Array.from({ length: 300 }, (_, i) => ({ t: i / 299, p: this.path.getPoint(i / 299) }))
    this.tAt = this.anchors.map((a) => samples.reduce((best, s) => (s.p.distanceTo(a) < best.d ? { d: s.p.distanceTo(a), t: s.t } : best), { d: 1e9, t: 0 }).t)
    this.tAt[0] = 0
    const sizes: Record<string, [number, number, number]> = { salivary_glands: [0.07, 0.04, 0.05], mouth: [0.06, 0.06, 0.06], esophagus: [0.03, 0.09, 0.04], stomach: [0.105, 0.09, 0.07], liver: [0.1, 0.07, 0.07], pancreas: [0.1, 0.035, 0.05], small_intestine: [0.12, 0.12, 0.07], villi: [0.05, 0.07, 0.05], large_intestine: [0.19, 0.24, 0.07] }
    this.lesson.checkpoints.forEach((cp, i) => {
      const s = sizes[cp.id] ?? [0.1, 0.1, 0.07]
      const halo = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }))
      halo.scale.set(...s)
      halo.position.copy(this.anchors[i])
      halo.renderOrder = 6
      this.scene.add(halo)
      this.halos.push(halo)
    })
  }

  private async loadInsets(loader: GLTFLoader) {
    const wanted: { key: Inset['key']; url: string; home: THREE.Vector3; size: number; by: 'height' | 'width'; tint: number }[] = [
      { key: 'tooth', url: this.lesson.assets.tooth, home: V(-0.62, 1.2, 0.25), size: 0.36, by: 'height', tint: 0x9ad0ff },
      { key: 'stomach', url: this.lesson.assets.stomach, home: V(0.66, 0.95, 0.28), size: 0.5, by: 'height', tint: 0xffa0a0 },
      { key: 'liver', url: this.lesson.assets.liver, home: V(-0.7, 0.78, 0.28), size: 0.52, by: 'width', tint: 0xa0ffb0 },
    ]
    for (const w of wanted) {
      const gltf = await loader.loadAsync(w.url).catch((err) => {
        console.warn('[biology] close-up model failed', w.key, err)
        return null
      })
      if (!gltf || this.disposed) continue
      this.addInset(w, gltf.scene)
    }
  }

  /** Models made in code: the salivary glands and the pancreas. They are ready at once. */
  private addProceduralInsets() {
    this.addInset({ key: 'salivary', home: V(0.62, 1.2, 0.25), size: 0.4, by: 'width', tint: 0xffc48a }, buildSalivaryGlands())
    this.addInset({ key: 'pancreas', home: V(0.7, 0.7, 0.28), size: 0.42, by: 'width', tint: 0xffe08a }, buildPancreas())
  }

  private addInset(w: { key: Inset['key']; home: THREE.Vector3; size: number; by: 'height' | 'width'; tint: number }, model: THREE.Object3D) {
    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    const k = w.size / (w.by === 'height' ? size.y : size.x || 1)
    model.scale.multiplyScalar(k)
    const b2 = new THREE.Box3().setFromObject(model)
    model.position.sub(b2.getCenter(new THREE.Vector3()))
    model.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = false
        o.receiveShadow = false
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) (m as THREE.MeshStandardMaterial).side = THREE.DoubleSide
      }
    })
    const group = new THREE.Group()
    group.add(model)
    group.userData.parts = model.userData.parts
    group.position.copy(w.home)
    group.scale.setScalar(0.001)
    group.visible = false
    const light = new THREE.PointLight(w.tint, 0, 1.4)
    light.position.set(0, 0, 0.35)
    group.add(light)
    const home = w.home.clone()
    this.scene.add(group)
    const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: w.tint, dashSize: 0.025, gapSize: 0.02, transparent: true, opacity: 0 }))
    line.frustumCulled = false
    this.scene.add(line)
    this.insets[w.key] = { key: w.key, group, home, baseScale: 1, ready: true, shown: 0, target: 0, light, line }
    this.refreshInsetFor(this.currentIndex)
  }

  isDetailReady(key: string | null): boolean {
    return key === null || !!this.insets[key]?.ready
  }

  /* ---------------- camera + journey ---------------- */
  private currentIndex = -1

  private viewFor(i: number): { pos: THREE.Vector3; target: THREE.Vector3 } {
    const cp = this.lesson.checkpoints[i]
    const anchor = this.anchors[i] ?? V(0, 1, 0)
    const inset = cp.detail ? this.insets[cp.detail]?.home ?? this.defaultInsetHome(cp.detail) : null
    const target = inset ? anchor.clone().lerp(inset, 0.5) : anchor.clone()
    const dist = inset ? 1.55 : cp.id === 'large_intestine' ? 1.35 : 1.15
    const side = inset ? Math.sign(inset.x) * 0.1 : 0
    return { pos: V(target.x + side, target.y + 0.08, target.z + dist), target }
  }

  private defaultInsetHome(key: string) {
    return key === 'tooth' ? V(-0.62, 1.2, 0.25) : key === 'salivary' ? V(0.62, 1.2, 0.25) : key === 'pancreas' ? V(0.7, 0.7, 0.28) : key === 'stomach' ? V(0.66, 0.95, 0.28) : V(-0.7, 0.78, 0.28)
  }

  private flyTo(pos: THREE.Vector3, target: THREE.Vector3, ms = 1700): Promise<void> {
    const id = ++this.flightId
    const p0 = this.camera.position.clone()
    const t0 = this.controls.target.clone()
    return this.animate(ms, (k) => {
      if (id !== this.flightId) return
      this.camera.position.lerpVectors(p0, pos, k)
      this.controls.target.lerpVectors(t0, target, k)
    }, easeInOut)
  }

  /** Zoom out to see the whole body (on), or return to this stop's own view (off). */
  overview(on: boolean) {
    if (this.busy) return
    if (on) void this.flyTo(V(0, 0.85, 3.1), V(0, 0.68, 0), 900)
    else {
      const v = this.viewFor(Math.max(0, this.currentIndex))
      void this.flyTo(v.pos, v.target, 900)
    }
  }

  /** Fly to checkpoint i with the food bolus; resolves when both have arrived. */
  async arrive(i: number, instant = false): Promise<void> {
    const prevIndex = this.currentIndex
    this.currentIndex = i
    this.setActiveHalo(i)
    this.refreshInsetFor(i)
    const v = this.viewFor(i)
    const t1 = this.tAt[i] ?? 0
    if (instant) {
      this.bolusT = t1
      this.bolus.position.copy(this.path.getPoint(t1))
      this.camera.position.copy(v.pos)
      this.controls.target.copy(v.target)
      return
    }
    sound.whoosh(1.4)
    const t0 = this.bolusT
    const travel = this.animate(2600, (k) => {
      this.bolusT = t0 + (t1 - t0) * k
      this.bolus.position.copy(this.path.getPoint(this.bolusT))
      this.bolusLight.intensity = 0.8 + Math.sin(k * 20) * 0.2
    }, easeInOut)
    await Promise.all([this.flyTo(v.pos, v.target, prevIndex < 0 ? 2200 : 2300), travel])
  }

  private setActiveHalo(i: number) {
    this.activeHalo = i
  }

  private refreshInsetFor(i: number) {
    const cp: BiologyCheckpoint | undefined = this.lesson.checkpoints[i]
    for (const ins of Object.values(this.insets)) ins.target = cp?.detail === ins.key ? 1 : 0
  }

  /** Where the camera should frame the scene given what the HUD covers. */
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

  /* ---------------- tweens + particles ---------------- */
  private animate(ms: number, fn: (k: number) => void, ease: Ease = (t) => t): Promise<void> {
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
  private wait(ms: number) {
    return this.animate(ms, () => {})
  }

  private burst(at: THREE.Vector3, n: number, o: { color: number; size?: number; speed?: number; life?: number; gravity?: number; up?: number; spread?: number; swirl?: boolean }) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(o.size ?? 0.006, 8, 6), new THREE.MeshBasicMaterial({ color: o.color, transparent: true, opacity: 0.9, depthWrite: false }))
      m.position.copy(at)
      const sp = o.speed ?? 0.4
      const a = Math.random() * Math.PI * 2
      const sprd = o.spread ?? 1
      this.scene.add(m)
      this.particles.push({
        mesh: m,
        vel: V(Math.cos(a) * sp * Math.random() * sprd, (o.up ?? 0.5) * sp * (0.4 + Math.random()), Math.sin(a) * sp * Math.random() * sprd),
        life: 0,
        max: (o.life ?? 1) * (0.7 + Math.random() * 0.6),
        gravity: o.gravity ?? 0.6,
        swirl: o.swirl ? { center: at.clone(), speed: 3 + Math.random() * 2 } : undefined,
      })
    }
  }

  private temp<T extends THREE.Object3D>(o: T): T {
    this.scene.add(o)
    this.temps.push(o)
    return o
  }
  private clearTemps() {
    for (const o of this.temps) {
      this.scene.remove(o)
      o.traverse((c) => {
        if (c instanceof THREE.Mesh || c instanceof THREE.Line) {
          c.geometry.dispose()
          for (const m of Array.isArray(c.material) ? c.material : [c.material]) m.dispose()
        }
      })
    }
    this.temps = []
  }

  private label(text: string, at: THREE.Vector3, color = '#14161a', bg = '#f4f1e8', scale = 1) {
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 140
    const ctx = c.getContext('2d')!
    ctx.fillStyle = bg
    ctx.beginPath()
    ctx.roundRect(4, 4, 504, 132, 30)
    ctx.fill()
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    let size = 56
    ctx.font = `700 ${size}px Figtree, system-ui, sans-serif`
    while (ctx.measureText(text).width > 470 && size > 20) {
      size -= 4
      ctx.font = `700 ${size}px Figtree, system-ui, sans-serif`
    }
    ctx.fillText(text, 256, 72)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }))
    sp.scale.set(0.3 * scale, 0.082 * scale, 1)
    sp.position.copy(at)
    sp.renderOrder = 9
    this.temp(sp)
    void this.animate(400, (k) => ((sp.material as THREE.SpriteMaterial).opacity = k))
    return sp
  }

  /** Several labels one above the other, e.g. the enzymes found in a juice. */
  private labelStack(labels: string[], at: THREE.Vector3, gap = 0.065, scale = 0.7) {
    labels.slice(0, 6).forEach((t, i) => this.label(t, V(at.x, at.y - i * gap, at.z), '#14161a', '#f4f1e8', scale))
  }

  /** World position of a named part of a procedural inset. */
  private partAt(key: Inset['key'], part: string, fallback: THREE.Vector3): THREE.Vector3 {
    const obj = (this.insets[key]?.group.userData.parts as Record<string, THREE.Object3D> | undefined)?.[part]
    return obj ? obj.getWorldPosition(new THREE.Vector3()) : fallback
  }

  /** A line of beads, used for starch, protein and fat chains. */
  private chain(at: THREE.Vector3, n: number, color: number, step = 0.03): THREE.Mesh[] {
    const beads: THREE.Mesh[] = []
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.013, 14, 10), new THREE.MeshStandardMaterial({ color, roughness: 0.3, emissive: color, emissiveIntensity: 0.25 }))
      m.position.set(at.x + (i - (n - 1) / 2) * step, at.y + Math.sin(i * 1.3) * 0.008, at.z)
      this.temp(m)
      beads.push(m)
    }
    return beads
  }

  /* ---------------- reveal animations ---------------- */
  /** Plays the "what really happens here" animation for a stop. `labels` are the server's answer labels. */
  async playReveal(cpId: string, labels: string[], minMs = 5000): Promise<void> {
    const i = this.lesson.checkpoints.findIndex((c) => c.id === cpId)
    if (i < 0 || this.busy) return
    this.busy = true
    const halo = this.halos[i]
    const a = this.anchors[i]
    const started = performance.now()
    const back = this.viewFor(i)
    // Pull back so the whole body and the action are in view together.
    void this.flyTo(V(0, 0.85, 3.1), V(0, 0.68, 0), 1000)
    try {
      if (halo) void this.animate(700, (k) => ((halo.material as THREE.MeshBasicMaterial).color.setHex(0x66ffaa), ((halo.material as THREE.MeshBasicMaterial).opacity = 0.35 * k)))
      const flavour = labels.filter(Boolean)
      switch (cpId) {
        case 'salivary_glands': await this.animSalivary(a, flavour); break
        case 'mouth': await this.animMouth(a, flavour); break
        case 'esophagus': await this.animSwallow(a); break
        case 'stomach': await this.animStomach(a, flavour); break
        case 'liver': await this.animLiver(a, flavour); break
        case 'pancreas': await this.animPancreas(a, flavour); break
        case 'small_intestine': await this.animIntestinal(a, flavour); break
        case 'villi': await this.animAbsorb(a, flavour); break
        case 'large_intestine': await this.animWater(a, flavour); break
      }
      const left = minMs - (performance.now() - started)
      if (left > 0) await this.wait(left)
    } finally {
      this.clearTemps()
      this.busy = false
    }
    await this.flyTo(back.pos, back.target, 900)
  }

  private async animMouth(a: THREE.Vector3, labels: string[]) {
    const tooth = this.insets.tooth?.group
    const at = V(a.x + 0.16, a.y - 0.03, a.z + 0.14)
    const beads = this.chain(at, 9, 0xf2d04a)
    const base = tooth?.scale.clone()
    for (let n = 0; n < 3; n++) {
      if (tooth && base) await this.animate(180, (k) => tooth.scale.set(base.x * (1 + 0.05 * k), base.y * (1 - 0.1 * k), base.z), easeOut)
      sound.hit()
      if (tooth && base) await this.animate(160, (k) => tooth.scale.set(base.x * (1.05 - 0.05 * k), base.y * (0.9 + 0.1 * k), base.z))
    }
    if (labels[0]) this.label(labels[0], V(at.x, at.y + 0.1, at.z))
    if (labels[1]) this.label(labels[1], V(at.x, at.y + 0.19, at.z))
    sound.fizz(1)
    this.burst(V(at.x, at.y + 0.15, at.z), 26, { color: 0xb8e6ff, size: 0.005, speed: 0.12, life: 1.1, gravity: 0.7, up: -0.2, spread: 0.6 })
    await this.wait(900)
    // the chain is cut and the pieces move apart as smaller sugars
    const pink = new THREE.Color(0xff7ab6)
    await this.animate(1100, (k) => {
      beads.forEach((b, i) => {
        const group = Math.floor(i / 3)
        b.position.x += (group - 1) * 0.0007 * k * 60
        b.position.y += Math.sin(i + k * 6) * 0.0004
        ;(b.material as THREE.MeshStandardMaterial).color.lerp(pink, k * 0.2)
        ;(b.material as THREE.MeshStandardMaterial).emissive.lerp(pink, k * 0.2)
      })
    })
  }

  private async animStomach(a: THREE.Vector3, labels: string[]) {
    const st = this.insets.stomach?.group
    const home = this.insets.stomach?.home ?? V(a.x + 0.6, a.y, a.z + 0.2)
    const base = st?.scale.clone()
    if (labels[0]) this.label(labels[0], V(home.x, home.y + 0.36, home.z))
    this.labelStack(labels.slice(1), V(home.x + 0.3, home.y + 0.1, home.z + 0.1))
    const beads = this.chain(V(home.x, home.y - 0.34, home.z + 0.12), 8, 0xe5484d)
    sound.fizz(1.6)
    for (let n = 0; n < 4; n++) {
      this.burst(V(home.x, home.y, home.z + 0.05), 12, { color: 0xd8ff5a, size: 0.006, speed: 0.22, life: 1.2, gravity: 0.1, up: 0.5, swirl: true })
      if (st && base) await this.animate(420, (k) => st.scale.setScalar(base.x * (1 + 0.07 * Math.sin(k * Math.PI))))
    }
    const white = new THREE.Color(0xfff2f2)
    await this.animate(900, (k) => beads.forEach((b, i) => {
      b.position.x += (i % 2 ? 1 : -1) * 0.0006
      ;(b.material as THREE.MeshStandardMaterial).color.lerp(white, k * 0.15)
    }))
  }

  private async animLiver(a: THREE.Vector3, labels: string[]) {
    const home = this.insets.liver?.home ?? V(a.x - 0.6, a.y, a.z + 0.2)
    const globe = this.temp(new THREE.Mesh(new THREE.SphereGeometry(0.05, 28, 20), new THREE.MeshPhysicalMaterial({ color: 0xffd23f, roughness: 0.15, clearcoat: 1, transmission: 0.1 })))
    globe.position.set(a.x + 0.02, a.y - 0.06, a.z + 0.1)
    if (labels[0]) this.label(labels[0], V(home.x, home.y + 0.33, home.z))
    if (labels[1]) this.label(labels[1], V(a.x + 0.25, a.y + 0.18, a.z + 0.1))
    sound.fizz(1.1)
    this.burst(V(home.x + 0.1, home.y, home.z + 0.1), 24, { color: 0x4ade80, size: 0.006, speed: 0.3, life: 1.2, gravity: -0.1, up: 0.2, spread: 1 })
    this.burst(V(a.x + 0.3, a.y + 0.1, a.z + 0.1), 18, { color: 0xb18cff, size: 0.006, speed: 0.2, life: 1.2, gravity: 0.1, up: 0.2, swirl: true })
    await this.wait(1200)
    // one big fat globule becomes many small ones
    globe.visible = false
    const smalls: THREE.Mesh[] = []
    for (let i = 0; i < 14; i++) {
      const m = this.temp(new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), new THREE.MeshPhysicalMaterial({ color: 0xffd23f, roughness: 0.15, clearcoat: 1 })))
      m.position.copy(globe.position)
      m.userData.v = V((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.08)
      smalls.push(m)
    }
    sound.crack()
    await this.animate(1300, (k) => smalls.forEach((m) => m.position.addScaledVector(m.userData.v as THREE.Vector3, 0.016 * (1 - k))), easeOut)
  }

  private async animSalivary(a: THREE.Vector3, labels: string[]) {
    const ins = this.insets.salivary
    const home = ins?.home ?? V(a.x + 0.6, a.y, a.z + 0.2)
    const parts: [string, string, number][] = [['parotidR', 'Parotid', 0xf6b26b], ['parotidL', 'Parotid', 0xf6b26b], ['submandR', 'Submandibular', 0xf4a261], ['submandL', 'Submandibular', 0xf4a261], ['sublingR', 'Sublingual', 0xf7c984], ['sublingL', 'Sublingual', 0xf7c984]]
    const mouth = this.partAt('salivary', 'mouth', V(home.x, home.y - 0.08, home.z + 0.1))
    sound.fizz(1.2)
    parts.forEach(([key, name, color], i) => {
      const at = this.partAt('salivary', key, home)
      if (i % 2 === 0) this.label(name, V(at.x + (key.endsWith('R') ? -0.15 : 0.15), at.y + 0.05, at.z + 0.12))
      this.burst(at, 10, { color, size: 0.005, speed: 0.1, life: 1.2, gravity: 0, up: 0.1, spread: 0.6 })
    })
    this.labelStack(labels, V(home.x + 0.34, home.y + 0.12, home.z + 0.1))
    // saliva runs down the ducts into the mouth
    for (let n = 0; n < 5; n++) {
      parts.forEach(([key]) => {
        const at = this.partAt('salivary', key, home)
        const m = this.temp(new THREE.Mesh(new THREE.SphereGeometry(0.007, 8, 6), new THREE.MeshBasicMaterial({ color: 0xb8e6ff, transparent: true, opacity: 0.9 })))
        m.position.copy(at)
        m.userData.from = at.clone()
        void this.animate(900, (k) => m.position.lerpVectors(at, mouth, k), easeInOut)
      })
      await this.wait(260)
    }
    await this.wait(700)
  }

  private async animSwallow(a: THREE.Vector3) {
    const i = Math.max(0, this.lesson.checkpoints.findIndex((c) => c.id === 'esophagus'))
    const t0 = Math.max(0, (this.tAt[i] ?? 0) - 0.07)
    const t1 = Math.min(1, (this.tAt[i] ?? 0) + 0.07)
    const bolus = this.temp(new THREE.Mesh(new THREE.SphereGeometry(0.014, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0xff8a1f, emissiveIntensity: 0.5 })))
    const rings = [0, 1, 2].map(() => {
      const r = this.temp(new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.004, 8, 28), new THREE.MeshBasicMaterial({ color: 0xff7ab6, transparent: true, opacity: 0.8 })))
      r.rotation.x = Math.PI / 2
      return r
    })
    this.label('Peristalsis', V(a.x + 0.22, a.y + 0.06, a.z + 0.1))
    this.label('Epiglottis', V(a.x - 0.22, a.y + 0.2, a.z + 0.1))
    sound.whoosh(0.9)
    await this.animate(2600, (k) => {
      const t = t0 + (t1 - t0) * k
      bolus.position.copy(this.path.getPoint(t))
      rings.forEach((r, n) => {
        const tt = Math.min(1, Math.max(0, t - 0.035 + n * 0.0))
        r.position.copy(this.path.getPoint(Math.min(1, tt + 0.018 * (n + 1))))
        r.scale.setScalar(1 + 0.25 * Math.sin(k * 14 - n * 1.2))
      })
    }, easeInOut)
  }

  private async animPancreas(a: THREE.Vector3, labels: string[]) {
    const ins = this.insets.pancreas
    const home = ins?.home ?? V(a.x + 0.7, a.y, a.z + 0.2)
    const base = ins?.group.scale.clone()
    const duct = this.partAt('pancreas', 'head', home)
    const target = V(a.x + 0.02, a.y - 0.03, a.z + 0.06)
    this.labelStack(labels, V(home.x - 0.02, home.y + 0.1, home.z + 0.1))
    const colors = [0xe5484d, 0xf2d04a, 0xffffff, 0x66ccff]
    sound.fizz(1.3)
    for (let n = 0; n < 4; n++) {
      if (ins && base) void this.animate(380, (k) => ins.group.scale.setScalar(base.x * (1 + 0.06 * Math.sin(k * Math.PI))))
      colors.forEach((c, j) => {
        const m = this.temp(new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 8), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.95 })))
        m.position.copy(duct)
        void this.animate(1100 + j * 120, (k) => m.position.lerpVectors(duct, target, k), easeInOut)
      })
      await this.wait(420)
    }
    this.burst(target, 22, { color: 0xb18cff, size: 0.006, speed: 0.18, life: 1.1, gravity: 0.05, up: 0.2, swirl: true })
    await this.wait(900)
  }

  private async animIntestinal(a: THREE.Vector3, labels: string[]) {
    const origin = V(a.x + 0.36, a.y - 0.02, a.z + 0.15)
    const rows: { color: number; to: number }[] = [{ color: 0xf2d04a, to: 0xff7ab6 }, { color: 0xe5484d, to: 0xfff2f2 }, { color: 0xffb02e, to: 0x66ccff }]
    const chains = rows.map((r, n) => this.chain(V(origin.x, origin.y + 0.1 - n * 0.09, origin.z), 8, r.color, 0.028))
    this.labelStack(labels, V(origin.x - 0.3, origin.y + 0.2, origin.z), 0.048, 0.5)
    sound.fizz(1.1)
    this.burst(V(origin.x, origin.y, origin.z + 0.05), 24, { color: 0xffa8c8, size: 0.005, speed: 0.2, life: 1.2, gravity: 0.05, up: 0.3, swirl: true })
    await this.wait(900)
    sound.crack()
    await this.animate(1500, (k) => {
      chains.forEach((beads, n) => beads.forEach((b, i) => {
        b.position.x += (i % 2 ? 1 : -1) * 0.0005 * k * 3
        b.position.y += Math.sin(i + k * 6) * 0.0003
        const m = b.material as THREE.MeshStandardMaterial
        m.color.lerp(new THREE.Color(rows[n].to), k * 0.12)
        m.emissive.lerp(new THREE.Color(rows[n].to), k * 0.12)
      }))
    })
    await this.wait(600)
  }

  private async animAbsorb(a: THREE.Vector3, labels: string[]) {
    const origin = V(a.x + 0.55, a.y - 0.05, a.z + 0.15)
    const villi: THREE.Mesh[] = []
    for (let i = 0; i < 14; i++) {
      const v = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.011, 0.07, 10), new THREE.MeshStandardMaterial({ color: 0xff8da1, roughness: 0.5, emissive: 0xff5577, emissiveIntensity: 0.2 }))
      v.position.set(origin.x + (i - 6.5) * 0.026, origin.y + 0.035, origin.z)
      v.scale.y = 0.01
      this.temp(v)
      villi.push(v)
    }
    const wall = this.temp(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.012, 0.06), new THREE.MeshStandardMaterial({ color: 0xc2415c, roughness: 0.6 })))
    wall.position.set(origin.x, origin.y, origin.z)
    const vessel = this.temp(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.012, 0.012), new THREE.MeshBasicMaterial({ color: 0xff2a2a })))
    vessel.position.set(origin.x, origin.y - 0.025, origin.z)
    this.label(labels[0] ?? 'Villi', V(origin.x, origin.y + 0.2, origin.z))
    await this.animate(900, (k) => villi.forEach((v, i) => ((v.scale.y = Math.min(1, k * 1.4 - i * 0.015)), (v.position.y = origin.y + 0.035 * v.scale.y))), easeOut)
    const colors = [0xffd23f, 0xff7ab6, 0x66ccff, 0x4ade80]
    for (let r = 0; r < 4; r++) {
      colors.forEach((c, i) => this.burst(V(origin.x + (i - 1.5) * 0.08 + (Math.random() - 0.5) * 0.05, origin.y + 0.2, origin.z), 5, { color: c, size: 0.006, speed: 0.1, life: 1.1, gravity: 0.35, up: -0.4, spread: 0.2 }))
      await this.wait(400)
    }
    this.burst(V(origin.x, origin.y - 0.02, origin.z), 16, { color: 0xff6666, size: 0.005, speed: 0.25, life: 1, gravity: 0, up: 0, spread: 1.2 })
    await this.wait(700)
  }

  private async animWater(a: THREE.Vector3, labels: string[]) {
    const waste = this.temp(new THREE.Mesh(new THREE.SphereGeometry(0.06, 24, 18), new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.7 })))
    waste.position.set(a.x + 0.28, a.y, a.z + 0.14)
    if (labels[0]) this.label(labels[0], V(waste.position.x, waste.position.y + 0.14, waste.position.z))
    sound.plop()
    for (let n = 0; n < 6; n++) {
      this.burst(waste.position.clone(), 8, { color: 0x66ccff, size: 0.007, speed: 0.22, life: 0.9, gravity: 0.2, up: 0.2, spread: 1 })
      await this.animate(260, (k) => waste.scale.setScalar(1 - 0.07 * n - 0.07 * k))
    }
    const pellets: THREE.Mesh[] = []
    for (let i = 0; i < 3; i++) {
      const p = this.temp(new THREE.Mesh(new THREE.SphereGeometry(0.02, 14, 10), new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.8 })))
      p.position.set(waste.position.x + (i - 1) * 0.02, waste.position.y, waste.position.z)
      pellets.push(p)
    }
    waste.visible = false
    await this.animate(1100, (k) => pellets.forEach((p, i) => (p.position.y = a.y - k * 0.28 - i * 0.002)), easeInOut)
    sound.plop()
  }

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
    this.camera.fov = w / h < 1 ? 56 : 36
    this.camera.updateProjectionMatrix()
  }

  start() {
    if (this.running) return
    this.running = true
    this.renderer.setAnimationLoop(() => this.frame())
  }

  private frame() {
    if (this.disposed) return
    const dt = Math.min(this.clock.getDelta(), 0.05)
    const time = this.clock.elapsedTime
    for (const tw of [...this.tweens]) if (!tw(dt)) this.tweens.delete(tw)
    this.applyInsets(dt)
    this.controls.update()

    this.halos.forEach((h, i) => {
      const m = h.material as THREE.MeshBasicMaterial
      const target = i === this.activeHalo ? 0.22 + Math.sin(time * 3) * 0.07 : 0
      m.opacity += (target - m.opacity) * Math.min(1, dt * 6)
      if (i !== this.activeHalo && m.opacity < 0.01) m.color.setHex(0x66ccff)
    })

    for (const ins of Object.values(this.insets)) {
      ins.shown += (ins.target - ins.shown) * Math.min(1, dt * 4)
      const s = Math.max(0.001, ins.shown)
      ins.group.visible = ins.shown > 0.01
      // The close-up sways gently so it reads as a 3D object, and bobs on the spot.
      if (this.busy === false || ins.target === 0 || ins.shown < 0.98) ins.group.scale.setScalar(s)
      ins.group.rotation.y = Math.sin(time * 0.6) * 0.5
      ins.group.position.y = ins.home.y + Math.sin(time * 1.4) * 0.01
      ins.light.intensity = ins.shown * 1.6
      const mat = ins.line.material as THREE.LineDashedMaterial
      mat.opacity = ins.shown * 0.5
      const anchorIdx = this.lesson.checkpoints.findIndex((c) => c.detail === ins.key)
      if (anchorIdx >= 0 && this.anchors[anchorIdx]) {
        ins.line.geometry.setFromPoints([this.anchors[anchorIdx], ins.group.position.clone().setY(ins.group.position.y)])
        ins.line.computeLineDistances()
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.life += dt
      if (p.swirl) {
        const r = p.mesh.position.clone().sub(p.swirl.center)
        p.vel.x += -r.z * p.swirl.speed * dt
        p.vel.z += r.x * p.swirl.speed * dt
        p.vel.addScaledVector(r, -2 * dt)
      }
      p.vel.y -= p.gravity * dt
      p.mesh.position.addScaledVector(p.vel, dt)
      ;(p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * Math.max(0, 1 - p.life / p.max)
      if (p.life > p.max) {
        this.scene.remove(p.mesh)
        p.mesh.geometry.dispose()
        ;(p.mesh.material as THREE.Material).dispose()
        this.particles.splice(i, 1)
      }
    }

    this.bolus.scale.setScalar(1 + Math.sin(time * 5) * 0.08)
    if (this.dust) {
      const a = (this.dust.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array
      for (let i = 0; i < a.length; i += 3) {
        a[i + 1] += Math.sin(time * 0.4 + i) * 0.00009
        a[i] += Math.cos(time * 0.3 + i) * 0.00007
      }
      this.dust.geometry.attributes.position.needsUpdate = true
    }
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.disposed = true
    this.renderer.setAnimationLoop(null)
    window.removeEventListener('resize', this.onResize)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.controls.dispose()
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Line) {
        o.geometry.dispose()
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose()
          m.dispose()
        }
      }
    })
    this.renderer.dispose()
  }
}

/* ---------------- models made from shapes ---------------- */

const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.02, ...extra })

/** A lobulated gland: a tube along a curve covered with small rounded lobules. */
function lobulatedGland(curve: THREE.CatmullRomCurve3, radius: (t: number) => number, color: number, lobules = 170): THREE.Group {
  const g = new THREE.Group()
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 1, 24, false), mat(color)))
  const body = g.children[0] as THREE.Mesh
  // Taper the tube to the requested radius along its length.
  const pos = body.geometry.attributes.position as THREE.BufferAttribute
  const seg = 48
  const ring = 25
  for (let i = 0; i <= seg; i++) {
    const t = i / seg
    const c = curve.getPointAt(t)
    for (let j = 0; j < ring; j++) {
      const idx = i * ring + j
      const p = new THREE.Vector3(pos.getX(idx), pos.getY(idx), pos.getZ(idx)).sub(c)
      p.setLength(radius(t))
      pos.setXYZ(idx, c.x + p.x, c.y + p.y, c.z + p.z)
    }
  }
  pos.needsUpdate = true
  body.geometry.computeVertexNormals()
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let n = 0; n < lobules; n++) {
    const t = rnd()
    const c = curve.getPointAt(t)
    const a = rnd() * Math.PI * 2
    const r = radius(t)
    const lobe = new THREE.Mesh(new THREE.SphereGeometry(r * (0.16 + rnd() * 0.16), 10, 8), mat(color, { roughness: 0.8 }))
    lobe.position.set(c.x + Math.cos(a) * r * 0.85, c.y + Math.sin(a) * r * 0.85, c.z + (rnd() - 0.5) * r * 0.7)
    g.add(lobe)
  }
  return g
}

/** Pancreas: head tucked into the C of the duodenum (left of the picture), body, and tail pointing right, with its duct. */
function buildPancreas(): THREE.Group {
  const root = new THREE.Group()
  const curve = new THREE.CatmullRomCurve3([V(-0.42, -0.1, 0), V(-0.26, -0.04, 0), V(-0.04, 0.03, 0), V(0.22, 0.1, 0), V(0.46, 0.2, 0)])
  const radius = (t: number) => 0.13 - 0.085 * t + (t < 0.18 ? 0.02 : 0)
  const gland = lobulatedGland(curve, radius, 0xf0b97a)
  gland.scale.z = 0.7
  root.add(gland)
  const duct = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.012, 8, false), mat(0xfff2c9, { emissive: 0xffe08a, emissiveIntensity: 0.35 }))
  root.add(duct)
  // The duodenum wraps round the head.
  const duo = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 14, 40, Math.PI * 1.35), mat(0xe58a8a, { transparent: true, opacity: 0.85 }))
  duo.position.set(-0.36, -0.04, -0.02)
  duo.rotation.z = Math.PI * 0.25
  root.add(duo)
  const head = new THREE.Object3D()
  head.position.set(-0.42, -0.1, 0.05)
  root.add(head)
  root.userData.parts = { head }
  return root
}

/** Salivary glands: parotid, submandibular and sublingual pairs around a see-through head and tongue. */
function buildSalivaryGlands(): THREE.Group {
  const root = new THREE.Group()
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 24), new THREE.MeshStandardMaterial({ color: 0x9fb8ff, transparent: true, opacity: 0.1, depthWrite: false, roughness: 0.4 }))
  shell.scale.set(1, 1.15, 0.85)
  root.add(shell)
  const tongue = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), mat(0xe5707e))
  tongue.scale.set(1.1, 0.4, 1.3)
  tongue.position.set(0, -0.24, 0.12)
  root.add(tongue)
  const mouth = new THREE.Object3D()
  mouth.position.set(0, -0.2, 0.2)
  const parts: Record<string, THREE.Object3D> = { mouth }
  root.add(mouth)
  const gland = (name: string, side: number, color: number, size: [number, number, number], at: [number, number, number], lobes: number) => {
    const g = new THREE.Group()
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), mat(color))
    body.scale.set(...size)
    g.add(body)
    for (let i = 0; i < lobes; i++) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(size[0] * 0.38, 8, 6), mat(color, { roughness: 0.85 }))
      const a = (i / lobes) * Math.PI * 2
      l.position.set(Math.cos(a) * size[0] * 0.75, Math.sin(a) * size[1] * 0.75, size[2] * 0.3)
      g.add(l)
    }
    g.position.set(at[0] * side, at[1], at[2])
    root.add(g)
    parts[name + (side > 0 ? 'R' : 'L')] = g
    // A thin duct to the mouth.
    const dest = new THREE.Vector3(0.0, -0.2, 0.2)
    const duct = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([g.position.clone(), g.position.clone().lerp(dest, 0.5).add(V(0, -0.04, 0.06)), dest]), 12, 0.006, 6), mat(0xfff2c9, { emissive: 0xffe08a, emissiveIntensity: 0.3 }))
    root.add(duct)
  }
  for (const side of [1, -1]) {
    gland('parotid', side, 0xf6b26b, [0.11, 0.15, 0.08], [0.46, 0.0, -0.02], 6)
    gland('submand', side, 0xf4a261, [0.1, 0.07, 0.07], [0.27, -0.36, 0.06], 5)
    gland('subling', side, 0xf7c984, [0.07, 0.05, 0.05], [0.1, -0.3, 0.16], 4)
  }
  root.userData.parts = parts
  return root
}
