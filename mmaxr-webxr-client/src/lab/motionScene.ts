import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { MotionLessonContract } from '@mmaxr/schema'
import { sound } from './sound'
import { BALL_TERMINAL, DROP_HEIGHT, FEATHER_TERMINAL, G, LAP, LEAD, LOOP_CENTER, TRACK_Z, carAt, cradleAngle, elastic, kinematics, profile, pushOnFloor, simulateFall, type DriveParams } from './motionPhysics'

/*
 * Three small labs in one scene: the track, the cargo bay and the drop tower. Each is a group far from the
 * others; the camera flies between them. The scene only simulates and draws. It never names an answer:
 * what a result means comes from the server, after the student has watched it.
 */

export type Params = Record<string, unknown>
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

export interface Gauge {
  label: string
  value: string
  tone?: 'info' | 'ok' | 'warn'
}
export interface MotionSceneEvents {
  onProgress?(done: number, total: number): void
  onGauges?(g: Gauge[] | null): void
  onNote?(text: string | null): void
}

const MODULE_X: Record<string, number> = { kinematics_track: 0, dynamics_bay: 300, gravitation_drop: 600 }
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)

/** A thick arrow (ArrowHelper draws a 1 px line, which disappears at a distance). Same small API. */
class BoldArrow extends THREE.Group {
  private readonly shaft: THREE.Mesh
  private readonly head: THREE.Mesh
  constructor(color: number, private readonly thick = 0.09) {
    super()
    const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 })
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 12)
    cyl.translate(0, 0.5, 0)
    const cone = new THREE.ConeGeometry(1, 1, 18)
    cone.translate(0, 0.5, 0)
    this.shaft = new THREE.Mesh(cyl, mat)
    this.head = new THREE.Mesh(cone, mat)
    this.shaft.renderOrder = this.head.renderOrder = 9
    this.add(this.shaft, this.head)
    this.setLength(1, 0.4, 0.3)
  }
  setDirection(dir: THREE.Vector3) {
    this.quaternion.setFromUnitVectors(V(0, 1, 0), dir.clone().normalize())
  }
  setLength(length: number, headLength = 0.4, headWidth = 0.3) {
    const hl = Math.min(headLength, length * 0.6)
    this.shaft.scale.set(this.thick, Math.max(0.001, length - hl), this.thick)
    this.head.position.y = length - hl
    this.head.scale.set(Math.max(headWidth * 0.5, this.thick * 2), hl, Math.max(headWidth * 0.5, this.thick * 2))
  }
}
type Ease = (t: number) => number
const easeInOut: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const ARROWS = ['→', '↗', '↑', '↖', '←', '↙', '↓', '↘']
const arrowFor = (heading: number) => ARROWS[Math.round((((heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8]
const f1 = (n: number) => (Math.abs(n) < 0.005 ? '0.0' : n.toFixed(1))
const f2 = (n: number) => (Math.abs(n) < 0.005 ? '0.00' : n.toFixed(2))

// tuning that does not belong in the contract: how the models are scaled into the scene
const CAR_YAW = 0 // the model drives towards +z; set to Math.PI if it ever faces backwards
const CRATE_HEAVY = 3.2
const CRATE_FLOAT = 2.4
const CRATE_BIG = 3.4
const CRADLE_SCALE = 7
const TUBE_SEGMENTS = 3
const PAIR_X = 9.5 // where the two-mass gravity station stands in the drop-tower module
const PAIR_Y = 2.3
const R_BALL = 0.2 // the metal ball in the drop tower
const POD = 0.3 // height of the tube pedestals

interface Job {
  /** Return null to keep going, or the milliseconds to linger on the final picture before finishing. */
  update(dt: number): number | null
  done(): void
}

export class MotionScene {
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
  private moduleId = 'kinematics_track'
  private tweens = new Set<(dt: number) => boolean>()
  private job: Job | null = null
  private lingerLeft: number | null = null
  private resolveJob: (() => void) | null = null
  private follow: ((dt: number) => void) | null = null
  private flightId = 0
  private insetsPx = { left: 0, right: 0, top: 0, bottom: 0 }
  private insetsTarget = { left: 0, right: 0, top: 0, bottom: 0 }
  private disposed = false
  private running = false
  private gaugeClock = 0
  private readonly onResize = () => this.resize()

  // ---- kinematics ----
  private car = new THREE.Group()
  private flag = new THREE.Group()
  private arrowDisp = new BoldArrow(0xff5470, 0.12)
  private arrowVel = new BoldArrow(0x4ade80, 0.09)
  private arrowAcc = new BoldArrow(0xfacc15, 0.09)
  private carS = 0
  private freeDriving = false
  private drive = { x: 0, z: 0, heading: 0, speed: 0, odometer: 0, originX: 0, originZ: 0, vx: 0, vz: 0, throttle: 0, steer: 0 }
  private keys = new Set<string>()

  // ---- dynamics ----
  private crateHeavy = new THREE.Group()
  private crateFloat = new THREE.Group()
  private crateBig = new THREE.Group()
  private speedArrow = new BoldArrow(0x4ade80, 0.07)
  /** The metre ruler for the drifting crate. Only shown while that experiment runs. */
  private ruler = new THREE.Group()
  private spring: THREE.Mesh | null = null
  private stars: THREE.Points | null = null
  private ballHeavy: THREE.Mesh
  private ballLight: THREE.Mesh
  private cradleBalls: THREE.Group[] = []
  private pairA = new THREE.Mesh(new THREE.SphereGeometry(0.55, 40, 28), new THREE.MeshStandardMaterial({ color: 0x4f8cff, emissive: 0x16306a, roughness: 0.35, metalness: 0.2 }))
  private pairB = new THREE.Mesh(new THREE.SphereGeometry(0.4, 36, 24), new THREE.MeshStandardMaterial({ color: 0xff9f43, emissive: 0x6a3a10, roughness: 0.35, metalness: 0.2 }))
  private pairArrowA = new BoldArrow(0xffd166, 0.07)
  private pairArrowB = new BoldArrow(0xffd166, 0.07)
  private pairLabelA!: THREE.Sprite
  private pairLabelB!: THREE.Sprite
  private labelCrate!: THREE.Sprite
  private labelHeavy!: THREE.Sprite
  private labelLight!: THREE.Sprite
  private pushArrow = new BoldArrow(0x60a5fa, 0.07)
  private frictionArrow = new BoldArrow(0xfb923c, 0.07)

  // ---- gravitation ----
  private drops: Record<'air' | 'vacuum', { ball: THREE.Object3D; feather: THREE.Object3D; door: THREE.Object3D; dust?: THREE.Points }> = {} as never

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

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 600)
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.maxPolarAngle = Math.PI * 0.49
    this.controls.minDistance = 2
    this.controls.maxDistance = 90
    this.controls.addEventListener('start', () => {
      this.flightId += 1 // the student took over
      this.follow = null
    })

    const steel = (c: number, metal = 0.9, rough = 0.3) => new THREE.MeshStandardMaterial({ color: c, metalness: metal, roughness: rough })
    this.ballHeavy = new THREE.Mesh(new THREE.SphereGeometry(0.32, 40, 28), steel(0x3a4252, 1, 0.25))
    this.ballLight = new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 24), steel(0x9fd0ff, 0.6, 0.2))

    this.buildStage()
    this.resize()
    window.addEventListener('resize', this.onResize)
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('keyup', this.onKey)
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
  get isFreeDriving(): boolean {
    return this.freeDriving
  }

  /* ---------------- stage ---------------- */
  private buildStage() {
    const scene = this.scene
    // The same moody studio look as the indicators and metals labs: a dark room, one warm key spotlight with
    // shadows, an amber and a cyan rim light, a soft cool fill and drifting dust.
    scene.background = new THREE.Color(0x0b0d12)
    scene.fog = new THREE.Fog(0x0b0d12, 70, 230)
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
    this.buildKinematics()
    this.buildDynamics()
    this.buildGravitation()
  }

  /**
   * A lit stage for one module: a glossy platform with a glowing edge, an optional back wall, a key spotlight
   * with shadows, amber and cyan rim lights and dust. Sizes are in metres, centred on (cx, cz).
   */
  private stageSet(g: THREE.Group, o: { cx: number; cz: number; w: number; d: number; wall?: { z: number; h: number }; key: [number, number, number]; aim: [number, number, number]; keyI: number; rimI: number; rimAt: [number, number, number]; dust?: { n: number; h: number } }) {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshStandardMaterial({ color: 0x0d1016, roughness: 0.7, metalness: 0.1 }))
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -0.4
    floor.receiveShadow = true
    g.add(floor)
    const deck = new THREE.Mesh(new THREE.BoxGeometry(o.w, 0.34, o.d), new THREE.MeshStandardMaterial({ color: 0x151a22, roughness: 0.36, metalness: 0.25 }))
    deck.position.set(o.cx, -0.2, o.cz)
    deck.receiveShadow = true
    g.add(deck)
    // glowing edge, like the rings on the biology stage
    const glow = new THREE.MeshBasicMaterial({ color: 0x4f8cff, transparent: true, opacity: 0.55, depthWrite: false })
    const t = Math.max(0.06, o.w / 600)
    for (const [w, d, x, z] of [
      [o.w, t, o.cx, o.cz - o.d / 2],
      [o.w, t, o.cx, o.cz + o.d / 2],
      [t, o.d, o.cx - o.w / 2, o.cz],
      [t, o.d, o.cx + o.w / 2, o.cz],
    ] as const) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), glow)
      e.position.set(x, 0.0, z)
      g.add(e)
    }
    if (o.wall) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(o.w * 1.3, o.wall.h), new THREE.MeshStandardMaterial({ color: 0x1b2029, roughness: 0.85 }))
      wall.position.set(o.cx, o.wall.h / 2 - 0.2, o.wall.z)
      wall.receiveShadow = true
      g.add(wall)
      const strip = new THREE.Mesh(new THREE.BoxGeometry(o.w * 1.3, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.5 }))
      strip.position.set(o.cx, 0.3, o.wall.z + 0.05)
      g.add(strip)
    }
    const key = new THREE.SpotLight(0xfff3e0, o.keyI, 0, Math.PI / 4.2, 0.7, 1.6)
    key.position.set(...o.key)
    key.target.position.set(...o.aim)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.bias = -0.0004
    g.add(key, key.target)
    const rimA = new THREE.PointLight(0xf59e0b, o.rimI, 0, 2)
    rimA.position.set(o.cx - o.rimAt[0], o.rimAt[1], o.cz + o.rimAt[2])
    const rimB = new THREE.PointLight(0x22d3ee, o.rimI * 0.8, 0, 2)
    rimB.position.set(o.cx + o.rimAt[0], o.rimAt[1] * 0.9, o.cz + o.rimAt[2])
    g.add(rimA, rimB)
    if (o.dust) {
      const pos = new Float32Array(o.dust.n * 3)
      for (let i = 0; i < o.dust.n; i++) {
        pos[i * 3] = o.cx + (Math.random() - 0.5) * o.w
        pos[i * 3 + 1] = Math.random() * o.dust.h
        pos[i * 3 + 2] = o.cz + (Math.random() - 0.5) * o.d
      }
      const dg = new THREE.BufferGeometry()
      dg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      const dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xcdd6ff, size: 0.03, transparent: true, opacity: 0.3, depthWrite: false }))
      g.add(dust)
    }
  }

  private label(text: string, color = '#e6edf7', scale = 1): THREE.Sprite {
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 128
    const tex = new THREE.CanvasTexture(c)
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
    s.scale.set(2.4 * scale, 0.6 * scale, 1)
    s.userData = { canvas: c, color }
    this.relabel(s, text)
    return s
  }

  /** Changes the words on a label (the masses change from one question to the next). */
  private relabel(s: THREE.Sprite, text: string) {
    const c = s.userData.canvas as HTMLCanvasElement
    const x = c.getContext('2d')!
    x.clearRect(0, 0, c.width, c.height)
    x.fillStyle = 'rgba(8,12,20,0.78)'
    x.beginPath()
    x.roundRect(8, 16, 496, 96, 26)
    x.fill()
    x.fillStyle = s.userData.color as string
    x.font = '700 54px system-ui, sans-serif'
    x.textAlign = 'center'
    x.textBaseline = 'middle'
    x.fillText(text, 256, 66)
    ;(s.material as THREE.SpriteMaterial).map!.needsUpdate = true
  }

  /* ---------------- kinematics ---------------- */
  private buildKinematics() {
    const g = this.groups.kinematics_track
    this.stageSet(g, { cx: -22, cz: 4, w: 100, d: 66, key: [-6, 70, 40], aim: [-20, 0, 6], keyI: 11000, rimI: 4500, rimAt: [52, 22, -18] })
    this.car.add(this.carFallback())
    g.add(this.car)
    // the start flag
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3, 10), new THREE.MeshStandardMaterial({ color: 0xdddddd }))
    pole.position.y = 1.5
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), new THREE.MeshBasicMaterial({ color: 0xff5470, side: THREE.DoubleSide }))
    cloth.position.set(0.7, 2.55, 0)
    this.flag.add(pole, cloth)
    this.flag.add(this.label('START', '#ffb3c0', 0.9))
    ;(this.flag.children[2] as THREE.Sprite).position.set(0, 3.6, 0)
    g.add(this.flag)
    for (const a of [this.arrowDisp, this.arrowVel, this.arrowAcc]) {
      a.visible = false
      a.renderOrder = 8
      g.add(a)
    }
    this.setCarS(0)
    this.placeFlag(0)
  }

  private carFallback(): THREE.Object3D {
    const m = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 4.6), new THREE.MeshStandardMaterial({ color: 0xe5484d, metalness: 0.5, roughness: 0.35 }))
    body.position.y = 0.7
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 2.2), new THREE.MeshStandardMaterial({ color: 0x1b2230, metalness: 0.3, roughness: 0.2 }))
    cab.position.set(0, 1.3, -0.2)
    m.add(body, cab)
    return m
  }

  private placeFlag(s: number) {
    const p = carAt(s)
    this.flag.position.set(p.x, 0, p.z - 1.5)
  }

  private setCarS(s: number) {
    this.carS = s
    const p = carAt(s)
    this.car.position.set(p.x, 0.12, p.z)
    // The model's nose points along +z; heading is anticlockwise from +x, so turn it to match.
    this.car.rotation.y = Math.PI / 2 + p.heading + CAR_YAW
  }

  private tiles(g: THREE.Group, straight: THREE.Object3D | null, curve: THREE.Object3D | null) {
    const place = (src: THREE.Object3D | null, x: number, z: number, yaw: number, lift = 0) => {
      if (!src) return
      const o = src.clone(true)
      o.position.set(x, lift, z)
      o.rotation.y = yaw
      o.traverse((c) => {
        if (c instanceof THREE.Mesh) c.receiveShadow = true
      })
      g.add(o)
    }
    // The run-up merges into the ring over its last 20 m, so it sits just above the ring's gravel trap.
    if (straight) for (let i = 0; i < LEAD / 10; i++) place(straight, -LEAD + 5 + i * 10, TRACK_Z, 0, 0.06)
    if (curve) {
      // the four curve tiles form a ring of centre-line radius 15 m, joined to the straight at (0, TRACK_Z)
      const cx = 0
      const cz = TRACK_Z - 15
      for (let k = 0; k < 4; k++) {
        const yaw = (k * Math.PI) / 2
        const ox = 10 * Math.cos(yaw) + 10 * Math.sin(yaw)
        const oz = -10 * Math.sin(yaw) + 10 * Math.cos(yaw)
        place(curve, cx + ox, cz + oz, yaw)
      }
    }
    if (!straight || !curve) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.9 })
      if (!straight) {
        const s = new THREE.Mesh(new THREE.PlaneGeometry(LEAD, 8), mat)
        s.rotation.x = -Math.PI / 2
        s.position.set(-LEAD / 2, 0.02, TRACK_Z)
        g.add(s)
      }
      if (!curve) {
        const r = new THREE.Mesh(new THREE.RingGeometry(15 - 4, 15 + 4, 96), mat)
        r.rotation.x = -Math.PI / 2
        r.position.set(0, 0.02, TRACK_Z - 15)
        g.add(r)
      }
    }
  }

  private markPath(g: THREE.Group) {
    // metre marks along the straight so distance can be read from the picture
    for (let m = 0; m <= LEAD; m += 10) {
      const s = this.label(`${m} m`, '#cde', 0.55)
      s.position.set(-LEAD + m, 0.15, TRACK_Z + 4.8)
      g.add(s)
    }
  }

  /* ---------------- dynamics ---------------- */
  private buildDynamics() {
    const g = this.groups.dynamics_bay
    this.stageSet(g, { cx: 0, cz: 0, w: 32, d: 11, wall: { z: -5.8, h: 11 }, key: [3, 11, 9], aim: [0, 0.8, 0], keyI: 950, rimI: 160, rimAt: [15, 6, -3], dust: { n: 160, h: 6 } })
    // station A: heavy crate on a rough floor
    const pad = new THREE.Mesh(new THREE.BoxGeometry(9, 0.1, 5), new THREE.MeshStandardMaterial({ color: 0x3a3f49, roughness: 0.95, metalness: 0.4 }))
    pad.position.set(-9, 0.03, 0)
    pad.receiveShadow = true
    g.add(pad)
    for (let i = -4; i <= 4; i++) {
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 5), new THREE.MeshStandardMaterial({ color: 0x555c68, roughness: 1 }))
      ridge.position.set(-9 + i * 0.5, 0.1, 0)
      g.add(ridge)
    }
    this.crateHeavy.add(this.crateFallback(0x6b5130, CRATE_HEAVY))
    this.crateHeavy.position.set(-9, 0.1, 0)
    g.add(this.crateHeavy)
    this.labelCrate = this.label('Heavy crate · 80 kg', '#ffd9a0', 0.8)
    this.labelCrate.position.set(-9, 2.7, 0)
    g.add(this.labelCrate)
    // station B: zero gravity
    const field = new THREE.Mesh(new THREE.SphereGeometry(3, 40, 24), new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.06, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending }))
    field.position.set(-3, 1.8, 0)
    g.add(field)
    this.crateFloat.add(this.crateFallback(0x7b7466, CRATE_FLOAT))
    this.crateFloat.position.set(-3, 1.8, 0)
    g.add(this.crateFloat)
    this.crateBig.add(this.crateFallback(0x6b5a46, CRATE_BIG))
    this.crateBig.visible = false
    g.add(this.crateBig)
    this.spring = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1, 14), new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.8 }))
    this.spring.rotation.z = Math.PI / 2
    this.spring.visible = false
    g.add(this.spring)
    const b = this.label('Floating crate · 20 kg', '#bfe0ff', 0.9)
    b.position.set(-3, 3.8, 0)
    g.add(b)
    // Stars hang still in space and the crate moves through them, so its motion is plain to see.
    const n = 520
    const pos = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      pos[i * 3] = -14 + Math.random() * 62
      pos[i * 3 + 1] = 1.8 + (Math.random() - 0.5) * 6
      pos[i * 3 + 2] = (Math.random() - 0.5) * 9
    }
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcfe3ff, size: 0.07, transparent: true, opacity: 0.8, depthWrite: false }))
    g.add(this.stars)
    // a ruler laid out in front of the crate's path, from its starting point
    const tickMat = new THREE.MeshBasicMaterial({ color: 0x7fb3ff, transparent: true, opacity: 0.7 })
    for (let m = 0; m <= 36; m++) {
      const tall = m % 3 === 0
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.04, tall ? 0.34 : 0.18, 0.04), tickMat)
      tick.position.set(-3 + m, 0.55 + (tall ? 0.17 : 0.09), 2.2)
      this.ruler.add(tick)
      if (tall && m > 0) {
        const lab = this.label(`${m} m`, '#9cc6ff', 0.42)
        lab.position.set(-3 + m, 1.25, 2.2)
        this.ruler.add(lab)
      }
    }
    this.ruler.visible = false
    g.add(this.ruler)
    g.add(this.speedArrow)
    this.speedArrow.visible = false
    // station C: the rail
    const rail = new THREE.Mesh(new THREE.BoxGeometry(8, 0.12, 0.9), new THREE.MeshStandardMaterial({ color: 0x2a303b, metalness: 0.7, roughness: 0.4 }))
    rail.position.set(3, 0.06, 0)
    rail.receiveShadow = true
    g.add(rail)
    for (const dz of [-0.4, 0.4]) {
      const lip = new THREE.Mesh(new THREE.BoxGeometry(8, 0.1, 0.06), new THREE.MeshStandardMaterial({ color: 0x4a5160, metalness: 0.8, roughness: 0.3 }))
      lip.position.set(3, 0.17, dz)
      g.add(lip)
    }
    for (const dx of [-4, 4]) {
      const stop = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.9), new THREE.MeshStandardMaterial({ color: 0xff5470 }))
      stop.position.set(3 + dx, 0.3, 0)
      g.add(stop)
    }
    for (const b2 of [this.ballHeavy, this.ballLight]) {
      b2.castShadow = true
      g.add(b2)
    }
    this.labelHeavy = this.label('Ball A · 5 kg', '#cfd8e8', 0.7)
    this.labelHeavy.position.set(0, 1.3, 0)
    this.labelLight = this.label('Ball B · 1 kg', '#a8d4ff', 0.7)
    this.labelLight.position.set(3.6, 1.3, 0)
    g.add(this.labelHeavy, this.labelLight)
    this.resetBalls()
    // arrows for station A
    for (const a2 of [this.pushArrow, this.frictionArrow]) {
      a2.visible = false
      a2.renderOrder = 8
      g.add(a2)
    }
    this.pushArrow.visible = false
    const d = this.label("Newton's cradle", '#e6edf7', 0.8)
    d.position.set(9, 3.4, 0)
    g.add(d)
  }

  private crateFallback(color: number, size: number): THREE.Object3D {
    const m = new THREE.Mesh(new THREE.BoxGeometry(size * 0.36, size * 0.28, size * 0.28), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }))
    m.position.y = size * 0.14
    m.castShadow = true
    return m
  }

  private resetBalls(m1 = 5, m2 = 1) {
    const k1 = Math.cbrt(m1 / 5)
    const k2 = Math.cbrt(m2 / 1)
    this.ballHeavy.scale.setScalar(k1)
    this.ballLight.scale.setScalar(k2)
    this.ballHeavy.position.set(0, 0.12 + 0.32 * k1, 0)
    this.ballLight.position.set(3.6, 0.12 + 0.2 * k2, 0)
    if (this.labelHeavy) {
      this.labelHeavy.position.x = 0
      this.labelLight.position.x = 3.6
    }
    this.ballHeavy.rotation.set(0, 0, 0)
    this.ballLight.rotation.set(0, 0, 0)
    if (this.labelHeavy) {
      this.relabel(this.labelHeavy, `Ball A · ${m1} kg`)
      this.relabel(this.labelLight, `Ball B · ${m2} kg`)
      this.labelHeavy.position.y = 1.3 + 0.3 * k1
      this.labelLight.position.y = 1.3 + 0.3 * k2
    }
  }

  /* ---------------- gravitation ---------------- */
  private buildGravitation() {
    const g = this.groups.gravitation_drop
    this.stageSet(g, { cx: 3.5, cz: 0, w: 26, d: 12, wall: { z: -6.4, h: 13 }, key: [4, 13, 11], aim: [3.5, 3, 0], keyI: 1100, rimI: 190, rimAt: [14, 8, -3], dust: { n: 160, h: 8 } })
    for (const [key, x, label, tone] of [['air', -3, 'AIR', '#ffd9a0'] as const, ['vacuum', 3, 'VACUUM', '#9fd0ff'] as const]) {
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1, POD, 40), new THREE.MeshStandardMaterial({ color: 0x2c313c, metalness: 0.8, roughness: 0.3 }))
      pod.position.set(x, POD / 2, 0)
      pod.castShadow = true
      pod.receiveShadow = true
      g.add(pod)
      const lab = this.label(label, tone, 1)
      lab.position.set(x, 7.2, 0)
      g.add(lab)
      // release door at the top
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.04, 0.5), new THREE.MeshStandardMaterial({ color: 0xff5470, emissive: 0x330010 }))
      door.position.set(x, POD + DROP_HEIGHT - 0.02, 0)
      g.add(door)
      const ball = new THREE.Mesh(new THREE.SphereGeometry(R_BALL, 40, 28), new THREE.MeshStandardMaterial({ color: 0xc9d2e0, metalness: 1, roughness: 0.12 }))
      ball.castShadow = true
      g.add(ball)
      const feather = this.featherFallback()
      g.add(feather)
      const rec: { ball: THREE.Object3D; feather: THREE.Object3D; door: THREE.Object3D; dust?: THREE.Points } = { ball, feather, door }
      if (key === 'air') {
        const n = 220
        const pos = new Float32Array(n * 3)
        for (let i = 0; i < n; i++) {
          pos[i * 3] = x + (Math.random() - 0.5) * 0.8
          pos[i * 3 + 1] = POD + Math.random() * 5.8
          pos[i * 3 + 2] = (Math.random() - 0.5) * 0.8
        }
        const dg = new THREE.BufferGeometry()
        dg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
        rec.dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xffe2b8, size: 0.03, transparent: true, opacity: 0.55, depthWrite: false }))
        g.add(rec.dust)
      } else {
        const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 6, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: 0.05, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending }))
        glow.position.set(x, POD + 3, 0)
        g.add(glow)
      }
      this.drops[key] = rec
      this.resetDrop(key)
    }
    // Newton's law of universal gravitation: two masses with equal and opposite pulls
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.8, 0.3, 56), new THREE.MeshStandardMaterial({ color: 0x2c313c, metalness: 0.8, roughness: 0.3 }))
    pod.position.set(PAIR_X, 0.15, 0)
    pod.receiveShadow = true
    g.add(pod)
    for (const m of [this.pairA, this.pairB]) {
      m.castShadow = true
      g.add(m)
    }
    for (const a of [this.pairArrowA, this.pairArrowB]) {
      a.renderOrder = 9
      g.add(a)
    }
    this.pairLabelA = this.label('Mass A', '#a8c8ff', 0.6)
    this.pairLabelB = this.label('Mass B', '#ffd0a0', 0.6)
    g.add(this.pairLabelA, this.pairLabelB)
    const law = this.label('F = G m₁ m₂ / r²', '#ffe08a', 0.95)
    law.position.set(PAIR_X, 5.4, 0)
    g.add(law)
    this.setPair(3, 2, 1, 1)
  }

  /** Lays out the two masses r metres apart. Sizes follow the cube root of the mass; arrows show the pull (1 = the starting pull). */
  private setPair(r: number, mA: number, mB: number, force: number) {
    const rA = 0.55 * Math.cbrt(mA / 2)
    const rB = 0.4 * Math.cbrt(mB / 1)
    this.pairA.scale.setScalar(rA / 0.55)
    this.pairB.scale.setScalar(rB / 0.4)
    const xa = PAIR_X - r / 2
    const xb = PAIR_X + r / 2
    this.pairA.position.set(xa, PAIR_Y, 0)
    this.pairB.position.set(xb, PAIR_Y, 0)
    const len = Math.min(0.42 * r, 0.25 + 0.4 * Math.sqrt(Math.max(0, force)))
    this.pairArrowA.visible = this.pairArrowB.visible = true
    this.pairArrowA.position.set(xa, PAIR_Y + 1.0, 0)
    this.pairArrowA.setDirection(V(1, 0, 0))
    this.pairArrowA.setLength(len, 0.3, 0.26)
    this.pairArrowB.position.set(xb, PAIR_Y + 1.0, 0)
    this.pairArrowB.setDirection(V(-1, 0, 0))
    this.pairArrowB.setLength(len, 0.3, 0.26)
    this.pairLabelA.position.set(xa, PAIR_Y + 1.7, 0)
    this.pairLabelB.position.set(xb, PAIR_Y + 1.7, 0)
  }

  /** Newton's law of universal gravitation, played out on the two masses with this session's values. */
  private async runPair(action: string, params: Params): Promise<void> {
    this.abort()
    const v = this.view('G')
    await this.flyTo(v.pos, v.target, 1100)
    if (this.disposed) return
    const st = { t: 0 }
    const smooth = (a: number, b: number, t: number) => easeInOut(Math.max(0, Math.min(1, (t - a) / (b - a))))
    const earth = action === 'gravity_earth'
    const matA = this.pairA.material as THREE.MeshStandardMaterial
    const G = 6.67e-11
    const planet = String(params.planet ?? 'earth')
    const NAMES: Record<string, string> = { earth: 'Earth', moon: 'the Moon', mars: 'Mars', venus: 'Venus', jupiter: 'Jupiter' }
    const SIZE: Record<string, number> = { earth: 1.7, moon: 0.7, mars: 0.95, venus: 1.6, jupiter: 2.4 }
    const M = num(params.M, 5.97e24)
    const Rp = num(params.R, 6.37e6)
    const mBall = num(params.mass, 1)
    const Fplanet = (G * M * mBall) / (Rp * Rp)
    const sci = (x: number) => {
      const e = Math.floor(Math.log10(x))
      return `${(x / 10 ** e).toFixed(2)}×10${String(e).replace(/-/g, '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)])}`
    }
    const top = PAIR_Y + 0.6
    const rBall = 0.14 * Math.cbrt(mBall)
    if (earth) {
      matA.color.setHex(num(params.color, 0x2f7bd8))
      matA.emissive.setHex(0x0a2a55)
      const rp = SIZE[planet] ?? 1.7
      this.pairA.scale.setScalar(rp / 0.55)
      this.pairA.position.set(PAIR_X, top - rp, 0)
      this.pairB.scale.setScalar(rBall / 0.4)
      this.pairLabelA.position.set(PAIR_X - 2.8, PAIR_Y - 0.6, 0)
      this.pairLabelB.position.set(PAIR_X + 0.9, PAIR_Y + 1.9, 0)
    }
    return this.begin({
      update: (dt) => {
        st.t += dt
        const t = st.t
        let gauges: Gauge[] = []
        if (action === 'gravity_double_r') {
          const r0 = num(params.r0, 3)
          const k = num(params.factor, 2)
          const r = r0 + r0 * (k - 1) * smooth(1.6, 3.6, t)
          const F = (r0 * r0) / (r * r)
          this.setPair(r, 2, 1, F)
          gauges = [
            { label: 'Distance r', value: `${f1(r)} m`, tone: 'info' },
            { label: 'Force on A', value: `${f2(F)} F₀`, tone: 'warn' },
            { label: 'Force on B', value: `${f2(F)} F₀`, tone: 'warn' },
            { label: 'r² compared with start', value: `×${f2((r * r) / (r0 * r0))}` },
          ]
          if (t > 3.7 && t < 3.8) this.events.onNote?.(`Distance × ${f2(k)}: the force is × ${f2(1 / (k * k))}, because F is proportional to 1/r².`)
        } else if (action === 'gravity_double_m') {
          const kA = num(params.massA, 1)
          const kB = num(params.massB, 2)
          const kr = num(params.distance, 1)
          const sm = smooth(1.6, 3.2, t)
          const mA = 2 * (1 + (kA - 1) * sm)
          const mB = 1 * (1 + (kB - 1) * sm)
          const r = 3 * (1 + (kr - 1) * sm)
          const F = ((mA * mB) / 2) / ((r / 3) * (r / 3))
          this.setPair(r, mA, mB, F)
          gauges = [
            { label: 'Distance r', value: `${f1(r)} m` },
            { label: 'Mass A', value: `${f2(mA / 2)} × start`, tone: 'info' },
            { label: 'Mass B', value: `${f2(mB)} × start`, tone: 'info' },
            { label: 'Force on A', value: `${f2(F)} F₀`, tone: 'warn' },
            { label: 'Force on B', value: `${f2(F)} F₀`, tone: 'warn' },
          ]
          if (t > 3.3 && t < 3.4) this.events.onNote?.(`The pull is now ${f2((kA * kB) / (kr * kr))} × what it was, and it is the same on both masses.`)
        } else {
          const fall = smooth(2.4, 3.2, t)
          this.pairB.position.set(PAIR_X, top + rBall + (1 - fall) * 1.25, 0)
          const len = 0.9
          this.pairArrowB.visible = true
          this.pairArrowB.position.set(PAIR_X, this.pairB.position.y, 0)
          this.pairArrowB.setDirection(V(0, -1, 0))
          this.pairArrowB.setLength(len, 0.3, 0.26)
          this.pairArrowA.visible = true
          this.pairArrowA.position.set(PAIR_X + 0.7, top - 0.05, 0.4)
          this.pairArrowA.setDirection(V(0, 1, 0))
          this.pairArrowA.setLength(len, 0.3, 0.26)
          gauges = [
            { label: 'G', value: '6.67×10⁻¹¹ N·m²/kg²' },
            { label: `${NAMES[planet] ?? 'Planet'}'s mass`, value: `${sci(M)} kg` },
            { label: 'Ball’s mass', value: `${f1(mBall)} kg` },
            { label: 'Distance to centre', value: `${sci(Rp)} m` },
            { label: 'Force F', value: `${f1(Fplanet)} N`, tone: 'warn' },
          ]
          if (t > 3.4 && t < 3.5) this.events.onNote?.(`The same pull acts on the ball and on ${NAMES[planet] ?? 'the planet'}. On the ball it is its weight: ${f2(Fplanet / mBall)} N per kg, so g = ${f2(Fplanet / mBall)} m/s².`)
        }
        this.emitGauges(dt, () => gauges)
        if (t > 7) return 400
        return null
      },
      done: () => {
        if (earth) {
          matA.color.setHex(0x4f8cff)
          matA.emissive.setHex(0x16306a)
        }
        this.setPair(3, 2, 1, 1)
      },
    })
  }

  private featherFallback(): THREE.Object3D {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.55), new THREE.MeshStandardMaterial({ color: 0xf5f0e6, roughness: 0.9, side: THREE.DoubleSide }))
    f.castShadow = false
    return f
  }

  private dropX(key: 'air' | 'vacuum') {
    return key === 'air' ? -3 : 3
  }
  private resetDrop(key: 'air' | 'vacuum', h = DROP_HEIGHT) {
    const d = this.drops[key]
    const x = this.dropX(key)
    d.ball.position.set(x - 0.2, POD + h + R_BALL, 0)
    d.feather.position.set(x + 0.2, POD + h + 0.06, 0)
    d.feather.rotation.set(0, 0, 0)
    d.door.position.set(x, POD + h - 0.02, 0)
    d.door.visible = true
  }

  /* ---------------- loading ---------------- */
  /** Loads the models. Anything that fails to load is replaced by a simple stand-in, so the lab still works. */
  async load(): Promise<void> {
    const loader = new GLTFLoader()
    const a = this.lesson.assets
    const urls = [a.car, a.trackStraight, a.trackCurve, a.crate, a.cradle, a.pipe, a.feathers]
    let done = 0
    const get = async (url: string) => {
      const r = await loader.loadAsync(url).then((x) => x.scene).catch((err) => {
        console.warn('[motion] model failed to load, using a stand-in', url, err)
        return null
      })
      this.events.onProgress?.(++done, urls.length)
      return r
    }
    const [car, straight, curve, crate, cradle, pipe, feathers] = await Promise.all(urls.map(get))
    if (this.disposed) return
    if (car) this.useCar(car)
    this.tiles(this.groups.kinematics_track, straight, curve)
    this.markPath(this.groups.kinematics_track)
    if (crate) this.useCrate(crate)
    if (cradle) this.useCradle(cradle)
    this.useTubes(pipe)
    if (feathers) this.useFeather(feathers)
  }

  private useCar(model: THREE.Object3D) {
    const m = model.clone(true)
    m.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true
        o.receiveShadow = true
      }
    })
    this.car.clear()
    this.car.add(m)
  }

  private useCrate(model: THREE.Object3D) {
    const make = (size: number, tint: number | null) => {
      const m = model.clone(true)
      m.scale.setScalar(size)
      const b = new THREE.Box3().setFromObject(m)
      m.position.y -= b.min.y
      m.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = true
          o.receiveShadow = true
          if (tint !== null) {
            o.material = (o.material as THREE.MeshStandardMaterial).clone()
            ;(o.material as THREE.MeshStandardMaterial).color.multiplyScalar(0.8)
          }
        }
      })
      return m
    }
    this.crateHeavy.clear()
    this.crateHeavy.add(make(CRATE_HEAVY, 1))
    this.crateFloat.clear()
    this.crateFloat.add(make(CRATE_FLOAT, null))
    this.crateBig.clear()
    this.crateBig.add(make(CRATE_BIG, 1))
  }

  private useCradle(model: THREE.Object3D) {
    const g = this.groups.dynamics_bay
    const root = model.clone(true)
    root.scale.setScalar(CRADLE_SCALE)
    const bb = new THREE.Box3().setFromObject(root)
    root.position.set(9 - (bb.min.x + bb.max.x) / 2, -bb.min.y + 0.05, -(bb.min.z + bb.max.z) / 2)
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true
        o.receiveShadow = true
      }
    })
    g.add(root)
    g.updateMatrixWorld(true)
    // Hang each ball from a pivot at the top of the frame so it can swing.
    const balls: THREE.Object3D[] = []
    root.traverse((o) => {
      if (/ball/i.test(o.name) && !balls.includes(o) && !balls.some((b) => b.getObjectById(o.id))) balls.push(o)
    })
    balls.sort((a, b) => new THREE.Box3().setFromObject(a).getCenter(new THREE.Vector3()).x - new THREE.Box3().setFromObject(b).getCenter(new THREE.Vector3()).x)
    const top = new THREE.Box3().setFromObject(root).max.y
    for (const ball of balls) {
      const c = g.worldToLocal(new THREE.Box3().setFromObject(ball).getCenter(new THREE.Vector3()))
      const pivot = new THREE.Group()
      pivot.position.set(c.x, top - 0.02, c.z)
      g.add(pivot)
      pivot.updateMatrixWorld(true)
      pivot.attach(ball)
      this.cradleBalls.push(pivot)
    }
  }

  private useTubes(pipe: THREE.Object3D | null) {
    for (const key of ['air', 'vacuum'] as const) {
      const x = this.dropX(key)
      const g = this.groups.gravitation_drop
      const tube = new THREE.Group()
      const segH = (POD * 0 + (DROP_HEIGHT + 1.4)) / TUBE_SEGMENTS
      for (let i = 0; i < TUBE_SEGMENTS; i++) {
        let seg: THREE.Object3D
        if (pipe) {
          seg = pipe.clone(true)
          // the pipe lies along x; stand it up and fit it to the segment height
          const wrap = new THREE.Group()
          wrap.add(seg)
          wrap.rotation.z = Math.PI / 2
          const holder = new THREE.Group()
          holder.add(wrap)
          const box = new THREE.Box3().setFromObject(holder)
          const size = box.getSize(new THREE.Vector3())
          holder.scale.set(1.05 / Math.max(size.x, size.z), segH / size.y, 1.05 / Math.max(size.x, size.z))
          const b2 = new THREE.Box3().setFromObject(holder)
          const c = b2.getCenter(new THREE.Vector3())
          holder.position.set(-c.x, -b2.min.y, -c.z)
          const outer = new THREE.Group()
          outer.add(holder)
          seg = outer
          seg.traverse((o) => {
            if (o instanceof THREE.Mesh) {
              o.material = (o.material as THREE.Material).clone()
              ;(o.material as THREE.Material).transparent = true
              ;(o.material as THREE.Material).depthWrite = false
              if ((o.material as THREE.MeshStandardMaterial).opacity > 0.5) (o.material as THREE.MeshStandardMaterial).opacity = 0.35
            }
          })
        } else {
          seg = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, segH, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0xbfe3ff, transparent: true, opacity: 0.18, side: THREE.DoubleSide, roughness: 0.05, metalness: 0.1, depthWrite: false }))
          seg.position.y = segH / 2
        }
        seg.position.y += i * segH
        tube.add(seg)
      }
      tube.position.set(x, POD, 0)
      g.add(tube)
    }
  }

  private useFeather(model: THREE.Object3D) {
    for (const key of ['air', 'vacuum'] as const) {
      const d = this.drops[key]
      const root = model.clone(true)
      // The pack holds three feathers. Keep one (the eagle's, else the first) with every parent transform intact.
      const feathers: THREE.Object3D[] = []
      root.traverse((o) => {
        if (/feather/i.test(o.name) && o.children.some((c) => c instanceof THREE.Mesh)) feathers.push(o)
      })
      const keep = feathers.find((f) => /eagle/i.test(f.name)) ?? feathers[0]
      if (!keep) return
      for (const f of feathers) if (f !== keep) f.removeFromParent()
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone()
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) (m as THREE.MeshStandardMaterial).side = THREE.DoubleSide
        }
      })
      const holder = new THREE.Group()
      holder.add(root)
      holder.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(holder)
      const size = box.getSize(new THREE.Vector3())
      const k = 0.7 / Math.max(size.x, size.y, size.z, 1e-6)
      root.scale.multiplyScalar(k)
      holder.updateMatrixWorld(true)
      const b2 = new THREE.Box3().setFromObject(holder)
      root.position.sub(b2.getCenter(new THREE.Vector3()))
      const fresh = new THREE.Group()
      fresh.add(holder)
      fresh.position.copy(d.feather.position)
      d.feather.parent?.add(fresh)
      d.feather.parent?.remove(d.feather)
      d.feather = fresh
      this.resetDrop(key)
    }
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

  private flyTo(pos: THREE.Vector3, target: THREE.Vector3, ms = 1500): Promise<void> {
    const id = ++this.flightId
    this.follow = null
    const p0 = this.camera.position.clone()
    const t0 = this.controls.target.clone()
    return this.animate(ms, (k) => {
      if (id !== this.flightId) return
      this.camera.position.lerpVectors(p0, pos, k)
      this.controls.target.lerpVectors(t0, target, k)
    }, easeInOut)
  }

  private view(name: string): { pos: THREE.Vector3; target: THREE.Vector3 } {
    const X = MODULE_X.dynamics_bay
    const Y = MODULE_X.gravitation_drop
    switch (name) {
      case 'kin':
        return { pos: V(-22, 24, 46), target: V(-20, 0, 8) }
      case 'lap':
        return { pos: V(0, 38, 34), target: V(0, 0, LOOP_CENTER.z) }
      case 'A':
        return { pos: V(X - 9 + 1.5, 2.6, 7.5), target: V(X - 9, 0.7, 0) }
      case 'B':
        return { pos: V(X - 3, 2.6, 8.5), target: V(X - 3, 1.8, 0) }
      case 'B2':
        return { pos: V(X - 3, 2.8, 10.5), target: V(X - 3, 2.0, 0) }
      case 'C':
        return { pos: V(X + 3, 3.4, 9), target: V(X + 3, 0.4, 0) }
      case 'D':
        return { pos: V(X + 9, 2.3, 5.2), target: V(X + 9, 1.1, 0) }
      case 'dyn':
        return { pos: V(X - 1, 6, 20), target: V(X - 1, 0.9, 0) }
      case 'tubes':
        return { pos: V(Y, 4, 14.5), target: V(Y, 3.3, 0) }
      case 'G':
        return { pos: V(Y + 9.5, 3.4, 11), target: V(Y + 9.5, 2.3, 0) }
      default:
        return { pos: V(Y + 3.5, 4.6, 19), target: V(Y + 3.5, 3.1, 0) }
    }
  }

  /** Brings a module into view. */
  async goto(moduleId: string, instant = false): Promise<void> {
    this.abort()
    this.stopFreeDrive()
    this.moduleId = moduleId
    for (const [id, g] of Object.entries(this.groups)) g.visible = id === moduleId
    this.events.onGauges?.(null)
    this.events.onNote?.(null)
    const v = this.view(moduleId === 'kinematics_track' ? 'kin' : moduleId === 'dynamics_bay' ? 'dyn' : 'grav')
    this.hideArrows()
    if (moduleId === 'kinematics_track') {
      this.setCarS(0)
      this.placeFlag(0)
    }
    if (moduleId === 'dynamics_bay') this.resetDyn()
    if (moduleId === 'gravitation_drop') {
      this.resetDrop('air')
      this.resetDrop('vacuum')
    }
    if (instant) {
      this.camera.position.copy(v.pos)
      this.controls.target.copy(v.target)
    } else await this.flyTo(v.pos, v.target)
  }

  private resetDyn() {
    this.crateHeavy.position.set(-9, 0.1, 0)
    this.crateFloat.position.set(-3, 1.8, 0)
    this.ruler.visible = false
    this.crateFloat.scale.setScalar(1)
    this.crateHeavy.scale.setScalar(1)
    this.relabel(this.labelCrate, 'Heavy crate · 80 kg')
    this.crateBig.visible = false
    this.crateBig.scale.setScalar(1)
    if (this.spring) this.spring.visible = false
    this.resetBalls()
    for (const p of this.cradleBalls) p.rotation.z = 0
  }

  private hideArrows() {
    for (const a of [this.arrowDisp, this.arrowVel, this.arrowAcc, this.pushArrow, this.frictionArrow, this.speedArrow, this.pairArrowA, this.pairArrowB]) a.visible = false
  }

  /* ---------------- running experiments ---------------- */
  private abort() {
    this.job?.done()
    this.job = null
    this.follow = null
    this.resolveJob?.()
    this.resolveJob = null
  }

  private begin(job: Job): Promise<void> {
    this.abort()
    this.lingerLeft = null
    return new Promise((resolve) => {
      this.job = job
      this.resolveJob = resolve
    })
  }

  private finish() {
    const r = this.resolveJob
    this.job?.done()
    this.job = null
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

  /** Plays one experiment and resolves when it has finished. */
  /** Plays one experiment with this session's values (`params`) and resolves when it has finished. */
  async run(action: string, params: Params = {}): Promise<void> {
    this.stopFreeDrive()
    this.events.onNote?.(null)
    switch (action) {
      case 'drive_straight':
      case 'drive_lap':
      case 'drive_lap_steady':
        return this.runDrive(action, params)
      case 'push_heavy':
        return this.runPushHeavy(num(params.force, 20), num(params.mass, 80))
      case 'push_float':
        return this.runZeroG({ force: num(params.force, 40), mass: num(params.mass, 20), pushTime: num(params.pushTime, 0.5), total: 14, notes: true })
      case 'push_mass':
      case 'push_20kg':
      case 'push_40kg':
        return this.runZeroG({ force: num(params.force, 40), mass: num(params.mass, action === 'push_40kg' ? 40 : 20), pushTime: 3, total: 6.5, notes: false })
      case 'push_apart':
        return this.runPushApart(num(params.massLeft, 20), num(params.massRight, 60), num(params.force, 30))
      case 'gravity_double_r':
      case 'gravity_double_m':
      case 'gravity_earth':
        return this.runPair(action, params)
      case 'collide':
        return this.runCollide(num(params.m1, 5), num(params.v1, 4), num(params.m2, 1))
      case 'cradle':
        return this.runCradle(Math.max(1, Math.min(3, Math.round(num(params.n, 2)))), params.side === 'right' ? 'right' : 'left')
      case 'drop_air':
        return this.runDrop('air', num(params.height, DROP_HEIGHT))
      case 'drop_vacuum':
        return this.runDrop('vacuum', num(params.height, DROP_HEIGHT))
      default:
        return
    }
  }

  /* ---- kinematics run ---- */
  private async runDrive(action: string, params: Params): Promise<void> {
    const p = profile(action, params as DriveParams)!
    this.setCarS(p.from)
    this.placeFlag(p.from)
    this.hideArrows()
    const straight = Math.max(p.from, p.to) <= LEAD
    if (!straight) {
      const v = this.view('lap')
      await this.flyTo(v.pos, v.target, 1300)
    } else {
      const v = this.view('kin')
      await this.flyTo(v.pos, v.target, 900)
    }
    if (this.disposed) return
    sound.whoosh(0.6)
    const state = { t: 0, prev: p.from, odo: 0 }
    if (straight) {
      const myFlight = this.flightId
      this.follow = () => {
        if (this.flightId !== myFlight) {
          this.follow = null
          return
        }
        const c = this.car.position
        this.controls.target.lerp(V(c.x, 0.8, c.z), 0.1)
        this.camera.position.lerp(V(c.x - 4, 7.5, c.z + 17), 0.06)
      }
    }
    return this.begin({
      update: (dt) => {
        state.t = Math.min(p.duration, state.t + dt * p.playback)
        const t = state.t
        const lo = Math.max(0, t - 0.04)
        const hi = Math.min(p.duration, t + 0.04)
        const speed = (p.at(hi) - p.at(lo)) / (hi - lo || 1)
        const lo2 = Math.max(0, t - 0.15)
        const hi2 = Math.min(p.duration, t + 0.15)
        const speed2 = (p.at(hi2) - p.at(lo2)) / (hi2 - lo2 || 1)
        const tangential = action === 'drive_lap_steady' ? 0 : (speed2 - speed) / 0.3
        const s = p.at(t)
        this.setCarS(s)
        const k = kinematics(p.from, s, speed, tangential)
        // the odometer counts every metre driven, forwards or back
        state.odo += Math.abs(s - state.prev)
        state.prev = s
        k.distance = state.odo
        this.drawKinematics(p.from, s, speed, k)
        this.emitGauges(dt, () => this.kinGauges(k, t, speed))
        if (state.t >= p.duration) {
          const end = kinematics(p.from, s, 0, 0)
          end.distance = state.odo
          this.emitGauges(0, () => this.kinGauges(end, t, 0), true)
          this.arrowVel.visible = false
          this.arrowAcc.visible = false
          sound.ring()
          return 900
        }
        return null
      },
      done: () => {
        this.follow = null
      },
    })
  }

  private kinGauges(k: ReturnType<typeof kinematics>, t: number, speed: number): Gauge[] {
    return [
      { label: 'Time', value: `${f1(t)} s` },
      { label: 'Distance (odometer)', value: `${f1(k.distance)} m`, tone: 'info' },
      { label: 'Displacement', value: `${f1(k.displacement)} m`, tone: 'warn' },
      { label: 'Speed', value: `${f1(Math.abs(speed))} m/s` },
      { label: 'Velocity', value: `${f1(Math.abs(speed))} m/s ${Math.abs(speed) > 0.05 ? arrowFor(k.velocityHeading) : ''}` },
      { label: 'Acceleration', value: `${f2(k.accel)} m/s²`, tone: k.accel > 0.05 ? 'ok' : undefined },
    ]
  }

  private drawKinematics(from: number, s: number, speed: number, k: ReturnType<typeof kinematics>) {
    const a = carAt(from)
    const b = carAt(s)
    const y = 0.35
    // displacement: from the start to where the car is now
    const d = V(b.x - a.x, 0, b.z - a.z)
    const len = d.length()
    this.arrowDisp.visible = len > 0.3
    if (len > 0.3) {
      this.arrowDisp.position.set(a.x, y + 0.3, a.z)
      this.arrowDisp.setDirection(d.clone().normalize())
      this.arrowDisp.setLength(len, Math.min(1.2, len * 0.4), Math.min(0.7, len * 0.25))
    }
    const dir = V(Math.cos(b.heading), 0, -Math.sin(b.heading))
    this.arrowVel.visible = Math.abs(speed) > 0.2
    this.arrowVel.position.set(b.x, 1.9, b.z)
    this.arrowVel.setDirection(dir)
    this.arrowVel.setLength(1.2 + Math.min(5, Math.abs(speed) * 0.5), 0.7, 0.45)
    const toCentre = V(LOOP_CENTER.x - b.x, 0, LOOP_CENTER.z - b.z).normalize()
    this.arrowAcc.visible = k.towardsCentre && k.accel > 0.05
    this.arrowAcc.position.set(b.x, 1.9, b.z)
    this.arrowAcc.setDirection(toCentre)
    this.arrowAcc.setLength(0.8 + Math.min(3.5, k.accel * 2), 0.7, 0.45)
  }

  /* ---- free drive ---- */
  startFreeDrive() {
    if (this.moduleId !== 'kinematics_track' || this.job) return
    this.freeDriving = true
    const p = carAt(this.carS)
    this.drive = { ...this.drive, x: p.x, z: p.z, heading: p.heading, speed: 0, odometer: 0, originX: p.x, originZ: p.z, vx: 0, vz: 0, throttle: 0, steer: 0 }
    this.flag.position.set(p.x, 0, p.z - 1.5)
    this.hideArrows()
    this.follow = null
    this.events.onNote?.('Free drive: arrow keys or W A S D to steer. R sends the car back to start.')
  }
  stopFreeDrive() {
    if (!this.freeDriving) return
    this.freeDriving = false
    this.events.onGauges?.(null)
    this.events.onNote?.(null)
  }
  /** Touch / on-screen controls. */
  driveInput(throttle: number, steer: number) {
    this.drive.throttle = throttle
    this.drive.steer = steer
  }
  resetFreeDrive() {
    const p = carAt(0)
    this.drive = { ...this.drive, x: p.x, z: p.z, heading: p.heading, speed: 0, odometer: 0, originX: p.x, originZ: p.z, vx: 0, vz: 0 }
    this.flag.position.set(p.x, 0, p.z - 1.5)
  }
  private onKey = (e: KeyboardEvent) => {
    if (!this.freeDriving) return
    if ((e.target as HTMLElement | null)?.tagName === 'TEXTAREA' || (e.target as HTMLElement | null)?.tagName === 'INPUT') return
    const down = e.type === 'keydown'
    const k = e.key.toLowerCase()
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) {
      e.preventDefault()
      if (down) this.keys.add(k)
      else this.keys.delete(k)
    }
    if (down && k === 'r') this.resetFreeDrive()
  }
  private stepFreeDrive(dt: number) {
    const d = this.drive
    const kb = this.keys
    const thr = (kb.has('arrowup') || kb.has('w') ? 1 : 0) - (kb.has('arrowdown') || kb.has('s') ? 1 : 0) || d.throttle
    const str = (kb.has('arrowleft') || kb.has('a') ? 1 : 0) - (kb.has('arrowright') || kb.has('d') ? 1 : 0) || d.steer
    d.speed += thr * 7 * dt
    d.speed *= 1 - Math.min(1, (thr === 0 ? 0.9 : 0.15) * dt)
    d.speed = Math.max(-8, Math.min(18, d.speed))
    d.heading += (Math.max(-10, Math.min(10, d.speed)) / 5) * 0.5 * str * dt
    const dx = Math.cos(d.heading) * d.speed * dt
    const dz = -Math.sin(d.heading) * d.speed * dt
    d.x += dx
    d.z += dz
    d.odometer += Math.abs(d.speed) * dt
    const vx = Math.cos(d.heading) * d.speed
    const vz = -Math.sin(d.heading) * d.speed
    const ax = (vx - d.vx) / Math.max(dt, 1e-3)
    const az = (vz - d.vz) / Math.max(dt, 1e-3)
    d.vx = vx
    d.vz = vz
    this.car.position.set(d.x, 0.12, d.z)
    this.car.rotation.y = Math.PI / 2 + d.heading + CAR_YAW
    const disp = Math.hypot(d.x - d.originX, d.z - d.originZ)
    const dd = V(d.x - d.originX, 0, d.z - d.originZ)
    this.arrowDisp.visible = disp > 0.4
    if (disp > 0.4) {
      this.arrowDisp.position.set(d.originX, 0.65, d.originZ)
      this.arrowDisp.setDirection(dd.clone().normalize())
      this.arrowDisp.setLength(disp, Math.min(1.2, disp * 0.4), Math.min(0.7, disp * 0.25))
    }
    const heading = d.speed >= 0 ? d.heading : d.heading + Math.PI
    this.arrowVel.visible = Math.abs(d.speed) > 0.3
    this.arrowVel.position.set(d.x, 1.9, d.z)
    this.arrowVel.setDirection(V(Math.cos(heading), 0, -Math.sin(heading)))
    this.arrowVel.setLength(1.2 + Math.min(5, Math.abs(d.speed) * 0.4), 0.7, 0.45)
    const acc = Math.hypot(ax, az)
    this.arrowAcc.visible = acc > 0.6
    if (acc > 0.6) {
      this.arrowAcc.position.set(d.x, 1.9, d.z)
      this.arrowAcc.setDirection(V(ax, 0, az).normalize())
      this.arrowAcc.setLength(0.8 + Math.min(3, acc * 0.3), 0.7, 0.45)
    }
    this.controls.target.lerp(V(d.x, 0.8, d.z), 0.12)
    this.camera.position.lerp(V(d.x - Math.cos(d.heading) * 17, 8.5, d.z + Math.sin(d.heading) * 17), 0.06)
    this.emitGauges(dt, () => [
      { label: 'Distance (odometer)', value: `${f1(d.odometer)} m`, tone: 'info' },
      { label: 'Displacement', value: `${f1(disp)} m`, tone: 'warn' },
      { label: 'Speed', value: `${f1(Math.abs(d.speed))} m/s` },
      { label: 'Velocity', value: `${f1(Math.abs(d.speed))} m/s ${Math.abs(d.speed) > 0.1 ? arrowFor(heading) : ''}` },
      { label: 'Acceleration', value: `${f2(Math.min(acc, 99))} m/s²`, tone: acc > 0.6 ? 'ok' : undefined },
    ])
  }

  /* ---- dynamics: heavy crate ---- */
  /** Pushes the heavy crate with a steady force (N). Also used by the force slider. */
  async runPushHeavy(force: number, mass = 80): Promise<void> {
    this.abort()
    const v = this.view('A')
    await this.flyTo(v.pos, v.target, 1100)
    if (this.disposed) return
    const X0 = -9
    this.crateHeavy.position.set(X0, 0.1, 0)
    const m = mass
    const k = Math.cbrt(mass / 80)
    this.crateHeavy.scale.setScalar(k)
    this.relabel(this.labelCrate, `Heavy crate · ${f1(mass).replace(/\.0$/, '')} kg`)
    const state = { x: 0, v: 0, t: 0, moving: false }
    const half = 0.6 * CRATE_HEAVY * 0.36 * k // half the crate's width
    return this.begin({
      update: (dt) => {
        state.t += dt
        const f = force * Math.min(1, state.t / 1.5)
        const p = pushOnFloor(f, m, 0.5, 0.4, state.moving)
        state.moving = p.moving
        if (p.moving) {
          state.v = Math.max(0, state.v + p.accel * dt)
          state.x += state.v * dt
        }
        const wobble = !p.moving && f > 3 ? Math.sin(state.t * 40) * 0.004 * Math.min(1, f / 200) : 0
        this.crateHeavy.position.x = X0 + state.x + wobble
        const cx = X0 + state.x
        this.pushArrow.visible = f > 1
        this.pushArrow.position.set(cx - half - 0.2 - (0.4 + f * 0.012), 0.8, 0.6)
        this.pushArrow.setDirection(V(1, 0, 0))
        this.pushArrow.setLength(0.4 + f * 0.012, 0.35, 0.25)
        this.frictionArrow.visible = p.friction > 1
        this.frictionArrow.position.set(cx + half + 0.2 + (0.4 + p.friction * 0.012), 0.35, 0.6)
        this.frictionArrow.setDirection(V(-1, 0, 0))
        this.frictionArrow.setLength(0.4 + p.friction * 0.012, 0.35, 0.25)
        this.emitGauges(dt, () => [
          { label: 'Your push', value: `${f1(f)} N`, tone: 'info' },
          { label: p.moving ? 'Sliding friction' : 'Static friction', value: `${f1(p.friction)} N`, tone: 'warn' },
          { label: 'Net force', value: `${f1(p.net)} N` },
          { label: 'Speed', value: `${f2(state.v)} m/s` },
        ])
        if (state.t > 8 || X0 + state.x > -3.2) {
          this.events.onNote?.(state.moving ? 'The push was bigger than the friction limit, so the crate accelerates.' : 'The crate has not moved. The floor pushes back as hard as you push.')
          this.pushArrow.visible = false
          this.frictionArrow.visible = false
          return 700
        }
        return null
      },
      done: () => {
        this.pushArrow.visible = false
        this.frictionArrow.visible = false
        this.crateHeavy.position.set(X0, 0.1, 0)
      },
    })
  }

  /* ---- dynamics: floating crate (Newton's first and second laws) ---- */
  private async runZeroG(o: { force: number; mass: number; pushTime: number; total: number; notes: boolean }): Promise<void> {
    this.abort()
    const v = this.view('B')
    await this.flyTo(v.pos, v.target, 1100)
    if (this.disposed) return
    this.crateBig.visible = false
    this.ruler.visible = true
    const x0 = -3
    const y0 = 1.8
    this.crateFloat.position.set(x0, y0, 0)
    this.crateFloat.scale.setScalar(Math.cbrt(o.mass / 20))
    const st = { t: 0, v: 0, dist: 0 }
    const lift = o.mass > 20 ? 0.25 : 0
    const myFlight = this.flightId
    // The camera glides along with the crate so it stays in view while the ruler and the stars slide past.
    this.follow = (dt) => {
      if (this.flightId !== myFlight) {
        this.follow = null
        return
      }
      const c = this.crateFloat.position
      this.controls.target.lerp(V(c.x + 1.2, 1.9, 0), 1 - Math.pow(0.0015, dt))
      this.camera.position.lerp(V(c.x + 0.6, 2.7, 8.8), 1 - Math.pow(0.01, dt))
    }
    return this.begin({
      update: (dt) => {
        st.t += dt
        const force = st.t < o.pushTime ? o.force : 0
        const accel = force / o.mass
        st.v += accel * dt
        st.dist += st.v * dt
        this.crateFloat.position.x = x0 + st.dist
        this.crateFloat.rotation.y = Math.sin(st.t * 0.4) * 0.05
        const cx = this.crateFloat.position.x
        this.pushArrow.visible = force > 0
        if (force > 0) {
          this.pushArrow.position.set(cx - 2.4, y0 + lift, 0)
          this.pushArrow.setDirection(V(1, 0, 0))
          this.pushArrow.setLength(1.8, 0.45, 0.3)
        }
        // speed arrow on the crate: it grows with the speed and stays on once the push is over
        this.speedArrow.visible = st.v > 0.02
        if (st.v > 0.02) {
          this.speedArrow.position.set(cx - 0.3, y0 + 1.2 * Math.cbrt(o.mass / 20) + 0.2, 0)
          this.speedArrow.setDirection(V(1, 0, 0))
          this.speedArrow.setLength(0.35 + Math.min(4.5, st.v * 1.5), 0.4, 0.3)
        }
        this.emitGauges(dt, () => [
          { label: 'Force on the crate', value: `${f1(force)} N`, tone: 'info' },
          { label: 'Mass', value: `${f1(o.mass)} kg` },
          { label: 'Acceleration', value: `${f2(accel)} m/s²`, tone: accel > 0 ? 'ok' : undefined },
          { label: 'Speed', value: `${f2(st.v)} m/s`, tone: 'ok' },
          { label: 'Distance drifted', value: `${f1(st.dist)} m` },
        ])
        if (o.notes && st.t > 1.6 && st.t < 1.7) this.events.onNote?.('The push is over. Nothing is acting on the crate now.')
        if (o.notes && st.t > 9) this.events.onNote?.('Still the same speed. Nothing slows it down.')
        if (!o.notes && st.t > o.pushTime && st.t < o.pushTime + 0.1) this.events.onNote?.(`F = m a  →  ${f1(o.force)} N ÷ ${f1(o.mass)} kg = ${f2(o.force / o.mass)} m/s²`)
        if (st.t > o.total) return 400
        return null
      },
      done: () => {
        // back to where it started, and the camera back with it
        this.follow = null
        this.ruler.visible = false
        this.pushArrow.visible = false
        this.speedArrow.visible = false
        this.crateFloat.scale.setScalar(1)
        this.crateFloat.position.set(x0, y0, 0)
        const back = this.view('B')
        void this.flyTo(back.pos, back.target, 1000)
      },
    })
  }

  /* ---- dynamics: action and reaction (Newton's third law) ---- */
  private async runPushApart(mL = 20, mR = 60, F = 30): Promise<void> {
    this.abort()
    const v = this.view('B2')
    await this.flyTo(v.pos, v.target, 1100)
    if (this.disposed) return
    const kl = Math.cbrt(mL / 20)
    const kr = Math.cbrt(mR / 60)
    this.crateFloat.scale.setScalar(kl)
    this.crateBig.scale.setScalar(kr)
    const hl = ((CRATE_FLOAT * 0.36) / 2) * kl
    const hr = ((CRATE_BIG * 0.36) / 2) * kr
    const cx = -3
    const y = 1.8
    const st = { t: 0, xl: cx - hl - 0.02, xr: cx + hr + 0.02, vl: 0, vr: 0 }
    this.crateBig.visible = true
    this.crateBig.position.set(st.xr, y, 0)
    this.crateFloat.position.set(st.xl, y, 0)
    this.crateFloat.rotation.y = 0
    const push = 0.6
    const spring = this.spring!
    const lenArrow = 1.6
    return this.begin({
      update: (dt) => {
        st.t += dt
        const f = st.t < push ? F : 0
        st.vl -= (f / mL) * dt
        st.vr += (f / mR) * dt
        st.xl += st.vl * dt
        st.xr += st.vr * dt
        this.crateFloat.position.x = st.xl
        this.crateBig.position.x = st.xr
        const gap = Math.max(0.05, st.xr - hr - (st.xl + hl))
        spring.visible = f > 0
        spring.position.set((st.xl + hl + st.xr - hr) / 2, y + 0.45, 0)
        spring.scale.set(1, Math.max(0.05, gap), 1)
        // equal and opposite: the same length, pointing apart
        this.frictionArrow.visible = f > 0
        this.pushArrow.visible = f > 0
        if (f > 0) {
          this.frictionArrow.position.set(st.xl - hl - 0.1, y + 0.9, 0.5)
          this.frictionArrow.setDirection(V(-1, 0, 0))
          this.frictionArrow.setLength(lenArrow, 0.4, 0.3)
          this.pushArrow.position.set(st.xr + hr + 0.1, y + 0.9, 0.5)
          this.pushArrow.setDirection(V(1, 0, 0))
          this.pushArrow.setLength(lenArrow, 0.4, 0.3)
        }
        this.emitGauges(dt, () => [
          { label: 'Force on the left crate', value: `${f1(f)} N ←`, tone: 'warn' },
          { label: 'Force on the right crate', value: `${f1(f)} N →`, tone: 'info' },
          { label: `Left crate (${mL} kg)`, value: `${f2(Math.abs(st.vl))} m/s`, tone: 'ok' },
          { label: `Right crate (${mR} kg)`, value: `${f2(st.vr)} m/s`, tone: 'ok' },
          { label: 'Accelerations', value: f > 0 ? `${f2(f / mL)} and ${f2(f / mR)} m/s²` : '0 m/s²' },
        ])
        if (st.t > push + 0.1 && st.t < push + 0.2) this.events.onNote?.('Equal forces, opposite directions. The lighter crate gets the bigger acceleration.')
        if (st.t > 5.2) return 500
        return null
      },
      done: () => {
        this.pushArrow.visible = false
        this.frictionArrow.visible = false
        spring.visible = false
        this.crateFloat.scale.setScalar(1)
        this.crateBig.scale.setScalar(1)
        this.crateBig.visible = false
        this.crateFloat.position.set(-3, 1.8, 0)
      },
    })
  }

  /* ---- dynamics: balls ---- */
  private async runCollide(m1 = 5, v1 = 4, m2 = 1): Promise<void> {
    this.abort()
    const v = this.view('C')
    await this.flyTo(v.pos, v.target, 1100)
    if (this.disposed) return
    this.resetBalls(m1, m2)
    const r1 = 0.32 * Math.cbrt(m1 / 5)
    const r2 = 0.2 * Math.cbrt(m2 / 1)
    const slow = 0.4 // slow motion so the eye can follow
    const st = { x1: 0, x2: 3.6, v1, v2: 0, hit: false, t: 0, after: 0 }
    const [u1, u2] = elastic(m1, v1, m2, 0)
    const end = 6.9 // inner face of the stop at the end of the rail
    return this.begin({
      update: (dt) => {
        const d = dt * slow
        st.t += dt
        st.x1 += st.v1 * d
        st.x2 += st.v2 * d
        if (!st.hit && st.x2 - st.x1 <= r1 + r2) {
          st.hit = true
          st.v1 = u1
          st.v2 = u2
          sound.hit()
        }
        if (st.hit) st.after += dt
        this.ballHeavy.position.x = st.x1
        this.ballLight.position.x = st.x2
        this.labelHeavy.position.x = st.x1
        this.labelLight.position.x = st.x2
        this.ballHeavy.rotation.z -= (st.v1 * d) / r1
        this.ballLight.rotation.z -= (st.v2 * d) / r2
        const p1 = m1 * st.v1
        const p2 = m2 * st.v2
        this.emitGauges(dt, () => [
          { label: `Ball A speed (${m1} kg)`, value: `${f1(st.v1)} m/s` },
          { label: `Ball B speed (${m2} kg)`, value: `${f1(st.v2)} m/s` },
          { label: 'Ball A momentum', value: `${f1(p1)} kg·m/s`, tone: 'info' },
          { label: 'Ball B momentum', value: `${f1(p2)} kg·m/s`, tone: 'info' },
          { label: 'Total momentum', value: `${f1(p1 + p2)} kg·m/s`, tone: 'ok' },
        ])
        // stop on the last full picture: after a moment, or before a ball reaches the end of the rail
        if (st.after > 1.3 || st.t > 14 || st.x2 >= end - r2 || st.x1 <= -0.9) return 500
        return null
      },
      done: () => undefined,
    })
  }

  /* ---- dynamics: cradle ---- */
  private async runCradle(n = 2, side: 'left' | 'right' = 'left'): Promise<void> {
    this.abort()
    const v = this.view('D')
    await this.flyTo(v.pos, v.target, 1100)
    if (this.disposed) return
    const st = { t: 0, last: -1 }
    const balls = this.cradleBalls
    const len = balls.length
    return this.begin({
      update: (dt) => {
        st.t += dt
        const a = cradleAngle(st.t)
        // Lift n balls on one side; the same number swing out on the other. A mirrored run swings the other way.
        balls.forEach((b, i) => {
          const lifted = side === 'left' ? i < n : i >= len - n
          const out = side === 'left' ? i >= len - n : i < n
          const sign = side === 'left' ? 1 : -1
          if (lifted) b.rotation.z = sign * a.left
          else if (out) b.rotation.z = sign * a.right
          else b.rotation.z = 0
        })
        const phase = Math.floor(st.t / 0.4)
        if (phase !== st.last && phase % 2 === 0) {
          st.last = phase
          if (phase > 0) sound.hit()
        }
        const swinging = a.right > 0.02
        this.emitGauges(dt, () => [
          { label: `Balls lifted and released (${side})`, value: String(n), tone: 'info' },
          { label: `Balls swinging out the ${side === 'left' ? 'right' : 'left'}`, value: len ? String(swinging ? n : 0) : '–', tone: 'ok' },
        ])
        if (st.t > 6.4) {
          balls.forEach((b) => (b.rotation.z = 0))
          return 300
        }
        return null
      },
      done: () => balls.forEach((b) => (b.rotation.z = 0)),
    })
  }

  /* ---- gravitation ---- */
  private async runDrop(which: 'air' | 'vacuum', height = DROP_HEIGHT): Promise<void> {
    this.abort()
    this.resetDrop('air', height)
    this.resetDrop('vacuum', height)
    const v = this.view('tubes')
    await this.flyTo(v.pos, v.target, 1000)
    if (this.disposed) return
    const rec = this.drops[which]
    const x = this.dropX(which)
    const air = which === 'air'
    const ball = simulateFall(height, air ? BALL_TERMINAL : null)
    const feather = simulateFall(height, air ? FEATHER_TERMINAL : null)
    const top = POD + height
    const st = { t: -0.6, thudBall: false, thudFeather: false }
    return this.begin({
      update: (dt) => {
        st.t += dt
        const open = Math.max(0, Math.min(1, (st.t + 0.6) / 0.5))
        rec.door.position.x = x + open * 0.9
        const t = Math.max(0, st.t)
        const b = ball.at(t)
        const f = feather.at(t)
        const bt = Math.min(t, ball.time)
        const ft = Math.min(t, feather.time)
        void bt
        rec.ball.position.y = top + R_BALL - b.fallen
        rec.feather.position.y = top + 0.06 - f.fallen
        if (air) {
          const flutter = Math.min(1, f.fallen / 0.5) * (t < feather.time ? 1 : 0)
          rec.feather.rotation.z = Math.sin(t * 5.5) * 0.7 * flutter
          rec.feather.rotation.x = Math.sin(t * 3.1) * 0.5 * flutter
          rec.feather.position.x = x + 0.2 + Math.sin(t * 2.7) * 0.13 * flutter
        } else rec.feather.rotation.set(0.15, 0, 0.1)
        if (!st.thudBall && t >= ball.time) {
          st.thudBall = true
          sound.thud()
        }
        if (!st.thudFeather && t >= feather.time) {
          st.thudFeather = true
          sound.thud()
        }
        void ft
        this.emitGauges(dt, () => [
          { label: 'Time', value: `${f2(Math.max(0, Math.min(t, Math.max(ball.time, feather.time))))} s` },
          { label: 'Metal ball', value: t >= ball.time ? `landed at ${f2(ball.time)} s` : `${f1(b.speed)} m/s`, tone: t >= ball.time ? 'ok' : 'info' },
          { label: 'Feather', value: t >= feather.time ? `landed at ${f2(feather.time)} s` : `${f1(f.speed)} m/s`, tone: t >= feather.time ? 'ok' : 'info' },
          { label: 'Tube', value: air ? 'Air' : 'Vacuum' },
        ])
        if (t > Math.max(ball.time, feather.time) + 0.8) {
          return 300
        }
        return null
      },
      done: () => undefined,
    })
  }

  /** Watch an experiment again, or put the stage back. */
  reset() {
    this.abort()
    this.hideArrows()
    this.events.onGauges?.(null)
    this.events.onNote?.(null)
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
    if (this.freeDriving && !this.job) this.stepFreeDrive(dt)
    this.follow?.(dt)
    const air = this.drops.air?.dust
    if (air && this.moduleId === 'gravitation_drop') {
      const a = (air.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array
      const t = this.clock.elapsedTime
      for (let i = 0; i < a.length; i += 3) {
        a[i] += Math.sin(t * 0.7 + i) * 0.0006
        a[i + 1] += Math.cos(t * 0.5 + i) * 0.0008
      }
      air.geometry.attributes.position.needsUpdate = true
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
    window.removeEventListener('keydown', this.onKey)
    window.removeEventListener('keyup', this.onKey)
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

void G
void LAP
