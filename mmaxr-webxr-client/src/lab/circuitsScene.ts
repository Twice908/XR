import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { MotionLessonContract } from '@mmaxr/schema'
import { sound } from './sound'
import { stageSet } from './stage'
import type { Gauge, MotionSceneEvents, SandboxScene } from './motionScene'
import { bulbs, currentThrough, fuse, glowColor, resistorBands, voltageToBlow, type Wiring } from './circuitPhysics'

/*
 * Three small circuit benches in one scene, built on the breadboard model and read with the multimeter model:
 * Ohm's law, two bulbs in series and in parallel, and a fuse wire heating up. The batteries, copper wires and
 * switch are drawn the same way as in the electromagnetism lab. The scene only simulates and draws: it never names
 * an answer. What a result means comes from the server, after the student has watched it.
 */
const MODULE_X: Record<string, number> = { ohms_law: 0, series_parallel: 300, heating_fuse: 600 }
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
type Ease = (t: number) => number
const easeInOut: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const f2 = (n: number) => (Math.abs(n) < 0.005 ? '0.00' : n.toFixed(2))
const f1 = (n: number) => (Math.abs(n) < 0.05 ? '0.0' : n.toFixed(1))
const BOARD_W = 16
const TOP = 1.4 // the top of the breadboard
const BAND = [0x111111, 0x7a4a1e, 0xd7263d, 0xf59e0b, 0xfacc15, 0x16a34a, 0x2563eb, 0x7c3aed, 0x808080, 0xf5f5f5]

interface Job {
  update(dt: number): number | null
  done(): void
}

/** Text that can be changed, drawn on a small panel. */
export class Readout extends THREE.Mesh {
  private readonly ctx: CanvasRenderingContext2D
  private readonly tex: THREE.CanvasTexture
  constructor(
    w: number,
    h: number,
    private readonly bg = 'rgba(8,12,20,0.85)',
    private readonly fg = '#e6edf7',
  ) {
    const c = document.createElement('canvas')
    c.width = 384
    c.height = Math.round((384 * h) / w)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    super(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }))
    this.ctx = c.getContext('2d')!
    this.tex = tex
    this.renderOrder = 6
  }
  set(text: string, fg = this.fg) {
    const c = this.ctx.canvas
    this.ctx.clearRect(0, 0, c.width, c.height)
    this.ctx.fillStyle = this.bg
    this.ctx.beginPath()
    this.ctx.roundRect(4, 4, c.width - 8, c.height - 8, 22)
    this.ctx.fill()
    this.ctx.fillStyle = fg
    this.ctx.font = `700 ${Math.round(c.height * 0.52)}px system-ui, sans-serif`
    this.ctx.textAlign = 'center'
    this.ctx.textBaseline = 'middle'
    this.ctx.fillText(text, c.width / 2, c.height / 2 + 2)
    this.tex.needsUpdate = true
  }
}

/** A bulb on its socket: glass, a filament, a light, and a way to unscrew it. */
class Bulb {
  readonly group = new THREE.Group()
  private readonly bulb = new THREE.Group()
  private readonly glassMat: THREE.MeshStandardMaterial
  private readonly fil: THREE.Mesh
  private readonly light = new THREE.PointLight(0xffd27a, 0, 9, 2)
  present = true
  constructor() {
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.5, 20), new THREE.MeshStandardMaterial({ color: 0x9aa3b2, metalness: 0.85, roughness: 0.3 }))
    socket.position.y = 0.25
    socket.castShadow = true
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.5, 18), new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1, roughness: 0.3 }))
    screw.position.y = 0.72
    this.glassMat = new THREE.MeshStandardMaterial({ color: 0xfff3cf, transparent: true, opacity: 0.55, roughness: 0.08, metalness: 0, emissive: 0xffb347, emissiveIntensity: 0 })
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.95, 28, 20), this.glassMat)
    glass.position.y = 1.9
    this.fil = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.05, 8, 20), new THREE.MeshStandardMaterial({ color: 0x777777, emissive: 0xffe29a, emissiveIntensity: 0 }))
    this.fil.position.y = 1.85
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 8), new THREE.MeshStandardMaterial({ color: 0x888888 }))
    stalk.position.y = 1.2
    this.bulb.add(screw, glass, this.fil, stalk)
    this.light.position.y = 2
    this.group.add(socket, this.bulb, this.light)
  }
  /** Brightness relative to one bulb on its own across the same battery: 0 is off, 1 is full. */
  setBrightness(b: number) {
    const k = this.present ? Math.max(0, b) : 0
    this.glassMat.emissiveIntensity = Math.min(1.6, k * 1.4)
    ;(this.fil.material as THREE.MeshStandardMaterial).emissiveIntensity = Math.min(3, k * 2.6)
    this.light.intensity = k * 26
  }
  /** Unscrews (0 = in, 1 = out and lifted away). */
  unscrew(t: number) {
    this.bulb.position.y = t * 3.4
    this.bulb.rotation.y = t * Math.PI * 4
    this.bulb.position.x = t * 0.4
    this.present = t < 0.5
  }
  reset() {
    this.unscrew(0)
    this.setBrightness(0)
  }
}

/** A resistor with colour bands for its value. */
class Resistor {
  readonly group = new THREE.Group()
  private readonly bands: THREE.Mesh[] = []
  private readonly body: THREE.Mesh
  constructor(len = 2.6) {
    this.body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, len, 20), new THREE.MeshStandardMaterial({ color: 0xd9c4a0, roughness: 0.6 }))
    this.body.rotation.z = Math.PI / 2
    this.body.castShadow = true
    this.group.add(this.body)
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.22, 20), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 }))
      b.rotation.z = Math.PI / 2
      b.position.x = -0.7 + i * 0.45
      this.bands.push(b)
      this.group.add(b)
    }
    const gold = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.16, 20), new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.3 }))
    gold.rotation.z = Math.PI / 2
    gold.position.x = 0.85
    this.group.add(gold)
    for (const s of [-1, 1]) {
      const lead = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 8), new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 1, roughness: 0.3 }))
      lead.rotation.z = Math.PI / 2
      lead.position.x = s * (len / 2 + 0.4)
      this.group.add(lead)
    }
  }
  setOhms(ohms: number) {
    const [a, b, m] = resistorBands(ohms)
    ;[a, b, m].forEach((d, i) => (this.bands[i].material as THREE.MeshStandardMaterial).color.setHex(BAND[Math.max(0, Math.min(9, d))]))
  }
}

