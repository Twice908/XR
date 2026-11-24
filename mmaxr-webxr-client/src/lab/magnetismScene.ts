import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { MotionLessonContract } from '@mmaxr/schema'
import { sound } from './sound'
import { stageSet } from './stage'
import { BoldArrow, type Gauge, type MotionSceneEvents, type SandboxScene } from './motionScene'
import { clipsHeld, countCrossings, fieldAt, fieldLines, flemingForce, forceNewtons, galvo, mag, oerstedDegrees, polesFor, traceLine, type Pole, type V3 } from './magnetPhysics'

/*
 * Three small labs in one scene: magnets and their field lines, electromagnetism, and force & induction.
 * The scene only simulates and draws. It never names an answer: what a result means comes from the server,
 * after the student has watched it.
 */

const MODULE_X: Record<string, number> = { magnets_fields: 0, electromagnetism: 300, force_induction: 600 }
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
type Ease = (t: number) => number
const easeInOut: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const smooth = (a: number, b: number, t: number) => easeInOut(Math.max(0, Math.min(1, (t - a) / (b - a))))
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const f1 = (n: number) => (Math.abs(n) < 0.05 ? '0.0' : n.toFixed(1))
const f2 = (n: number) => (Math.abs(n) < 0.005 ? '0.00' : n.toFixed(2))
const RED = 0xd7263d
const BLUE = 0x2b6cb0
const FIELD_Y = 0.3 // height of the field lines above the table: the middle of the magnet

interface Job {
  update(dt: number): number | null
  done(): void
}

/** A line of points as a glowing tube that can be drawn on progressively. */
class LineTube extends THREE.Mesh {
  private readonly total: number
  constructor(points: V3[], radius: number, c0: number, c1: number) {
    const pts = points.filter((_, i) => i % 2 === 0 || i === points.length - 1).map((p) => V(p[0], p[1], p[2]))
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal')
    const seg = Math.max(8, Math.min(220, pts.length * 2))
    const geo = new THREE.TubeGeometry(curve, seg, radius, 6, false)
    const col = new Float32Array(geo.attributes.position.count * 3)
    const a = new THREE.Color(c0)
    const b = new THREE.Color(c1)
    const tmp = new THREE.Color()
    for (let i = 0; i < geo.attributes.position.count; i++) {
      const ring = Math.floor(i / 7)
      tmp.copy(a).lerp(b, ring / seg)
      col.set([tmp.r, tmp.g, tmp.b], i * 3)
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    super(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }))
    this.total = geo.index ? geo.index.count : 0
    this.curve = curve
    this.renderOrder = 4
  }
  readonly curve: THREE.CatmullRomCurve3
  /** Shows the first `t` (0-1) of the line. */
  reveal(t: number) {
    this.geometry.setDrawRange(0, Math.floor((this.total * Math.max(0, Math.min(1, t))) / 3) * 3)
  }
}

export class MagnetismScene implements SandboxScene {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  private readonly clock = new THREE.Clock()
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2(10, 10)
  private readonly handPoint = new THREE.Vector3(0, 1, 0.5)
  private readonly handPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private groups: Record<string, THREE.Group> = {}
  private moduleId = 'magnets_fields'
  private tweens = new Set<(dt: number) => boolean>()
  private job: Job | null = null
  private lingerLeft: number | null = null
  private resolveJob: (() => void) | null = null
  private flightId = 0
  private insetsPx = { left: 0, right: 0, top: 0, bottom: 0 }
  private insetsTarget = { left: 0, right: 0, top: 0, bottom: 0 }
  private disposed = false
  private running = false
  private gaugeClock = 0
  private compassModel: THREE.Object3D | null = null
  private horseModel: THREE.Object3D | null = null
  private readonly onResize = () => this.resize()
  private lineCache = new Map<string, { group: THREE.Group; tubes: LineTube[]; lines: V3[][] }>()

  // ---- tab 1 ----
  private bar = new THREE.Group()
  private horse = new THREE.Group()
  private bar2 = new THREE.Group()
  private compass1!: Compass
  private fieldArrow = new BoldArrow(0xffd166, 0.05)
  private markA!: THREE.Group
  private markB!: THREE.Group
  private arrowA = new BoldArrow(0xffd166, 0.05)
  private arrowB = new BoldArrow(0xffd166, 0.05)

  // ---- tab 2 ----
  private oersted = new THREE.Group()
  private em = new THREE.Group()
  private compass2!: Compass
  private clipMeshes: THREE.Mesh[] = []
  private flow: THREE.Mesh[] = []
  private lever = new THREE.Group()
  private emFieldGroup: THREE.Group | null = null

  // ---- tab 3 ----
  private rodStation = new THREE.Group()
  private rod!: THREE.Mesh
  private poleN!: THREE.Mesh
  private poleS!: THREE.Mesh
  private arrowI = new BoldArrow(0xff5470, 0.07)
  private arrowB3 = new BoldArrow(0x60a5fa, 0.07)
  private arrowF = new BoldArrow(0x4ade80, 0.09)
  private coilStation = new THREE.Group()
  private coilGroup = new THREE.Group()
  private galvoNeedle = new THREE.Group()
  private magnet3 = new THREE.Group()
  private leads = new THREE.Group()
  private sparkMat: THREE.Material | null = null

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly lesson: MotionLessonContract,
    private readonly events: MotionSceneEvents = {},
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
    for (const id of Object.keys(MODULE_X)) {
      const g = new THREE.Group()
      g.position.x = MODULE_X[id]
      g.visible = id === this.moduleId
      this.groups[id] = g
      scene.add(g)
    }
    this.buildTab1()
    this.buildTab2()
    this.buildTab3()
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