export class CircuitsScene implements SandboxScene {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  private readonly clock = new THREE.Clock()
  private readonly pointer = new THREE.Vector2(10, 10)
  private readonly raycaster = new THREE.Raycaster()
  private readonly handPoint = new THREE.Vector3(0, 1, 0.5)
  private readonly handPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private groups: Record<string, THREE.Group> = {}
  private moduleId = 'ohms_law'
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
  private boardModel: THREE.Object3D | null = null
  private meterModel: THREE.Object3D | null = null
  private readonly onResize = () => this.resize()

  /* ---- Ohm's law ---- */
  private ohmRes = new Resistor()
  private ohmVolt!: Readout
  private ohmMeter!: Readout
  private ohmMeterShown: Readout[] = []
  private ohmGraph!: Readout
  private graphCtx!: CanvasRenderingContext2D
  private graphTex!: THREE.CanvasTexture
  private ohmFlow: THREE.Mesh[] = []
  private ohmWires = new THREE.Group()

  /* ---- bulbs ---- */
  private bulbA = new Bulb()
  private bulbB = new Bulb()
  private bulbRef = new Bulb()
  private bulbWires = new THREE.Group()
  private bulbLever = new THREE.Group()
  private bulbMeter!: Readout
  private bulbVolt!: Readout
  private bulbMode: Wiring = 'series'

  /* ---- fuse ---- */
  private fuseLoad = new Resistor(2.6)
  private fuseWire!: THREE.Mesh
  private fuseHalves: THREE.Mesh[] = []
  private thickLead!: THREE.Mesh
  private fuseVolt!: Readout
  private fuseMeter!: Readout
  private fuseTag!: Readout
  private sparks: { m: THREE.Mesh; v: THREE.Vector3; life: number }[] = []
  private fuseSparkGroup = new THREE.Group()

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
    this.controls.minDistance = 4
    this.controls.maxDistance = 40
    this.controls.addEventListener('start', () => (this.flightId += 1))

    const scene = this.scene
    scene.background = new THREE.Color(0x0b0d12)
    scene.fog = new THREE.Fog(0x0b0d12, 40, 160)
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.45
    scene.add(new THREE.HemisphereLight(0x9bb4ff, 0x1a1410, 0.32))
    for (const id of Object.keys(MODULE_X)) {
      const g = new THREE.Group()
      g.position.x = MODULE_X[id]
      g.visible = id === this.moduleId
      this.groups[id] = g
      scene.add(g)
      stageSet(g, { cx: 0, cz: 0, w: 28, d: 15, wall: { z: -7.6, h: 10 }, key: [4, 16, 12], aim: [0, 1, 0], keyI: 520, rimI: 110, rimAt: [10, 8, 6], dust: { n: 90, h: 9 } })
    }
    this.buildOhm()
    this.buildBulbs()
    this.buildFuse()
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

  /* ---------------- small builders (the same look as the electromagnetism lab) ---------------- */
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

  /** A copper wire through the points, as a thin metal tube. */
  private wire(points: THREE.Vector3[], r = 0.09, color = 0xc97a3d): THREE.Mesh {
    const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.04)
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(12, points.length * 10), r, 8, false), new THREE.MeshStandardMaterial({ color, metalness: 0.9, roughness: 0.3 }))
    m.castShadow = true
    return m
  }

  /** A battery lying along x: + terminal at +x. */
  private battery(len = 3): THREE.Group {
    const g = new THREE.Group()
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, len, 28), new THREE.MeshStandardMaterial({ color: 0x1f6f5c, metalness: 0.6, roughness: 0.35 }))
    body.rotation.z = Math.PI / 2
    body.castShadow = true
    g.add(body)
    const cap = (x: number, text: string, color: string) => {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.22, 20), new THREE.MeshStandardMaterial({ color: 0xd9b25f, metalness: 1, roughness: 0.25 }))
      c.rotation.z = Math.PI / 2
      c.position.x = x
      const l = this.label(text, color, 0.4)
      l.position.set(x, 1.1, 0)
      g.add(c, l)
    }
    cap(len / 2 + 0.1, '+', '#ff8aa0')
    cap(-len / 2 - 0.1, '−', '#9fd0ff')
    return g
  }

  private switchLever(): THREE.Group {
    const g = new THREE.Group()
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 0.7), new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.5 }))
    base.position.y = 0.1
    const lever = new THREE.Group()
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 0.2), new THREE.MeshStandardMaterial({ color: 0xd9b25f, metalness: 1, roughness: 0.25 }))
    arm.position.x = 0.65
    lever.add(arm)
    lever.position.set(-0.65, 0.3, 0)
    g.add(base, lever)
    g.userData.lever = lever
    return g
  }

  /** The breadboard under every bench. */
  private placeBoard(g: THREE.Group, at = V(0, 0, 0)) {
    const wrap = new THREE.Group()
    wrap.position.copy(at)
    if (this.boardModel) {
      const m = this.boardModel.clone(true)
      const k = BOARD_W / 0.165
      m.scale.setScalar(k)
      m.traverse((o) => {
        if (o instanceof THREE.Mesh) o.receiveShadow = true
      })
      wrap.add(m)
    } else {
      const m = new THREE.Mesh(new THREE.BoxGeometry(BOARD_W, TOP, 5.3), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.6 }))
      m.position.y = TOP / 2
      wrap.add(m)
    }
    g.add(wrap)
  }

  /** The multimeter lying on the table, with a digital display drawn over its screen. */
  private placeMeter(g: THREE.Group, at: THREE.Vector3): Readout {
    const wrap = new THREE.Group()
    wrap.position.copy(at)
    const display = new Readout(2.35, 1.0, '#a9bf9a', '#16210f')
    display.set('0.00 A')
    if (this.meterModel) {
      const m = this.meterModel.clone(true)
      m.scale.setScalar(40)
      m.rotation.y = 0
      m.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = true
          o.receiveShadow = true
        }
      })
      wrap.add(m)
      // the screen sits near the far end of the body: lay the digits just above the face
      display.rotation.x = -Math.PI / 2
      display.position.set(0, 0.0, 0)
      m.updateMatrixWorld(true)
      const ray = new THREE.Raycaster(new THREE.Vector3(0, 20, -3.05), new THREE.Vector3(0, -1, 0))
      const hit = ray.intersectObject(m, true)[0]
      display.position.set(0, (hit ? hit.point.y : 3.2) + 0.03, -3.05)
    } else {
      const body = new THREE.Mesh(new THREE.BoxGeometry(3.8, 1.2, 7.2), new THREE.MeshStandardMaterial({ color: 0x88d8b0, roughness: 0.5 }))
      body.position.y = 0.6
      wrap.add(body)
      display.rotation.x = -Math.PI / 2
      display.position.set(0, 1.25, -2.6)
    }
    wrap.add(display)
    g.add(wrap)
    return display
  }

  /* ---------------- tab 1: Ohm's law ---------------- */
  private buildOhm() {
    const g = this.groups.ohms_law
    this.placeBoard(g)
    const bat = this.battery(3)
    bat.position.set(-5.8, TOP + 0.55, -1.0)
    this.ohmRes.group.position.set(0.2, TOP + 0.5, -1.0)
    this.ohmRes.setOhms(10)
    this.ohmVolt = new Readout(3.2, 0.9)
    this.ohmVolt.position.set(-5.8, TOP + 2.7, -1.0)
    this.ohmVolt.rotation.x = -0.5
    this.ohmVolt.set('0.0 V')
    this.ohmMeter = this.placeMeter(g, V(7.4, 0, 2.6))
    this.ohmMeterShown.push(this.ohmMeter)
    const resTag = this.label('resistor', '#ffd9a0', 0.5)
    resTag.position.set(0.2, TOP + 1.9, -1.0)
    const meterTag = this.label('ammeter', '#9fd0ff', 0.55)
    meterTag.position.set(7.4, 4.4, 2.6)
    this.rebuildOhmWires()
    this.ohmGraph = new Readout(9, 6.2, 'rgba(8,12,20,0.88)')
    this.ohmGraph.position.set(0.6, 5.6, -5.6)
    const c = document.createElement('canvas')
    c.width = 576
    c.height = 400
    this.graphTex = new THREE.CanvasTexture(c)
    this.graphTex.colorSpace = THREE.SRGBColorSpace
    this.graphCtx = c.getContext('2d')!
    ;(this.ohmGraph.material as THREE.MeshBasicMaterial).map = this.graphTex
    this.drawGraph([], 'vi', 0)
    for (let i = 0; i < 6; i++) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshBasicMaterial({ color: 0x7fe0ff }))
      dot.userData.u = i / 6
      dot.visible = false
      this.ohmFlow.push(dot)
      g.add(dot)
    }
    g.add(bat, this.ohmRes.group, this.ohmVolt, resTag, meterTag, this.ohmGraph, this.ohmWires)
  }

  private ohmPath(): THREE.CatmullRomCurve3 {
    return new THREE.CatmullRomCurve3([V(-4.2, TOP + 0.6, -1), V(-4.2, TOP + 1.6, -1), V(-1.5, TOP + 1.6, -1), V(-1.1, TOP + 0.6, -1), V(1.5, TOP + 0.6, -1), V(2.6, TOP + 1.6, -1), V(5.2, TOP + 1.6, 1.5), V(6.4, TOP + 0.9, 2.2), V(6.4, TOP + 0.9, 4.6), V(-7.4, TOP + 1.6, 3.6), V(-7.4, TOP + 1.6, -1), V(-7.4, TOP + 0.6, -1)], true, 'catmullrom', 0.05)
  }
  private rebuildOhmWires() {
    this.ohmWires.clear()
    const y = TOP + 0.6
    this.ohmWires.add(
      this.wire([V(-4.2, y, -1), V(-4.2, y + 1, -1), V(-1.5, y + 1, -1), V(-1.1, y, -1)], 0.09, 0xd7263d),
      this.wire([V(1.5, y, -1), V(2.6, y + 1, -1), V(5.2, y + 1, 1.5), V(6.5, y + 0.1, 2.5)], 0.09, 0xd7263d),
      this.wire([V(8.3, y + 0.1, 4.6), V(8.3, y + 1, 4.6), V(-7.4, y + 1, 3.6), V(-7.4, y + 1, -1), V(-7.4, y, -1)], 0.09, 0x222831),
    )
  }

  /** A V–I (or I–R) graph drawn on the panel behind the board. Points are [x, y] in volts and amps (or ohms and amps). */
  private drawGraph(pts: [number, number][], mode: 'vi' | 'ir', slope: number) {
    const c = this.graphCtx
    const W = c.canvas.width
    const H = c.canvas.height
    c.clearRect(0, 0, W, H)
    c.fillStyle = 'rgba(8,12,20,0.9)'
    c.beginPath()
    c.roundRect(4, 4, W - 8, H - 8, 24)
    c.fill()
    const L = 74
    const B = H - 62
    const T = 40
    const R = W - 34
    const xmax = mode === 'vi' ? 14 : 30
    const ymax = mode === 'vi' ? 3.2 : 4
    c.strokeStyle = 'rgba(255,255,255,0.12)'
    c.lineWidth = 1
    for (let i = 0; i <= 7; i++) {
      c.beginPath()
      c.moveTo(L + ((R - L) * i) / 7, T)
      c.lineTo(L + ((R - L) * i) / 7, B)
      c.stroke()
    }
    for (let j = 0; j <= 4; j++) {
      c.beginPath()
      c.moveTo(L, B - ((B - T) * j) / 4)
      c.lineTo(R, B - ((B - T) * j) / 4)
      c.stroke()
    }
    c.strokeStyle = '#cdd6f4'
    c.lineWidth = 3
    c.beginPath()
    c.moveTo(L, T - 8)
    c.lineTo(L, B)
    c.lineTo(R + 8, B)
    c.stroke()
    c.fillStyle = '#cdd6f4'
    c.font = '600 26px system-ui, sans-serif'
    c.textAlign = 'center'
    c.fillText(mode === 'vi' ? 'Voltage V (volts)' : 'Resistance R (ohms)', (L + R) / 2, H - 14)
    c.save()
    c.translate(24, (T + B) / 2)
    c.rotate(-Math.PI / 2)
    c.fillText('Current I (amps)', 0, 0)
    c.restore()
    c.font = '500 20px system-ui, sans-serif'
    c.fillStyle = 'rgba(205,214,244,0.8)'
    for (let i = 0; i <= 7; i += 1) c.fillText(String(Math.round((xmax * i) / 7)), L + ((R - L) * i) / 7, B + 24)
    c.textAlign = 'right'
    for (let j = 0; j <= 4; j++) c.fillText(f1((ymax * j) / 4), L - 8, B - ((B - T) * j) / 4 + 7)
    const px = (x: number) => L + ((R - L) * Math.min(x, xmax)) / xmax
    const py = (y: number) => B - ((B - T) * Math.min(y, ymax)) / ymax
    if (mode === 'vi' && pts.length && slope > 0) {
      c.strokeStyle = '#ffd166'
      c.lineWidth = 4
      c.beginPath()
      c.moveTo(px(0), py(0))
      c.lineTo(px(xmax), py(xmax * slope))
      c.stroke()
    }
    if (mode === 'ir' && pts.length > 1) {
      c.strokeStyle = '#ffd166'
      c.lineWidth = 4
      c.beginPath()
      pts.forEach(([x, y], i) => (i ? c.lineTo(px(x), py(y)) : c.moveTo(px(x), py(y))))
      c.stroke()
    }
    c.fillStyle = '#7fe0ff'
    for (const [x, y] of pts) {
      c.beginPath()
      c.arc(px(x), py(y), 9, 0, Math.PI * 2)
      c.fill()
    }
    this.graphTex.needsUpdate = true
  }

  private ohmBegin(R: number, I: number, volts: number, on: boolean, dt: number, t: number) {
    this.ohmRes.setOhms(R)
    this.ohmVolt.set(`${f1(volts)} V`, '#ffd9a0')
    this.ohmMeter.set(`${f2(on ? I : 0)} A`)
    const path = this.ohmPath()
    for (const d of this.ohmFlow) {
      d.visible = on && I > 0.001
      if (!d.visible) continue
      const speed = 0.05 + 0.5 * Math.min(1, I / 3.2)
      d.userData.u = (d.userData.u + speed * dt) % 1
      d.position.copy(path.getPointAt(d.userData.u))
      d.scale.setScalar(0.7 + Math.min(1, I / 3) * 0.7)
    }
    void t
  }

  private async runOhm(p: { R: number; v1: number; v2: number }) {
    this.abort()
    this.drawGraph([], 'vi', 0)
    const v = this.view('ohm')
    await this.flyTo(v.pos, v.target, 1000)
    if (this.disposed) return
    const pts: [number, number][] = []
    const st = { t: 0, stage: 0 }
    return this.begin({
      update: (dt) => {
        st.t += dt
        // slide the voltage 0 -> v1 over 2 s, rest, then v1 -> v2 over 2 s, rest
        const seg = st.t < 2 ? [0, p.v1, st.t / 2] : st.t < 3.2 ? [p.v1, p.v1, 1] : st.t < 5.2 ? [p.v1, p.v2, (st.t - 3.2) / 2] : [p.v2, p.v2, 1]
        const volts = seg[0] + (seg[1] - seg[0]) * easeInOut(Math.min(1, seg[2]))
        const I = currentThrough(volts, p.R)
        this.ohmBegin(p.R, I, volts, st.t > 0.2, dt, st.t)
        if (st.t > 3.0 && pts.length < 1) pts.push([p.v1, currentThrough(p.v1, p.R)])
        if (st.t > 5.1 && pts.length < 2) pts.push([p.v2, currentThrough(p.v2, p.R)])
        if (pts.length || st.t < 0.1) this.drawGraph(pts, 'vi', 1 / p.R)
        this.emitGauges(dt, () => [
          { label: 'Voltage', value: `${f1(volts)} V`, tone: 'info' },
          { label: 'Resistance', value: `${f1(p.R)} Ω` },
          { label: 'Current', value: `${f2(I)} A`, tone: 'warn' },
        ])
        return st.t > 6.2 ? 900 : null
      },
      done: () => this.ohmFlow.forEach((d) => (d.visible = false)),
    })
  }

  private async runOhmR(p: { v: number; r1: number; r2: number }) {
    this.abort()
    this.drawGraph([], 'ir', 0)
    const v = this.view('ohm')
    await this.flyTo(v.pos, v.target, 1000)
    if (this.disposed) return
    const pts: [number, number][] = []
    const st = { t: 0 }
    return this.begin({
      update: (dt) => {
        st.t += dt
        // the resistance is changed after 2.2 s, in steps so the bands change colour along the way
        const k = st.t < 2.2 ? 0 : easeInOut(Math.min(1, (st.t - 2.2) / 1.6))
        const R = p.r1 + (p.r2 - p.r1) * k
        const I = currentThrough(p.v, R)
        this.ohmBegin(k > 0 ? Math.round(R) : p.r1, I, p.v, st.t > 0.2, dt, st.t)
        if (st.t > 0.4 && pts.length === 0) pts.push([p.r1, currentThrough(p.v, p.r1)])
        if (st.t > 3.9 && pts.length === 1) pts.push([p.r2, currentThrough(p.v, p.r2)])
        if (pts.length) this.drawGraph(pts, 'ir', 0)
        this.emitGauges(dt, () => [
          { label: 'Voltage', value: `${f1(p.v)} V`, tone: 'info' },
          { label: 'Resistance', value: `${f1(R)} Ω` },
          { label: 'Current', value: `${f2(I)} A`, tone: 'warn' },
        ])
        return st.t > 5.4 ? 900 : null
      },
      done: () => this.ohmFlow.forEach((d) => (d.visible = false)),
    })
  }

  /* ---------------- tab 2: series and parallel ---------------- */
  private buildBulbs() {
    const g = this.groups.series_parallel
    this.placeBoard(g)
    const bat = this.battery(3)
    bat.position.set(-6.2, TOP + 0.55, -1.2)
    this.bulbMeter = this.placeMeter(g, V(7.6, 0, 2.8))
    this.bulbVolt = new Readout(3.2, 0.9)
    this.bulbVolt.position.set(-6.2, TOP + 2.7, -1.2)
    this.bulbVolt.rotation.x = -0.5
    this.bulbVolt.set('6.0 V', '#ffd9a0')
    const sw = this.switchLever()
    sw.position.set(-2.8, TOP, 2.6)
    this.bulbLever = sw.userData.lever as THREE.Group
    // the single bulb alone, for comparison, with its own battery
    const bat2 = this.battery(2.2)
    bat2.position.set(3.8, TOP + 0.55, -5.0)
    this.bulbRef.group.position.set(8.2, TOP, -5.0)
    const refTag = this.label('one bulb alone', '#ffd9a0', 0.62)
    refTag.position.set(6, TOP + 4.6, -5)
    const refWire = this.wire([V(5, TOP + 0.6, -5), V(5, TOP + 1.6, -5), V(8.2, TOP + 1.6, -5), V(8.2, TOP + 1.3, -5)], 0.08, 0xd7263d)
    const refWire2 = this.wire([V(2.6, TOP + 0.6, -5), V(2.6, TOP + 1.6, -5), V(2.6, TOP + 1.6, -3.9), V(9.4, TOP + 1.6, -3.9), V(9.4, TOP + 0.5, -5)], 0.08, 0x222831)
    const tag = this.label('ammeter', '#9fd0ff', 0.55)
    tag.position.set(7.6, 4.4, 2.8)
    g.add(bat, this.bulbA.group, this.bulbB.group, this.bulbRef.group, this.bulbVolt, sw, bat2, refTag, refWire, refWire2, tag, this.bulbWires)
    this.layoutBulbs('series')
  }

  private layoutBulbs(mode: Wiring) {
    this.bulbMode = mode
    this.bulbWires.clear()
    const y = TOP + 0.6
    const red = 0xd7263d
    const blk = 0x222831
    if (mode === 'series') {
      this.bulbA.group.position.set(-1.0, TOP, -1.2)
      this.bulbB.group.position.set(3.4, TOP, -1.2)
      this.bulbWires.add(
        this.wire([V(-4.6, y, -1.2), V(-4.6, y + 1.3, -1.2), V(-1.0, y + 1.3, -1.2), V(-1.0, y + 0.6, -1.2)], 0.09, red),
        this.wire([V(-1.0, y + 0.6, -1.2), V(-1.0, y + 1.8, -1.2), V(3.4, y + 1.8, -1.2), V(3.4, y + 0.6, -1.2)], 0.09, red),
        this.wire([V(3.4, y + 0.2, -1.2), V(5.6, y + 0.9, -1.2), V(5.8, y + 0.9, 2.6), V(6.6, y + 0.2, 3.0)], 0.09, red),
        this.wire([V(8.6, y + 0.2, 5.0), V(8.6, y + 1.0, 5.0), V(-3.6, y + 1.0, 2.6), V(-3.6, y + 0.4, 2.6)], 0.09, blk),
        this.wire([V(-2.0, y + 0.4, 2.6), V(-7.6, y + 1.0, 2.6), V(-7.6, y + 1.0, -1.2), V(-7.8, y, -1.2)], 0.09, blk),
      )
    } else {
      this.bulbA.group.position.set(1.0, TOP, -3.0)
      this.bulbB.group.position.set(1.0, TOP, 1.0)
      this.bulbWires.add(
        this.wire([V(-4.6, y, -1.2), V(-4.6, y + 1.3, -1.2), V(-2.6, y + 1.3, -1.2), V(-2.6, y + 1.3, -3), V(1.0, y + 1.3, -3), V(1.0, y + 0.6, -3)], 0.09, red),
        this.wire([V(-2.6, y + 1.3, -1.2), V(-2.6, y + 1.3, 1.0), V(1.0, y + 1.3, 1.0), V(1.0, y + 0.6, 1.0)], 0.09, red),
        this.wire([V(1.0, y + 0.2, -3), V(3.4, y + 0.4, -3), V(3.4, y + 0.4, 1.0), V(1.0, y + 0.2, 1.0)], 0.09, red),
        this.wire([V(3.4, y + 0.4, -1.0), V(5.6, y + 0.9, -1.0), V(5.8, y + 0.9, 2.6), V(6.6, y + 0.2, 3.0)], 0.09, red),
        this.wire([V(8.6, y + 0.2, 5.0), V(8.6, y + 1.0, 5.0), V(-3.6, y + 1.0, 2.6), V(-3.6, y + 0.4, 2.6)], 0.09, blk),
        this.wire([V(-2.0, y + 0.4, 2.6), V(-7.6, y + 1.0, 2.6), V(-7.6, y + 1.0, -1.2), V(-7.8, y, -1.2)], 0.09, blk),
      )
    }
  }

  private setBulbs(mode: Wiring, volts: number, r: number, removed: 0 | 1 | 2, switchOn: boolean) {
    const s = bulbs(mode, volts, r, removed)
    const k = switchOn ? 1 : 0
    this.bulbA.setBrightness(k * s.b1)
    this.bulbB.setBrightness(k * s.b2)
    this.bulbRef.setBrightness(k * 1)
    this.bulbMeter.set(`${f2(k * s.battery)} A`)
    return { ...s, battery: k * s.battery }
  }

  private async stageBulbs(mode: Wiring, remove: number) {
    this.layoutBulbs(mode)
    this.bulbA.reset()
    this.bulbB.reset()
    this.bulbRef.reset()
    this.bulbLever.rotation.z = 0.5
    this.bulbMeter.set('0.00 A')
    void remove
  }

  private async runBulbs(action: string, p: { mode: Wiring; V: number; R: number; remove: number }) {
    this.abort()
    this.bulbVolt.set(`${f1(p.V)} V`, '#ffd9a0')
    await this.stageBulbs(p.mode, p.remove)
    const v = this.view('bulbs')
    await this.flyTo(v.pos, v.target, 1000)
    if (this.disposed) return
    const st = { t: 0 }
    const removing = action === 'bulbs_remove'
    return this.begin({
      update: (dt) => {
        st.t += dt
        const on = st.t > 0.8
        this.bulbLever.rotation.z = on ? 0 : 0.5 * (1 - Math.min(1, Math.max(0, (st.t - 0.4) / 0.4)))
        if (on && st.t < 0.9) sound.click()
        // for the removal experiment the bulb is unscrewed after the circuit has been seen working
        const u = removing ? Math.min(1, Math.max(0, (st.t - 3.2) / 1.4)) : 0
        const out: 0 | 1 | 2 = removing && u > 0.5 ? (p.remove === 2 ? 2 : 1) : 0
        if (removing) (p.remove === 2 ? this.bulbB : this.bulbA).unscrew(u)
        const s = this.setBulbs(p.mode, p.V, p.R, out, on)
        this.emitGauges(dt, () => {
          const pct = (b: number) => `${Math.round(b * 100)}%`
          const out1 = removing && p.remove === 1 && u > 0.5
          const out2 = removing && p.remove === 2 && u > 0.5
          return [
            { label: 'Battery current', value: `${f2(s.battery)} A`, tone: 'info' },
            { label: 'Bulb 1', value: out1 ? 'removed' : s.lit1 && on ? `lit ${pct(s.b1)}` : 'off', tone: s.lit1 && on ? 'ok' : undefined },
            { label: 'Bulb 2', value: out2 ? 'removed' : s.lit2 && on ? `lit ${pct(s.b2)}` : 'off', tone: s.lit2 && on ? 'ok' : undefined },
            { label: 'Single bulb', value: on ? 'lit 100%' : 'off' },
          ]
        })
        return st.t > (removing ? 6.4 : 4.2) ? 900 : null
      },
      done: () => undefined,
    })
  }

  /* ---------------- tab 3: the fuse ---------------- */
  private buildFuse() {
    const g = this.groups.heating_fuse
    this.placeBoard(g)
    const bat = this.battery(3)
    bat.position.set(-6.4, TOP + 0.55, -1.0)
    this.fuseVolt = new Readout(3.2, 0.9)
    this.fuseVolt.position.set(-6.4, TOP + 2.7, -1.0)
    this.fuseVolt.rotation.x = -0.5
    this.fuseVolt.set('0.0 V', '#ffd9a0')
    this.fuseLoad.group.position.set(-1.8, TOP + 0.5, -1.0)
    this.fuseLoad.setOhms(5)
    // the fuse wire: two posts and a thin wire between them
    const post = (x: number) => {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 1.1, 14), new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 1, roughness: 0.25 }))
      p.position.set(x, TOP + 0.55, -1.0)
      p.castShadow = true
      return p
    }
    this.fuseWire = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.0, 10), new THREE.MeshStandardMaterial({ color: 0x777777, emissive: 0x000000, metalness: 0.9, roughness: 0.4 }))
    this.fuseWire.rotation.z = Math.PI / 2
    this.fuseWire.position.set(2.6, TOP + 1.0, -1.0)
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.5, 10), new THREE.MeshStandardMaterial({ color: 0x777777, emissive: 0x000000, metalness: 0.9 }))
      h.visible = false
      h.userData.side = s
      this.fuseHalves.push(h)
      g.add(h)
    }
    // a thick copper lead in the same loop for comparison
    this.thickLead = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 3.0, 14), new THREE.MeshStandardMaterial({ color: 0xc97a3d, emissive: 0x000000, metalness: 0.9, roughness: 0.3 }))
    this.thickLead.rotation.z = Math.PI / 2
    this.thickLead.position.set(2.6, TOP + 1.0, 2.0)
    const fuseTag = this.label('thin fuse wire', '#ffd9a0', 0.55)
    fuseTag.position.set(2.6, TOP + 2.5, -1.0)
    const thickTag = this.label('thick copper lead', '#c8d3e6', 0.55)
    thickTag.position.set(2.6, TOP + 2.5, 2.0)
    this.fuseTag = new Readout(3.2, 0.9)
    this.fuseTag.position.set(2.6, TOP + 3.4, -1.0)
    this.fuseTag.rotation.x = -0.4
    this.fuseTag.set('cold', '#9fd0ff')
    this.fuseMeter = this.placeMeter(g, V(8.4, 0, 3.0))
    const mtag = this.label('ammeter', '#9fd0ff', 0.55)
    mtag.position.set(8.4, 4.4, 3.0)
    const tl = this.label('resistor (load)', '#ffd9a0', 0.55)
    tl.position.set(-1.8, TOP + 1.9, -1.0)
    this.fuseSparkGroup.position.set(2.6, TOP + 1.0, -1.0)
    const y = TOP + 0.6
    g.add(
      bat, this.fuseVolt, this.fuseLoad.group, post(1.0), post(4.2), this.fuseWire, this.thickLead, fuseTag, thickTag, this.fuseTag, mtag, tl, this.fuseSparkGroup,
      this.wire([V(-4.6, y, -1), V(-4.6, y + 1.3, -1), V(-3.4, y + 1.3, -1), V(-3.2, y, -1)], 0.09, 0xd7263d),
      this.wire([V(-0.4, y, -1), V(0.0, y + 1.3, -1), V(1.0, y + 1.3, -1)], 0.09, 0xd7263d),
      this.wire([V(4.2, y + 1.1, -1), V(5.6, y + 1.3, -0.6), V(6.2, y + 1.0, 3.0), V(7.0, y + 0.3, 3.2)], 0.09, 0xd7263d),
      this.wire([V(9.4, y + 0.2, 5.0), V(9.4, y + 1.2, 5.0), V(-7.8, y + 1.2, 3.8), V(-7.8, y + 1.0, -1), V(-7.8, y, -1)], 0.09, 0x222831),
      this.wire([V(1.0, y + 1.1, -1), V(1.0, y + 1.6, 2.0), V(1.2, y + 0.4, 2.0)], 0.2, 0xc97a3d),
      this.wire([V(4.0, y + 0.4, 2.0), V(4.2, y + 1.6, 2.0), V(4.2, y + 1.1, -1)], 0.2, 0xc97a3d),
    )
  }

  private setFuseGlow(heat: number) {
    const [r, gg, b] = glowColor(heat)
    const m = this.fuseWire.material as THREE.MeshStandardMaterial
    m.emissive.setRGB(r, gg, b)
    m.emissiveIntensity = heat < 0.2 ? 0 : 0.6 + 2.2 * heat
    for (const h of this.fuseHalves) {
      const hm = h.material as THREE.MeshStandardMaterial
      hm.emissive.setRGB(r, gg, b)
      hm.emissiveIntensity = Math.max(0, 1.4 * heat)
    }
  }

  private resetFuse() {
    this.fuseWire.visible = true
    this.fuseWire.scale.set(1, 1, 1)
    this.fuseWire.material = new THREE.MeshStandardMaterial({ color: 0x777777, emissive: 0x000000, metalness: 0.9, roughness: 0.4 })
    for (const h of this.fuseHalves) h.visible = false
    for (const s of this.sparks) this.fuseSparkGroup.remove(s.m)
    this.sparks = []
    this.setFuseGlow(0)
    this.fuseMeter.set('0.00 A')
    this.fuseVolt.set('0.0 V', '#ffd9a0')
    this.fuseTag.set('cold', '#9fd0ff')
    ;(this.thickLead.material as THREE.MeshStandardMaterial).emissive.setRGB(0, 0, 0)
  }

  private spark() {
    for (let i = 0; i < 26; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffd479 }))
      this.fuseSparkGroup.add(m)
      this.sparks.push({ m, v: V((Math.random() - 0.5) * 7, Math.random() * 5 + 1, (Math.random() - 0.5) * 5), life: 0.5 + Math.random() * 0.5 })
    }
  }

  private async runFuse(p: { irated: number; rload: number; rfuse: number; replaced: boolean }) {
    this.abort()
    this.resetFuse()
    const v = this.view('fuse')
    await this.flyTo(v.pos, v.target, 1000)
    if (this.disposed) return
    const vb = voltageToBlow(p.rload, p.rfuse, p.irated)
    const vEnd = p.replaced ? vb * 1.6 : vb * 1.25
    const dur = 9
    const st = { t: 0, blown: false, since: 0 }
    this.fuseLoad.setOhms(Math.round(p.rload))
    const thickMat = this.thickLead.material as THREE.MeshStandardMaterial
    return this.begin({
      update: (dt) => {
        st.t += dt
        const volts = vEnd * easeInOut(Math.min(1, Math.max(0, (st.t - 0.5) / dur)))
        const s = fuse(volts, p.rload, p.rfuse, p.irated)
        // a wire that has been replaced by a thick one makes almost no heat
        const heat = p.replaced ? Math.min(0.25, s.heat * 0.05) : s.heat
        if (!st.blown && !p.replaced && s.blown) {
          st.blown = true
          st.since = st.t
          this.fuseWire.visible = false
          for (const h of this.fuseHalves) {
            h.visible = true
            h.position.set(2.6 + h.userData.side * 1.0, TOP + 1.0, -1.0)
          }
          this.spark()
          sound.crack()
        }
        if (!st.blown) this.setFuseGlow(heat)
        else {
          const k = Math.min(1, (st.t - st.since) / 0.8)
          for (const h of this.fuseHalves) {
            h.rotation.z = Math.PI / 2 + h.userData.side * 0.9 * k
            h.position.set(2.6 + h.userData.side * (1.1 + 0.35 * k), TOP + 1.0 - 0.7 * k, -1.0)
          }
          this.setFuseGlow(Math.max(0, 0.9 - (st.t - st.since) * 0.7))
        }
        thickMat.emissive.setRGB(0.05 * Math.min(1, s.heat), 0.01, 0)
        for (const sp of [...this.sparks]) {
          sp.life -= dt
          sp.v.y -= 9 * dt
          sp.m.position.addScaledVector(sp.v, dt)
          if (sp.life <= 0) {
            this.fuseSparkGroup.remove(sp.m)
            this.sparks = this.sparks.filter((x) => x !== sp)
          }
        }
        const I = st.blown ? 0 : s.amps
        this.fuseVolt.set(`${f1(volts)} V`, '#ffd9a0')
        this.fuseMeter.set(`${f2(I)} A`)
        this.fuseTag.set(st.blown ? 'melted' : p.replaced ? (heat > 0.15 ? 'warm' : 'cool') : heat > 0.85 ? 'white hot' : heat > 0.55 ? 'glowing' : heat > 0.3 ? 'red' : 'cold', st.blown ? '#ff8a8a' : heat > 0.3 ? '#ffb347' : '#9fd0ff')
        this.emitGauges(dt, () => [
          { label: 'Voltage', value: `${f1(volts)} V`, tone: 'info' },
          { label: 'Current', value: `${f2(I)} A`, tone: 'warn' },
          { label: 'Fuse wire', value: st.blown ? 'melted: circuit broken' : p.replaced ? 'thick wire' : heat > 0.55 ? 'glowing' : heat > 0.3 ? 'red' : 'cold', tone: st.blown ? 'warn' : undefined },
        ])
        return st.t > (st.blown ? st.since + 2.6 : dur + 1.5) ? 1000 : null
      },
      done: () => undefined,
    })
  }

  /* ---------------- loading ---------------- */
  async load(): Promise<void> {
    const loader = new GLTFLoader()
    const a = this.lesson.assets
    const urls = [a.breadboard, a.multimeter].filter(Boolean)
    let done = 0
    const get = async (url: string | undefined) => {
      if (!url) return null
      const r = await loader.loadAsync(url).then((x) => x.scene).catch((err) => {
        console.warn('[circuits] model failed to load, using a stand-in', url, err)
        return null
      })
      this.events.onProgress?.(++done, urls.length)
      return r
    }
    const [board, meter] = await Promise.all([get(a.breadboard), get(a.multimeter)])
    if (this.disposed) return
    this.boardModel = board
    this.meterModel = meter
    // the boards and meters were built before the models arrived: rebuild the three benches with the real ones
    for (const g of Object.values(this.groups)) g.clear()
    for (const g of Object.values(this.groups)) stageSet(g, { cx: 0, cz: 0, w: 28, d: 15, wall: { z: -7.6, h: 10 }, key: [4, 16, 12], aim: [0, 1, 0], keyI: 520, rimI: 110, rimAt: [10, 8, 6], dust: { n: 90, h: 9 } })
    this.ohmWires = new THREE.Group()
    this.bulbWires = new THREE.Group()
    this.ohmRes = new Resistor()
    this.bulbA = new Bulb()
    this.bulbB = new Bulb()
    this.bulbRef = new Bulb()
    this.fuseLoad = new Resistor(2.6)
    this.fuseHalves = []
    this.ohmFlow = []
    this.ohmMeterShown = []
    this.buildOhm()
    this.buildBulbs()
    this.buildFuse()
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
    const X2 = MODULE_X.series_parallel
    const X3 = MODULE_X.heating_fuse
    switch (name) {
      case 'bulbs':
        return { pos: V(X2 + 1, 15, 21), target: V(X2 + 0.5, 1.2, 0.5) }
      case 'fuse':
        return { pos: V(X3 - 0.5, 15, 21), target: V(X3 - 0.5, 1.2, 0.8) }
      default:
        return { pos: V(0.5, 15, 21), target: V(0.6, 1.6, 0.2) }
    }
  }

  async goto(moduleId: string, instant = false): Promise<void> {
    this.abort()
    this.moduleId = moduleId
    for (const [id, g] of Object.entries(this.groups)) g.visible = id === moduleId
    this.events.onGauges?.(null)
    this.events.onNote?.(null)
    const v = this.view(moduleId === 'series_parallel' ? 'bulbs' : moduleId === 'heating_fuse' ? 'fuse' : 'ohm')
    if (moduleId === 'heating_fuse') this.resetFuse()
    if (moduleId === 'series_parallel') await this.stageBulbs(this.bulbMode, 0)
    if (instant) {
      this.camera.position.copy(v.pos)
      this.controls.target.copy(v.target)
    } else await this.flyTo(v.pos, v.target)
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
  }

  /** Sets the bench for a question before it is answered, without running it. */
  stage(action: string, params: Record<string, unknown> = {}) {
    if (this.busy) return
    switch (action) {
      case 'ohm':
      case 'ohm_graph':
      case 'ohm_r': {
        const R = num(params.R ?? params.r1, 10)
        this.ohmRes.setOhms(R)
        this.ohmVolt.set('0.0 V', '#ffd9a0')
        this.ohmMeter.set('0.00 A')
        this.ohmFlow.forEach((d) => (d.visible = false))
        this.drawGraph([], action === 'ohm_r' ? 'ir' : 'vi', 0)
        void this.flyTo(this.view('ohm').pos, this.view('ohm').target, 900)
        break
      }
      case 'bulbs':
      case 'bulbs_remove':
      case 'bulbs_meter': {
        this.bulbVolt.set(`${f1(num(params.V, 6))} V`, '#ffd9a0')
        void this.stageBulbs(String(params.mode ?? 'series') === 'parallel' ? 'parallel' : 'series', num(params.remove, 0))
        void this.flyTo(this.view('bulbs').pos, this.view('bulbs').target, 900)
        break
      }
      case 'fuse_ramp': {
        this.resetFuse()
        this.fuseLoad.setOhms(Math.round(num(params.rload, 5)))
        void this.flyTo(this.view('fuse').pos, this.view('fuse').target, 900)
        break
      }
      default:
    }
  }

  async run(action: string, params: Record<string, unknown> = {}): Promise<void> {
    this.events.onNote?.(null)
    switch (action) {
      case 'ohm':
        return this.runOhm({ R: num(params.R, 10), v1: num(params.v1, 2), v2: num(params.v2, 4) })
      case 'ohm_graph':
        return this.runOhm({ R: num(params.R, 10), v1: num(params.point, 0.5) * num(params.R, 10), v2: num(params.point, 0.5) * num(params.R, 10) * 2 })
      case 'ohm_r':
        return this.runOhmR({ v: num(params.v, 4), r1: num(params.r1, 4), r2: num(params.r2, 8) })
      case 'bulbs':
      case 'bulbs_remove':
      case 'bulbs_meter':
        return this.runBulbs(action, { mode: String(params.mode ?? 'series') === 'parallel' ? 'parallel' : 'series', V: num(params.V, 6), R: num(params.R, 6), remove: num(params.remove, 0) })
      case 'fuse_ramp':
        return this.runFuse({ irated: num(params.irated, 2), rload: num(params.rload, 4.5), rfuse: num(params.rfuse, 0.5), replaced: params.replaced === true })
      default:
    }
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
  private frame() {
    if (this.disposed || !this.running) return
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