  /* ---------------- small builders ---------------- */
  private label(text: string, color = '#e6edf7', scale = 1): THREE.Sprite {
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 128
    const x = c.getContext('2d')!
    x.fillStyle = 'rgba(8,12,20,0.78)'
    x.beginPath()
    x.roundRect(8, 16, 496, 96, 26)
    x.fill()
    x.fillStyle = color
    x.font = '700 54px system-ui, sans-serif'
    x.textAlign = 'center'
    x.textBaseline = 'middle'
    x.fillText(text, 256, 66)
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }))
    s.scale.set(2.4 * scale, 0.6 * scale, 1)
    return s
  }

  private tube(points: THREE.Vector3[], r: number, color: number, closed = false): THREE.Mesh {
    const curve = new THREE.CatmullRomCurve3(points, closed, 'catmullrom', 0.05)
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(12, points.length * 10), r, 8, closed), new THREE.MeshStandardMaterial({ color, metalness: 0.9, roughness: 0.3 }))
    m.castShadow = true
    return m
  }

  /** A bar magnet `len` long along x with the North half in red at +x (or the other way round). */
  private makeBar(len = 4, flip = false): THREE.Group {
    const g = new THREE.Group()
    const mk = (color: number, x: number, text: string) => {
      const half = new THREE.Mesh(new THREE.BoxGeometry(len / 2, 0.5, 0.9), new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.35 }))
      half.position.set(x, 0.25, 0)
      half.castShadow = true
      half.receiveShadow = true
      const c = document.createElement('canvas')
      c.width = c.height = 128
      const t = c.getContext('2d')!
      t.fillStyle = '#ffffff'
      t.font = '800 100px system-ui, sans-serif'
      t.textAlign = 'center'
      t.textBaseline = 'middle'
      t.fillText(text, 64, 68)
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true }))
      face.rotation.x = -Math.PI / 2
      face.position.set(x, 0.51, 0)
      g.add(half, face)
    }
    mk(flip ? BLUE : RED, len / 4, flip ? 'S' : 'N')
    mk(flip ? RED : BLUE, -len / 4, flip ? 'N' : 'S')
    return g
  }

  private makeCompass(): Compass {
    const c = new Compass(this.compassModel)
    return c
  }

  /* ---------------- tab 1: magnets and field lines ---------------- */
  private buildTab1() {
    const g = this.groups.magnets_fields
    stageSet(g, { cx: 0, cz: 0, w: 30, d: 18, wall: { z: -9.4, h: 12 }, key: [3, 14, 10], aim: [0, 0, 0], keyI: 950, rimI: 170, rimAt: [16, 7, -3], dust: { n: 140, h: 7 } })
    this.bar.add(this.makeBar(4))
    g.add(this.bar)
    // two bars pushed together, North poles facing: each bar centred 2.4 from the middle, North at its inner end
    const a = this.makeBar(3.6, false)
    a.position.x = -2.4
    const b = this.makeBar(3.6, true)
    b.position.x = 2.4
    this.bar2.add(a, b)
    this.bar2.visible = false
    g.add(this.bar2)
    this.horse.visible = false
    g.add(this.horse)
    this.compass1 = this.makeCompass()
    this.compass1.group.position.set(5, 0, 4)
    g.add(this.compass1.group)
    this.fieldArrow.visible = false
    g.add(this.fieldArrow)
    for (const a2 of [this.arrowA, this.arrowB]) {
      a2.visible = false
      g.add(a2)
    }
    this.markA = this.marker('A', 0xff9f43)
    this.markB = this.marker('B', 0x4ade80)
    this.markA.visible = this.markB.visible = false
    g.add(this.markA, this.markB)
  }

  private marker(text: string, color: number): THREE.Group {
    const g = new THREE.Group()
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 16), new THREE.MeshBasicMaterial({ color }))
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.4, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide }))
    ring.rotation.x = -Math.PI / 2
    ring.position.y = -0.2
    const l = this.label(text, '#ffffff', 0.5)
    l.position.y = 0.7
    g.add(ball, ring, l)
    return g
  }

  private placeHorseshoe() {
    this.horse.clear()
    if (this.horseModel) {
      const m = this.horseModel.clone(true)
      const box = new THREE.Box3().setFromObject(m)
      const size = box.getSize(new THREE.Vector3())
      // scale so the magnet is about 3 units across, then stand it so the tips face +z with the poles on the line z = 1.4
      m.scale.multiplyScalar(3.2 / Math.max(size.x, size.z, 1e-6))
      m.rotation.y = HORSE_YAW
      const b2 = new THREE.Box3().setFromObject(m)
      const c = b2.getCenter(new THREE.Vector3())
      m.position.set(-c.x, -b2.min.y, -c.z + HORSE_Z)
      m.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = true
          o.receiveShadow = true
        }
      })
      this.horse.add(m)
    } else {
      // a stand-in: a red U with grey tips
      const arc = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.22, 16, 40, Math.PI), new THREE.MeshStandardMaterial({ color: RED, metalness: 0.5, roughness: 0.35 }))
      arc.rotation.x = Math.PI / 2
      arc.rotation.z = Math.PI
      arc.position.set(0, 0.25, 0.5)
      const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.44, 1.0), new THREE.MeshStandardMaterial({ color: 0xb9c2d0, metalness: 1, roughness: 0.2 }))
      t1.position.set(-0.9, 0.25, 1.4)
      const t2 = t1.clone()
      t2.position.x = 0.9
      this.horse.add(arc, t1, t2)
    }
    for (const [x, t, c] of [[-0.9, 'N', RED], [0.9, 'S', BLUE]] as const) {
      const l = this.label(t, c === RED ? '#ff8aa0' : '#8fc3ff', 0.55)
      l.position.set(x, 1.3, 1.6)
      this.horse.add(l)
    }
  }

  /** Shows one magnet and its field lines (built once, then cached). */
  private setMagnet(kind: string, withLines = true): { poles: Pole[]; lines: V3[][]; tubes: LineTube[] } {
    const g = this.groups.magnets_fields
    this.bar.visible = kind === 'bar'
    this.bar2.visible = kind === 'two_nn'
    this.horse.visible = kind === 'horseshoe'
    if (kind === 'horseshoe' && this.horse.children.length === 0) this.placeHorseshoe()
    for (const e of this.lineCache.values()) e.group.visible = false
    const poles = polesFor(kind)
    let entry = this.lineCache.get(kind)
    if (!entry) {
      const group = new THREE.Group()
      const lines = fieldLines(poles, kind === 'two_nn' ? 8 : 12)
      const tubes: LineTube[] = []
      const lift = (p: V3): V3 => [p[0], p[1] + FIELD_Y, p[2]]
      const add = (pts: V3[], dy = 0, rotX = 0, opacity = 0.9) => {
        const t = new LineTube(pts.map((p) => lift([p[0], p[1] + dy, p[2]])), 0.03, 0xff7a6b, 0x6bb6ff)
        ;(t.material as THREE.MeshBasicMaterial).opacity = opacity
        if (rotX) {
          const holder = new THREE.Group()
          holder.rotation.x = rotX
          holder.add(t)
          group.add(holder)
        } else group.add(t)
        tubes.push(t)
        // an arrowhead part-way along, pointing North to South
        const at = t.curve.getPointAt(0.42)
        const tan = t.curve.getTangentAt(0.42)
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: opacity }))
        cone.position.copy(at)
        cone.quaternion.setFromUnitVectors(V(0, 1, 0), tan)
        if (rotX) {
          const holder = group.children[group.children.length - 1] as THREE.Group
          holder.add(cone)
        } else group.add(cone)
      }
      for (const pts of lines) add(pts)
      if (kind === 'bar') {
        // the same field seen in other planes through the magnet's axis, so it reads as a 3D shell
        for (const rx of [Math.PI / 3, (2 * Math.PI) / 3]) for (const pts of lines.filter((_, i) => i % 2 === 0)) add(pts, 0, rx, 0.45)
        // through the magnet itself, South to North, so every line closes into a loop
        const inner = new LineTube([[-1.8, 0, 0], [0, 0, 0], [1.8, 0, 0]], 0.03, 0x6bb6ff, 0xff7a6b)
        group.add(inner)
        tubes.push(inner)
      }
      if (kind === 'horseshoe') for (const dy of [-0.3, 0.3]) for (const pts of lines.filter((_, i) => i % 3 === 0)) add(pts, dy, 0, 0.35)
      g.add(group)
      entry = { group, tubes, lines }
      this.lineCache.set(kind, entry)
    }
    // before a run the lines stay hidden: they carry arrows, which would answer the question
    entry.group.visible = withLines
    for (const t of entry.tubes) t.reveal(1)
    return { poles, lines: entry.lines, tubes: entry.tubes }
  }

  /* ---------------- tab 2: electromagnetism ---------------- */
  private buildTab2() {
    const g = this.groups.electromagnetism
    stageSet(g, { cx: 0, cz: 0, w: 28, d: 16, wall: { z: -8.4, h: 11 }, key: [3, 13, 9], aim: [0, 0, 0], keyI: 900, rimI: 160, rimAt: [14, 7, -3], dust: { n: 140, h: 6 } })
    g.add(this.oersted, this.em)
    this.compass2 = this.makeCompass()
    this.compass2.group.position.set(0, 0, 0)
    g.add(this.compass2.group)
    // switch: a base and a lever that closes when the experiment starts
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.5), new THREE.MeshStandardMaterial({ color: 0x2c313c, metalness: 0.6, roughness: 0.4 }))
    base.position.y = 0.09
    this.lever.add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.07, 0.1), new THREE.MeshStandardMaterial({ color: 0xffb347, metalness: 0.9, roughness: 0.2 })))
    this.lever.children[0].position.x = 0.4
    this.lever.position.set(-0.4, 0.22, 0)
    const sw = new THREE.Group()
    sw.add(base, this.lever)
    sw.name = 'switch'
    sw.position.set(4.2, 0, 5.2)
    this.oersted.add(sw)
  }

  private battery(x: number, z0: number, z1: number, plusAtZ1: boolean): THREE.Group {
    const g = new THREE.Group()
    const len = Math.abs(z1 - z0)
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, len, 28), new THREE.MeshStandardMaterial({ color: 0x1f6f5c, metalness: 0.6, roughness: 0.35 }))
    body.rotation.x = Math.PI / 2
    body.castShadow = true
    const mid = (z0 + z1) / 2
    g.add(body)
    const cap = (z: number, text: string, color: number) => {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.18, 20), new THREE.MeshStandardMaterial({ color: 0xd9b25f, metalness: 1, roughness: 0.25 }))
      c.rotation.x = Math.PI / 2
      c.position.z = z - mid
      const l = this.label(text, color === RED ? '#ff8aa0' : '#9fd0ff', 0.45)
      l.position.set(0, 0.95, z - mid)
      g.add(c, l)
    }
    cap(plusAtZ1 ? z1 : z0, '+', RED)
    cap(plusAtZ1 ? z0 : z1, '−', BLUE)
    g.position.set(x, 0.55, mid)
    return g
  }

  /** The circuit for the Oersted run: battery, switch, and the wire passing over (or under) the compass. */
  private buildOersted(p: { current: number; amps: number; placement: string; wire: string; distance: number }) {
    this.oersted.children.filter((c) => c.name !== 'switch').forEach((c) => this.oersted.remove(c))
    const north = p.current >= 0
    const wy = p.placement === 'under' ? 0.45 + p.distance * 0.28 : 0.5
    const root = new THREE.Group()
    const pts = [V(5, 0.55, 5), V(0, wy, 5), V(0, wy, -5), V(5, 0.55, -5)]
    const wire = this.tube([V(5, 0.55, 1.8), V(5, 0.55, 5), V(2, wy, 5), V(0, wy, 5)], 0.06, 0xc97a3d)
    const straight = this.tube([V(0, wy, 5), V(0, wy, 0), V(0, wy, -5)], 0.075, 0xe39b5b)
    const back = this.tube([V(0, wy, -5), V(2, wy, -5), V(5, 0.55, -5), V(5, 0.55, -1.8)], 0.06, 0xc97a3d)
    root.add(wire, straight, back)
    root.add(this.battery(5, -1.8, 1.8, north))
    // marks showing which way the current flows, drifting along the wire
    this.flow = []
    const path = new THREE.CatmullRomCurve3([...pts.slice(0, 3), pts[3]], false, 'catmullrom', 0.2)
    for (let i = 0; i < 12; i++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.28, 12), new THREE.MeshBasicMaterial({ color: 0xffd166 }))
      cone.userData.u = i / 12
      cone.userData.path = path
      cone.visible = false
      root.add(cone)
      this.flow.push(cone)
    }
    // the compass sits under the wire on the table, or on a stand above it
    const cy = p.placement === 'over' ? wy + 0.7 : 0
    this.compass2.group.position.set(0, cy, 0)
    if (p.placement === 'over') {
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.12, 36), new THREE.MeshStandardMaterial({ color: 0x3a4252, roughness: 0.5 }))
      stand.position.set(0, cy - 0.08, 0)
      root.add(stand)
    }
    const info = this.label(p.placement === 'over' ? 'Wire below compass' : 'Wire above compass', '#ffd9a0', 0.8)
    info.position.set(0, 3.4, 0)
    root.add(info)
    if (p.wire === 'ew') root.rotation.y = Math.PI / 2
    this.oersted.add(root)
    const sw = this.oersted.getObjectByName('switch')
    if (sw) {
      sw.position.set(4.2, 0, p.wire === 'ew' ? 0 : 5.2)
      if (p.wire === 'ew') sw.position.set(5.2, 0, -4.2)
      sw.rotation.y = p.wire === 'ew' ? Math.PI / 2 : 0
    }
  }

  private buildEm(p: { turns: number; current: number; core: string }) {
    this.em.clear()
    this.clipMeshes = []
    this.emFieldGroup = null
    const iron = new THREE.MeshStandardMaterial({ color: 0x9aa3b2, metalness: 1, roughness: 0.28 })
    if (p.core === 'iron') {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 3.1, 24), iron)
      shaft.position.set(0, 2.45, 0)
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.14, 24), iron)
      head.position.set(0, 4.05, 0)
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.2, 24), iron)
      tip.rotation.x = Math.PI
      tip.position.set(0, 0.8, 0)
      shaft.castShadow = head.castShadow = true
      this.em.add(shaft, head, tip)
    }
    // the coil: wire wound round the nail, one visible loop for every 4 turns
    const loops = Math.max(3, Math.round(p.turns / 4))
    const pts: THREE.Vector3[] = []
    const y0 = 1.3
    const y1 = 3.5
    const steps = loops * 24
    for (let i = 0; i <= steps; i++) {
      const a = (i / 24) * Math.PI * 2
      pts.push(V(Math.cos(a) * 0.26, y0 + ((y1 - y0) * i) / steps, Math.sin(a) * 0.26))
    }
    const coil = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), steps * 2, 0.04, 6, false), new THREE.MeshStandardMaterial({ color: 0xc97a3d, metalness: 0.9, roughness: 0.3 }))
    coil.castShadow = true
    this.em.add(coil)
    // leads to a battery on the right
    const lead1 = this.tube([V(0.26, y0, 0), V(1.5, 0.9, 0.6), V(3.4, 0.55, 1.6), V(4.4, 0.55, 2.2)], 0.05, 0xc97a3d)
    const lead2 = this.tube([V(0.26, y1, 0), V(1.8, 3.9, 0.6), V(4.4, 1.6, 2.4), V(4.6, 0.55, 2.7)], 0.05, 0xc97a3d)
    this.em.add(lead1, lead2)
    const bat = this.battery(4.9, 1.6, 4.4, true)
    bat.rotation.y = 0
    this.em.add(bat)
    // a little pile of paper clips on the table around the tip
    const clipGeo = new THREE.BoxGeometry(0.5, 0.05, 0.16)
    const clipMat = new THREE.MeshStandardMaterial({ color: 0xcfd6e2, metalness: 1, roughness: 0.25 })
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 + (i % 3) * 0.4
      const r = 0.9 + (i % 4) * 0.28
      const m = new THREE.Mesh(clipGeo, clipMat)
      m.position.set(Math.cos(a) * r, 0.05, Math.sin(a) * r)
      m.rotation.y = a * 2.3
      m.userData.home = m.position.clone()
      m.userData.homeRot = m.rotation.y
      m.castShadow = true
      this.em.add(m)
      this.clipMeshes.push(m)
    }
    const l = this.label(`${p.turns} turns · ${f1(p.current)} A`, '#ffd9a0', 0.8)
    l.position.set(0, 4.8, 0)
    this.em.add(l)
    // the field of the electromagnet, drawn when the current flows
    const poles: Pole[] = [{ p: [0, 0.75, 0], q: 1 }, { p: [0, 3.9, 0], q: -1 }]
    const grp = new THREE.Group()
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      const seed: V3 = [0.55 * Math.cos(a), 0.7, 0.55 * Math.sin(a)]
      const line = traceLine(poles, seed, 1, 0.14, 400, 9)
      const t = new LineTube(line.map((q) => [q[0], q[1] - 0.0, q[2]] as V3), 0.018, 0xff7a6b, 0x6bb6ff)
      grp.add(t)
    }
    grp.visible = false
    this.emFieldGroup = grp
    this.em.add(grp)
  }

  /* ---------------- tab 3: force and induction ---------------- */
  private buildTab3() {
    const g = this.groups.force_induction
    stageSet(g, { cx: 1, cz: 0, w: 34, d: 14, wall: { z: -7.4, h: 11 }, key: [4, 14, 10], aim: [1, 0, 0], keyI: 1000, rimI: 180, rimAt: [17, 7, -3], dust: { n: 160, h: 7 } })
    // --- the rod between the poles ---
    const RX = -5
    this.rodStation.position.set(RX, 1.6, 0)
    g.add(this.rodStation)
    this.rod = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 2.6, 20), new THREE.MeshStandardMaterial({ color: 0xd9a35f, metalness: 1, roughness: 0.2 }))
    this.rod.castShadow = true
    const poleMat = (c: number) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.4, roughness: 0.4, transparent: true, opacity: 0.42 })
    this.poleN = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.9, 1.9), poleMat(RED))
    this.poleS = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.9, 1.9), poleMat(BLUE))
    const nl = this.label('N', '#ff8aa0', 0.6)
    const sl = this.label('S', '#8fc3ff', 0.6)
    this.poleN.add(nl)
    this.poleS.add(sl)
    this.rodStation.add(this.rod, this.poleN, this.poleS)
    for (const a of [this.arrowI, this.arrowB3, this.arrowF]) {
      a.visible = false
      this.rodStation.add(a)
    }
    // legend for the screen directions
    const lg = new THREE.Group()
    lg.position.set(RX - 3.6, -1.1, 1)
    for (const [dir, text] of [[V(1, 0, 0), 'right'], [V(0, 1, 0), 'up'], [V(0, 0, 1), 'out of screen']] as const) {
      const a = new BoldArrow(0x9aa3b2, 0.025)
      a.setDirection(dir)
      a.setLength(0.9, 0.2, 0.16)
      const l = this.label(text, '#cbd5e1', 0.38)
      l.position.copy(dir.clone().multiplyScalar(1.3))
      lg.add(a, l)
    }
    g.add(lg)
    // --- the coil, galvanometer and moving magnet ---
    const CX = 6
    this.coilStation.position.set(CX, 1.5, 0)
    g.add(this.coilStation)
    this.coilStation.add(this.coilGroup, this.magnet3, this.leads)
    this.magnet3.visible = false
    const dial = new THREE.Group()
    dial.position.set(DIAL_X, 0.2, 0)
    const face = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.14, 48), new THREE.MeshStandardMaterial({ color: 0xf3efe2, roughness: 0.6 }))
    face.rotation.x = Math.PI / 2
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.08, 12, 48), new THREE.MeshStandardMaterial({ color: 0x3a4252, metalness: 0.8, roughness: 0.3 }))
    dial.add(face, rim)
    for (let i = -5; i <= 5; i++) {
      const a = (i / 5) * 55 * (Math.PI / 180)
      const tick = new THREE.Mesh(new THREE.BoxGeometry(i === 0 ? 0.06 : 0.035, i % 5 === 0 ? 0.3 : 0.18, 0.02), new THREE.MeshBasicMaterial({ color: 0x1a1a1a }))
      tick.position.set(Math.sin(a) * 0.9, -0.35 + Math.cos(a) * 0.9, 0.09)
      tick.rotation.z = -a
      dial.add(tick)
    }
    const zero = this.label('0', '#1a1a1a', 0.3)
    zero.position.set(0, 0.85, 0.12)
    dial.add(zero)
    this.galvoNeedle.position.set(0, -0.35, 0.12)
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.15, 0.03), new THREE.MeshBasicMaterial({ color: 0xd7263d }))
    needle.position.y = 0.55
    this.galvoNeedle.add(needle)
    dial.add(this.galvoNeedle)
    const gl = this.label('Galvanometer', '#e6edf7', 0.55)
    gl.position.set(0, 1.7, 0)
    dial.add(gl)
    this.coilStation.add(dial)
  }

  /** The two wires from the coil to the galvanometer; rebuilt when the coil itself moves. */
  private setLeads(coilX: number, len = 2.6) {
    this.leads.clear()
    // the left wire runs round behind the coil so it never crosses the magnet
    this.leads.add(this.tube([V(coilX - len / 2, 0.85, 0), V(coilX - len / 2 - 0.2, 0.5, -1.5), V(DIAL_X - 1.5, -0.15, -1.5), V(DIAL_X - 0.5, -0.15, 0.2)], 0.04, 0xc97a3d))
    this.leads.add(this.tube([V(coilX + len / 2, 0.85, 0), V(coilX + len / 2 + 0.2, 0.2, 0.9), V(DIAL_X + 0.5, -0.15, 0.4)], 0.04, 0xc97a3d))
  }

  private buildInduction(turns: number, northLeads: boolean) {
    this.coilGroup.clear()
    const loops = Math.max(4, Math.round(turns / 8))
    const len = 2.6
    const pts: THREE.Vector3[] = []
    const steps = loops * 28
    for (let i = 0; i <= steps; i++) {
      const a = (i / 28) * Math.PI * 2
      pts.push(V(-len / 2 + (len * i) / steps, Math.cos(a) * 0.85, Math.sin(a) * 0.85))
    }
    const coil = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), steps * 2, 0.045, 6, false), new THREE.MeshStandardMaterial({ color: 0xc97a3d, metalness: 0.9, roughness: 0.3 }))
    coil.castShadow = true
    this.coilGroup.add(coil)
    this.coilGroup.position.x = COIL_X
    this.setLeads(COIL_X, len)
    const l = this.label(`${turns} turns`, '#ffd9a0', 0.7)
    l.position.set(0, 1.55, 0)
    this.coilGroup.add(l)
    this.magnet3.clear()
    const bar = this.makeBar(2.4, !northLeads)
    // makeBar puts North at +x; the nose of the magnet moves towards +x, so a South-leading run flips the colours
    bar.position.y = -0.25
    bar.scale.set(1, 1, 1)
    this.magnet3.add(bar)
    const lab = this.label(northLeads ? 'North pole leads' : 'South pole leads', northLeads ? '#ff8aa0' : '#8fc3ff', 0.6)
    lab.position.set(0, 1.0, 0)
    this.magnet3.add(lab)
  }

  /* ---------------- loading ---------------- */
  async load(): Promise<void> {
    const loader = new GLTFLoader()
    const a = this.lesson.assets
    const urls = [a.compass, a.horseshoe, a.teslaCoil].filter(Boolean)
    let done = 0
    const get = async (url: string | undefined) => {
      if (!url) return null
      const r = await loader.loadAsync(url).then((x) => x.scene).catch((err) => {
        console.warn('[magnetism] model failed to load, using a stand-in', url, err)
        return null
      })
      this.events.onProgress?.(++done, urls.length)
      return r
    }
    const [compass, horse, tesla] = await Promise.all([get(a.compass), get(a.horseshoe), get(a.teslaCoil)])
    if (this.disposed) return
    this.compassModel = compass
    this.horseModel = horse
    // the compass models were loaded after the scene was built, so dress the two compasses now
    this.compass1.dress(compass)
    this.compass2.dress(compass)
    if (tesla) this.placeTesla(tesla)
    this.horse.clear()
  }

  private placeTesla(model: THREE.Object3D) {
    const m = model.clone(true)
    const box = new THREE.Box3().setFromObject(m)
    const size = box.getSize(new THREE.Vector3())
    m.scale.multiplyScalar(3.4 / Math.max(size.y, 1e-6))
    const b2 = new THREE.Box3().setFromObject(m)
    const c = b2.getCenter(new THREE.Vector3())
    m.position.set(-c.x + 12.5, -b2.min.y, -c.z - 3.2)
    m.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true
        if (/glow/i.test(o.name) || /glow/i.test((o.material as THREE.Material).name)) this.sparkMat = o.material as THREE.Material
      }
    })
    this.groups.force_induction.add(m)
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
  private flyTo(pos: THREE.Vector3, target: THREE.Vector3, ms = 1400): Promise<void> {
    const id = ++this.flightId
    const p0 = this.camera.position.clone()
    const t0 = this.controls.target.clone()
    return this.animate(ms, (k) => {
      if (id !== this.flightId) return
      this.camera.position.lerpVectors(p0, pos, k)
      this.controls.target.lerpVectors(t0, target, k)
    }, easeInOut)
  }
  private view(name: string): { pos: THREE.Vector3; target: THREE.Vector3 } {
    const X2 = MODULE_X.electromagnetism
    const X3 = MODULE_X.force_induction
    switch (name) {
      case 'm1':
        return { pos: V(0, 11, 12.5), target: V(0, 0, 0.5) }
      case 'm1h':
        return { pos: V(0, 8.5, 9.5), target: V(0, 0, 0.8) }
      case 'oersted':
        return { pos: V(X2 + 2.4, 4.6, 8.6), target: V(X2 + 1.2, 0.5, 0) }
      case 'em':
        return { pos: V(X2 + 1.5, 4.4, 9), target: V(X2 + 0.4, 2.2, 0) }
      case 'fleming':
        return { pos: V(X3 - 2.2, 3.4, 10.5), target: V(X3 - 5, 1.6, 0) }
      case 'induction':
        return { pos: V(X3 + 7.2, 3.6, 10.2), target: V(X3 + 7.2, 1.5, 0) }
      case 'f3':
        return { pos: V(X3 + 1.5, 6, 17), target: V(X3 + 0.5, 1.2, 0) }
      case 'e2':
        return { pos: V(X2 + 1.5, 6.5, 14), target: V(X2, 1.4, 0) }
      default:
        return { pos: V(0, 11, 12.5), target: V(0, 0, 0.5) }
    }
  }

  async goto(moduleId: string, instant = false): Promise<void> {
    this.abort()
    this.moduleId = moduleId
    for (const [id, g] of Object.entries(this.groups)) g.visible = id === moduleId
    this.events.onGauges?.(null)
    this.events.onNote?.(null)
    const v = this.view(moduleId === 'magnets_fields' ? 'm1' : moduleId === 'electromagnetism' ? 'e2' : 'f3')
    if (moduleId === 'magnets_fields') {
      this.setMagnet('bar', false)
      this.compass1.group.visible = true
    }
    if (moduleId === 'electromagnetism') this.resetTab2()
    if (instant) {
      this.camera.position.copy(v.pos)
      this.controls.target.copy(v.target)
    } else await this.flyTo(v.pos, v.target)
  }

  private resetTab2() {
    this.oersted.visible = false
    this.em.visible = false
    this.compass2.group.visible = false
  }

  /* ---------------- jobs ---------------- */
  private abort() {
    this.job?.done()
    this.job = null
    this.lingerLeft = null
    this.resolveJob?.()
    this.resolveJob = null
  }
  private begin(job: Job): Promise<void> {
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
  private emitGauges(dt: number, g: () => Gauge[], force = false) {
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
    this.fieldArrow.visible = false
    this.arrowA.visible = this.arrowB.visible = false
    this.markA.visible = this.markB.visible = false
  }

  /** Sets the table for a question before it is answered, without running it. */
  stage(action: string, params: Record<string, unknown> = {}) {
    if (this.busy) return
    switch (action) {
      case 'compass_probe':
      case 'field_lines':
      case 'field_strength': {
        const kind = String(params.magnet ?? 'bar')
        this.setMagnet(kind, false)
        this.fieldArrow.visible = this.arrowA.visible = this.arrowB.visible = this.markA.visible = this.markB.visible = false
        this.compass1.group.visible = action !== 'field_lines'
        if (action === 'compass_probe') {
          this.compass1.group.position.set(num(params.x, 4.5), 0, num(params.z, 0))
          this.compass1.setNeedle(Math.PI / 2)
        }
        const v = this.view(kind === 'horseshoe' ? 'm1h' : 'm1')
        void this.flyTo(v.pos, v.target, 900)
        break
      }
      case 'oersted': {
        this.resetTab2()
        this.buildOersted({ current: num(params.current, 1), amps: num(params.amps, 3), placement: String(params.placement ?? 'under'), wire: String(params.wire ?? 'ns'), distance: num(params.distance, 3) })
        this.oersted.visible = true
        this.compass2.group.visible = true
        this.compass2.setNeedle(Math.PI / 2)
        for (const c of this.flow) c.visible = false
        const v = this.view('oersted')
        void this.flyTo(v.pos, v.target, 900)
        break
      }
      case 'electromagnet': {
        this.resetTab2()
        this.buildEm({ turns: num(params.turns, 20), current: num(params.current, 1.5), core: String(params.core ?? 'iron') })
        this.em.visible = true
        const polarity = params.mode === 'polarity'
        this.compass2.group.visible = polarity
        this.compass2.group.position.set(2.1, 0, 0.6)
        this.compass2.setNeedle(Math.PI / 2)
        const v = this.view('em')
        void this.flyTo(v.pos, v.target, 900)
        break
      }
      case 'fleming': {
        this.setupFleming({ current: (params.current as V3) ?? [0, 1, 0], field: (params.field as V3) ?? [1, 0, 0], B: num(params.B, 0.5), I: num(params.I, 4), L: num(params.L, 0.3) })
        const v = this.view('fleming')
        void this.flyTo(v.pos, v.target, 900)
        break
      }
      case 'induction': {
        const north = String(params.pole ?? 'N') !== 'S'
        this.buildInduction(num(params.turns, 40), north)
        this.magnet3.visible = true
        this.magnet3.position.x = COIL_X - 5 - 1.2
        const v = this.view('induction')
        void this.flyTo(v.pos, v.target, 900)
        break
      }
      default:
    }
  }

  async run(action: string, params: Record<string, unknown> = {}): Promise<void> {
    this.events.onNote?.(null)
    switch (action) {
      case 'compass_probe':
        return this.runProbe(String(params.magnet ?? 'bar'), num(params.x, 4.5), num(params.z, 0))
      case 'field_lines':
        return this.runLines(String(params.magnet ?? 'bar'))
      case 'field_strength':
        return this.runStrength(String(params.magnet ?? 'bar'), [num(params.ax, 2.6), num(params.az, 0)], [num(params.bx, 0), num(params.bz, 1.6)])
      case 'oersted':
        return this.runOersted({ current: num(params.current, 1), amps: num(params.amps, 3), placement: String(params.placement ?? 'under'), wire: String(params.wire ?? 'ns'), distance: num(params.distance, 3) })
      case 'electromagnet':
        return this.runEm({ turns: num(params.turns, 20), current: num(params.current, 1.5), core: String(params.core ?? 'iron'), mode: String(params.mode ?? 'on') })
      case 'fleming':
        return this.runFleming({ current: (params.current as V3) ?? [0, 1, 0], field: (params.field as V3) ?? [1, 0, 0], B: num(params.B, 0.5), I: num(params.I, 4), L: num(params.L, 0.3) })
      case 'induction':
        return this.runInduction({ motion: String(params.motion ?? 'in'), speed: num(params.speed, 1), pole: String(params.pole ?? 'N'), turns: num(params.turns, 40) })
      default:
    }
  }

  /* ---- tab 1 ---- */
  private async runProbe(kind: string, x: number, z: number): Promise<void> {
    this.abort()
    const { poles, tubes } = this.setMagnet(kind)
    for (const t of tubes) t.reveal(0)
    this.fieldArrow.visible = false
    this.arrowA.visible = this.arrowB.visible = this.markA.visible = this.markB.visible = false
    const v = this.view(kind === 'horseshoe' ? 'm1h' : 'm1')
    this.compass1.group.visible = true
    this.compass1.setNeedle(Math.PI / 2) // North, away from the viewer
    await this.flyTo(v.pos, v.target, 1100)
    if (this.disposed) return
    const from = this.compass1.group.position.clone()
    await this.animate(1300, (k) => this.compass1.group.position.set(from.x + (x - from.x) * k, 0, from.z + (z - from.z) * k), easeInOut)
    if (this.disposed) return
    const b = fieldAt(poles, [x, 0, z])
    const heading = Math.atan2(-b[2], b[0])
    const strength = mag(b)
    const st = { t: 0 }
    const start = Math.PI / 2
    return this.begin({
      update: (dt) => {
        st.t += dt
        // the needle swings past, then settles: a damped oscillation
        tubes.forEach((t, i) => t.reveal((st.t - (i % 6) * 0.1) / 2))
        const swing = Math.exp(-st.t * 2.2) * Math.cos(st.t * 9)
        let d = heading - start
        d = Math.atan2(Math.sin(d), Math.cos(d))
        this.compass1.setNeedle(heading - d * swing)
        const len = 0.8 + Math.min(2.2, strength * 14)
        this.fieldArrow.visible = st.t > 0.8
        this.fieldArrow.position.set(x, 0.75, z)
        this.fieldArrow.setDirection(V(b[0], 0, b[2]).normalize())
        this.fieldArrow.setLength(len, 0.35, 0.28)
        const deg = ((((heading * 180) / Math.PI) % 360) + 360) % 360
        this.emitGauges(dt, () => [
          { label: 'Compass at', value: `(${f1(x)}, ${f1(z)})` },
          { label: 'Field strength', value: `${f2(strength * 100)} a.u.`, tone: 'info' },
          { label: 'Needle heading', value: `${Math.round(deg)}°` },
        ])
        if (st.t > 3.2) return 600
        return null
      },
      done: () => undefined,
    })
  }

  private async runLines(kind: string): Promise<void> {
    this.abort()
    const v = this.view(kind === 'horseshoe' ? 'm1h' : 'm1')
    this.compass1.group.visible = false
    this.fieldArrow.visible = false
    this.arrowA.visible = this.arrowB.visible = this.markA.visible = this.markB.visible = false
    const { lines, tubes } = this.setMagnet(kind)
    for (const t of tubes) t.reveal(0)
    await this.flyTo(v.pos, v.target, 1100)
    if (this.disposed) return
    const crossings = countCrossings(lines)
    const st = { t: 0 }
    sound.whoosh(1)
    return this.begin({
      update: (dt) => {
        st.t += dt
        tubes.forEach((t, i) => t.reveal((st.t - (i % 6) * 0.12) / 2.2))
        const drawn = Math.min(lines.length, Math.floor((st.t / 2.8) * lines.length))
        this.emitGauges(dt, () => [
          { label: 'Field lines drawn', value: String(drawn), tone: 'info' },
          { label: 'Crossings found', value: st.t > 3 ? String(crossings) : '…', tone: st.t > 3 ? 'ok' : undefined },
        ])
        if (st.t > 3.1 && st.t < 3.2) this.events.onNote?.('No two field lines cross, anywhere. Each point has just one direction.')
        if (st.t > 4.6) {
          this.compass1.group.visible = true
          return 500
        }
        return null
      },
      done: () => {
        this.compass1.group.visible = true
      },
    })
  }

  private async runStrength(kind: string, A: [number, number], B: [number, number]): Promise<void> {
    this.abort()
    const { poles, tubes } = this.setMagnet(kind)
    for (const t of tubes) t.reveal(0.0001)
    const v = this.view(kind === 'horseshoe' ? 'm1h' : 'm1')
    this.compass1.group.visible = false
    this.fieldArrow.visible = false
    await this.flyTo(v.pos, v.target, 1100)
    if (this.disposed) return
    const bA = fieldAt(poles, [A[0], 0, A[1]])
    const bB = fieldAt(poles, [B[0], 0, B[1]])
    const mA = mag(bA)
    const mB = mag(bB)
    this.markA.position.set(A[0], 0.45, A[1])
    this.markB.position.set(B[0], 0.45, B[1])
    this.markA.visible = this.markB.visible = true
    const st = { t: 0 }
    return this.begin({
      update: (dt) => {
        st.t += dt
        const k = smooth(0.6, 1.8, st.t)
        tubes.forEach((t, i) => t.reveal((st.t - (i % 6) * 0.1) / 2))
        for (const [arrow, p, b, m] of [[this.arrowA, A, bA, mA], [this.arrowB, B, bB, mB]] as const) {
          arrow.visible = k > 0
          arrow.position.set(p[0], 0.75, p[1])
          arrow.setDirection(V(b[0], 0, b[2]).normalize())
          arrow.setLength(Math.max(0.05, k * (0.3 + Math.min(3.2, m * 18))), 0.3, 0.25)
        }
        this.emitGauges(dt, () => [
          { label: 'Field at A', value: `${f2(mA * 100)} a.u.`, tone: 'warn' },
          { label: 'Field at B', value: `${f2(mB * 100)} a.u.`, tone: 'ok' },
          { label: 'Ratio', value: `${f1(Math.max(mA, mB) / Math.min(mA, mB))} × ${mA > mB ? 'A' : 'B'} stronger` },
        ])
        if (st.t > 4.4) return 500
        return null
      },
      done: () => {
        this.arrowA.visible = this.arrowB.visible = false
      },
    })
  }

  /* ---- tab 2 ---- */
  private async runOersted(p: { current: number; amps: number; placement: string; wire: string; distance: number }): Promise<void> {
    this.abort()
    this.resetTab2()
    this.buildOersted(p)
    this.oersted.visible = true
    this.compass2.group.visible = true
    this.compass2.setNeedle(Math.PI / 2)
    const v = this.view('oersted')
    await this.flyTo(v.pos, v.target, 1200)
    if (this.disposed) return
    const final = oerstedDegrees(p) // + East
    const st = { t: 0 }
    const sw = this.oersted.getObjectByName('switch')
    void sw
    return this.begin({
      update: (dt) => {
        st.t += dt
        const on = st.t > 0.8
        this.lever.rotation.z = on ? 0 : 0.5 * (1 - smooth(0.4, 0.8, st.t)) // closes at 0.8 s
        if (on && st.t < 0.9) sound.click()
        const k = on ? 1 - Math.exp(-(st.t - 0.8) * 2.4) * Math.cos((st.t - 0.8) * 8) : 0
        const delta = ((final * k) * Math.PI) / 180
        // North is -z: the needle points (sin d, 0, -cos d)
        this.compass2.setNeedle(Math.atan2(Math.cos(delta), Math.sin(delta)))
        for (const c of this.flow) {
          c.visible = on
          const path = c.userData.path as THREE.CatmullRomCurve3
          const u = (c.userData.u + (st.t - 0.8) * 0.12) % 1
          const uu = Math.min(0.999, Math.max(0.001, p.current >= 0 ? u : 1 - u))
          const at = path.getPointAt(uu)
          const tan = path.getTangentAt(uu)
          if (p.current < 0) tan.negate()
          c.position.copy(at)
          c.quaternion.setFromUnitVectors(V(0, 1, 0), tan)
        }
        const deg = final * k
        this.emitGauges(dt, () => [
          { label: 'Switch', value: on ? 'ON' : 'off', tone: on ? 'ok' : undefined },
          { label: 'Current', value: `${on ? f1(p.amps) : '0.0'} A`, tone: 'info' },
          { label: 'Wire to compass', value: `${p.distance} cm` },
          { label: 'Needle turned', value: `${f1(Math.abs(deg))}° ${Math.abs(deg) < 0.5 ? '' : deg < 0 ? 'West' : 'East'}`, tone: 'warn' },
        ])
        if (st.t > 5) return 600
        return null
      },
      done: () => {
        for (const c of this.flow) c.visible = false
      },
    })
  }

  private async runEm(p: { turns: number; current: number; core: string; mode: string }): Promise<void> {
    this.abort()
    this.resetTab2()
    this.buildEm(p)
    this.em.visible = true
    const polarity = p.mode === 'polarity'
    this.compass2.group.visible = polarity
    this.compass2.group.position.set(2.1, 0, 0.6)
    this.compass2.setNeedle(Math.PI / 2)
    const v = this.view('em')
    await this.flyTo(v.pos, v.target, 1200)
    if (this.disposed) return
    const held = Math.min(this.clipMeshes.length, clipsHeld(p.turns, p.current, p.core))
    const tipY = 0.7
    // where each held clip hangs: in short chains under the tip
    const hang = (i: number): THREE.Vector3 => V(((i % 3) - 1) * 0.3 + (i % 2) * 0.05, tipY - 0.1 - Math.floor(i / 3) * 0.2, (i % 2) * 0.12)
    const onAt = 0.8
    const offAt = p.mode === 'off' ? 4.2 : p.mode === 'polarity' ? 3.6 : 99
    const st = { t: 0, ding: false }
    const reversed = () => st.t > offAt && polarity
    const poles = (rev: boolean): Pole[] => [{ p: [0, 0.75, 0], q: rev ? -1 : 1 }, { p: [0, 3.9, 0], q: rev ? 1 : -1 }]
    return this.begin({
      update: (dt) => {
        st.t += dt
        const live = p.mode === 'off' ? st.t > onAt && st.t < offAt : st.t > onAt
        const sw = this.lever
        sw.rotation.z = live ? 0 : 0.5
        if (this.emFieldGroup) {
          this.emFieldGroup.visible = live && p.core === 'iron'
          this.emFieldGroup.children.forEach((c, i) => (c as LineTube).reveal((st.t - onAt - i * 0.06) / 1.2))
        }
        if (live && !st.ding) {
          st.ding = true
          sound.click()
        }
        // clips: those that can be held rise to the tip; the rest stay on the table
        let count = 0
        this.clipMeshes.forEach((m, i) => {
          const home = m.userData.home as THREE.Vector3
          if (i >= held) {
            m.position.copy(home)
            return
          }
          const target = hang(i)
          const up = smooth(onAt + 0.1 + i * 0.08, onAt + 0.7 + i * 0.08, st.t)
          const fallStart = p.mode === 'off' ? offAt + i * 0.03 : 999
          if (st.t < fallStart) {
            // fly from the table to the tip in an arc
            m.position.lerpVectors(home, target, up)
            m.position.y += Math.sin(up * Math.PI) * 0.8
            m.rotation.z = up * (i % 2 ? 1.4 : -1.4)
            if (up >= 1) count++
          } else {
            const tf = st.t - fallStart
            const y = Math.max(home.y, target.y - 4.9 * tf * tf)
            m.position.set(target.x + (home.x - target.x) * Math.min(1, tf * 1.5), y, target.z + (home.z - target.z) * Math.min(1, tf * 1.5))
            if (y > home.y + 0.01) count++
            else count += 0
            m.rotation.z *= 0.94
          }
        })
        if (polarity) {
          const b = fieldAt(poles(reversed()), [2.1, 0.3, 0.6])
          const target = live ? Math.atan2(-b[2], b[0]) : Math.PI / 2
          const cur = this.compass2.heading
          let dd = target - cur
          dd = Math.atan2(Math.sin(dd), Math.cos(dd))
          this.compass2.setNeedle(cur + dd * Math.min(1, dt * 6))
        }
        const heldNow = Math.max(0, p.mode === 'off' && st.t > offAt ? count : count)
        this.emitGauges(dt, () => [
          { label: 'Switch', value: live ? 'ON' : 'off', tone: live ? 'ok' : undefined },
          { label: 'Current', value: `${live ? f1(p.current) : '0.0'} A`, tone: 'info' },
          { label: 'Turns of wire', value: String(p.turns) },
          { label: 'Core', value: p.core === 'iron' ? 'iron nail' : 'air' },
          ...(polarity ? [{ label: 'Compass', value: live ? (reversed() ? 'turned right round' : 'pointing') : 'north' } as Gauge] : [{ label: 'Clips held', value: String(live || p.mode !== 'off' ? heldNow : 0), tone: 'warn' } as Gauge]),
        ])
        if (p.mode === 'off' && st.t > offAt && st.t < offAt + 0.1) this.events.onNote?.('Current off: the magnetism vanishes at once and the clips drop.')
        if (st.t > (p.mode === 'on' ? 5 : 7.4)) return 600
        return null
      },
      done: () => undefined,
    })
  }

  /* ---- tab 3 ---- */
  /** Lays out the rod, the poles and the arrows for this question. */
  private setupFleming(p: { current: V3; field: V3; B: number; I: number; L: number }) {
    const cur = V(...p.current).normalize()
    const fld = V(...p.field).normalize()
    const F = V(...flemingForce(p.current, p.field)).normalize()
    const force = forceNewtons(p.B, p.I, p.L)
    // the rod lies along the current; the poles sit either side along the field, North on the side the field comes from
    this.rod.quaternion.setFromUnitVectors(V(0, 1, 0), cur)
    this.rod.position.set(0, 0, 0)
    this.poleN.position.copy(fld.clone().multiplyScalar(-2.4))
    this.poleS.position.copy(fld.clone().multiplyScalar(2.4))
    for (const pole of [this.poleN, this.poleS]) pole.quaternion.setFromUnitVectors(V(1, 0, 0), fld)
    this.arrowI.visible = this.arrowB3.visible = true
    this.arrowI.position.set(0, 0, 0).addScaledVector(cur, -0.4)
    this.arrowI.setDirection(cur)
    this.arrowI.setLength(1.7, 0.35, 0.3)
    this.arrowB3.position.copy(fld.clone().multiplyScalar(-1.5)).add(V(0, 0.7, 0))
    this.arrowB3.setDirection(fld)
    this.arrowB3.setLength(3, 0.35, 0.3)
    this.arrowF.visible = false
    return { cur, fld, F, force }
  }

  private async runFleming(p: { current: V3; field: V3; B: number; I: number; L: number }): Promise<void> {
    this.abort()
    const { cur, F, force } = this.setupFleming(p)
    const v = this.view('fleming')
    await this.flyTo(v.pos, v.target, 1200)
    if (this.disposed) return
    const st = { t: 0, x: 0, v: 0 }
    const acc = 4 * force
    return this.begin({
      update: (dt) => {
        st.t += dt
        const push = st.t > 1.4
        if (push && st.x < 3) {
          st.v += acc * dt
          st.x += st.v * dt
        }
        this.rod.position.copy(F.clone().multiplyScalar(st.x))
        this.arrowI.position.copy(F.clone().multiplyScalar(st.x)).addScaledVector(cur, -0.4)
        this.arrowF.visible = st.t > 1
        this.arrowF.position.copy(F.clone().multiplyScalar(st.x)).addScaledVector(cur, 0.2)
        this.arrowF.setDirection(F)
        this.arrowF.setLength(Math.min(2.6, 0.6 + force * 2.2), 0.4, 0.32)
        this.emitGauges(dt, () => [
          { label: 'Field B', value: `${f1(p.B)} T`, tone: 'info' },
          { label: 'Current I', value: `${f1(p.I)} A`, tone: 'warn' },
          { label: 'Rod length L', value: `${f2(p.L)} m` },
          { label: 'Force F = B I L', value: st.t > 1 ? `${f2(force)} N` : '…', tone: 'ok' },
        ])
        if (st.t > 4.6 || st.x >= 3) return 900
        return null
      },
      done: () => {
        this.rod.position.set(0, 0, 0)
        this.arrowF.visible = false
      },
    })
  }

  private async runInduction(p: { motion: string; speed: number; pole: string; turns: number }): Promise<void> {
    this.abort()
    const north = p.pole !== 'S'
    this.buildInduction(p.turns, north)
    this.galvoNeedle.rotation.z = 0
    this.magnet3.visible = true
    const v = this.view('induction')
    await this.flyTo(v.pos, v.target, 1200)
    if (this.disposed) return
    const T = 2.6 / Math.max(0.2, p.speed)
    const st = { t: 0, xn: -5, prev: -5, reading: 0 }
    const nose = 0 // the nose of the magnet moves relative to the coil centre
    void nose
    const xnAt = (t: number): number => {
      if (p.motion === 'out') return 0.4 - 5.4 * smooth(0.6, 0.6 + T, t)
      if (p.motion === 'still') return -5 + 5.4 * smooth(0.6, 0.6 + T, t)
      return -5 + 5.4 * smooth(0.6, 0.6 + T, t)
    }
    return this.begin({
      update: (dt) => {
        st.t += dt
        const xn = p.motion === 'out' && st.t < 0.6 ? 0.4 : xnAt(st.t)
        const vrel = dt > 0 ? (xn - st.prev) / dt : 0
        st.prev = xn
        // the magnet slides (or the coil does): either way the picture is the same relative motion
        if (p.motion === 'coil_moves') {
          this.magnet3.position.x = COIL_X + 0.4 - 1.2 // fixed, with its nose where the coil ends up
          this.coilGroup.position.x = COIL_X + 0.4 - xn * 0.55
          this.setLeads(this.coilGroup.position.x)
        } else {
          this.coilGroup.position.x = COIL_X
          this.magnet3.position.x = COIL_X + xn - 1.2 // the nose of a 2.4-long bar is 1.2 ahead of its centre
        }
        const target = galvo(xn, vrel, north, p.turns)
        st.reading += (target - st.reading) * Math.min(1, dt * 14)
        this.galvoNeedle.rotation.z = -st.reading * 55 * (Math.PI / 180)
        if (this.sparkMat && 'emissiveIntensity' in this.sparkMat) (this.sparkMat as THREE.MeshStandardMaterial).emissiveIntensity = 0.6 + Math.abs(st.reading) * 2
        this.emitGauges(dt, () => [
          { label: 'Magnet', value: Math.abs(vrel) < 0.05 ? 'still' : vrel > 0 ? 'moving in' : 'moving out', tone: 'info' },
          { label: 'Needle', value: `${Math.round(Math.abs(st.reading) * 100)}% ${Math.abs(st.reading) < 0.04 ? '' : st.reading > 0 ? 'right' : 'left'}`, tone: 'warn' },
          { label: 'Turns of wire', value: String(p.turns) },
        ])
        const end = p.motion === 'still' ? 0.6 + T + 3 : 0.6 + T + 1.6
        if (st.t > end) return 700
        return null
      },
      done: () => {
        this.galvoNeedle.rotation.z = 0
        this.magnet3.visible = false
        this.coilGroup.position.x = COIL_X
        this.setLeads(COIL_X)
      },
    })
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
    this.camera.fov = w / h < 1 ? 60 : 42
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

const COIL_X = -2 // the coil, and the galvanometer beside it, inside the induction station
const DIAL_X = 3.4
// where the horseshoe model's tips end up: its opening is turned about 22° in the file, so turn it back
const HORSE_YAW = (-22 * Math.PI) / 180
const HORSE_Z = 0.4

/**
 * A pocket compass: the model's case, glass and lid, with a card and a needle of our own on top, because the
 * needle in the model is painted on and cannot turn.
 */
class Compass {
  readonly group = new THREE.Group()
  private readonly needle = new THREE.Group()
  private model: THREE.Object3D | null = null
  heading = Math.PI / 2
  constructor(model: THREE.Object3D | null) {
    this.group.add(this.needle)
    this.build()
    this.dress(model)
  }
  private build() {
    const card = new THREE.Mesh(new THREE.CircleGeometry(0.4, 48), new THREE.MeshStandardMaterial({ color: 0xf1ead2, roughness: 0.7 }))
    card.rotation.x = -Math.PI / 2
    card.position.y = CARD_Y
    card.name = 'card'
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.4, 48), new THREE.MeshBasicMaterial({ color: 0x6b5a3a, side: THREE.DoubleSide }))
    ring.rotation.x = -Math.PI / 2
    ring.position.y = CARD_Y + 0.002
    this.group.add(card, ring)
    this.group.scale.setScalar(0.8)
    for (let i = 0; i < 4; i++) {
      const t = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.12), new THREE.MeshBasicMaterial({ color: 0x6b5a3a }))
      t.rotation.x = -Math.PI / 2
      t.rotation.z = (i * Math.PI) / 2
      t.position.set(Math.sin((i * Math.PI) / 2) * 0.28, CARD_Y + 0.003, -Math.cos((i * Math.PI) / 2) * 0.28)
      this.group.add(t)
    }
    const n = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.36, 16), new THREE.MeshStandardMaterial({ color: RED, metalness: 0.3, roughness: 0.4 }))
    n.rotation.z = -Math.PI / 2
    n.position.x = 0.18
    const s = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.36, 16), new THREE.MeshStandardMaterial({ color: BLUE, metalness: 0.3, roughness: 0.4 }))
    s.rotation.z = Math.PI / 2
    s.position.x = -0.18
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), new THREE.MeshStandardMaterial({ color: 0xd9b25f, metalness: 1, roughness: 0.25 }))
    this.needle.add(n, s, cap)
    this.needle.position.y = CARD_Y + 0.06
    this.setNeedle(Math.PI / 2)
  }
  /** Adds the case from the model (or leaves the plain card if the model could not load). */
  dress(model: THREE.Object3D | null) {
    if (this.model) this.group.remove(this.model)
    this.model = null
    if (!model) return
    const m = model.clone(true)
    const box = new THREE.Box3().setFromObject(m)
    const size = box.getSize(new THREE.Vector3())
    m.scale.multiplyScalar(1.0 / Math.max(size.x, size.z, 1e-6))
    const b2 = new THREE.Box3().setFromObject(m)
    const c = b2.getCenter(new THREE.Vector3())
    m.position.set(-c.x, -b2.min.y, -c.z)
    m.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true
        o.receiveShadow = true
      }
    })
    this.model = m
    this.group.add(m)
  }
  /** Points the needle's North end along the heading (radians, anticlockwise from +x seen from above). */
  setNeedle(heading: number) {
    this.heading = heading
    this.needle.rotation.y = heading
  }
}
// height of the compass card above the table, in scene units
const CARD_Y = 0.11
