import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { MotionLessonContract } from '@mmaxr/schema'
import { sound } from './sound'
import { stageSet } from './stage'
import { Readout } from './circuitsScene'
import { BoldArrow, type Gauge, type MotionSceneEvents, type SandboxScene } from './motionScene'
import { leverEffort, rampEffort, turnsToLift, wheelEffort } from './machinePhysics'

/*
 * Four benches in one scene: levers, pulleys, a wheel and axle, and an inclined plane. Every machine is ideal and the
 * force meter is read from the same formulas the lesson uses. The scene only simulates and draws: it never names an
 * answer. What a result means comes from the server, after the student has watched it.
 */
const MODULE_X: Record<string, number> = { levers: 0, pulleys: 300, wheel_axle: 600, inclined_plane: 900 }
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
type Ease = (t: number) => number
const easeInOut: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const clamp01 = (t: number) => Math.max(0, Math.min(1, t))
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const f1 = (n: number) => (Math.abs(n) < 0.05 ? '0.0' : n.toFixed(1))
const f2 = (n: number) => (Math.abs(n) < 0.005 ? '0.00' : n.toFixed(2))
const STEEL = 0x9aa3b2
const BAR_Y = 1.9

interface Job {
  update(dt: number): number | null
  done(): void
}

export class MachinesScene implements SandboxScene {
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
  private moduleId = 'levers'
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
  private crowbar: THREE.Object3D | null = null
  private pulleyModel: THREE.Object3D | null = null
  private wheelModel: THREE.Object3D | null = null
  private cycleModel: THREE.Object3D | null = null
  private rampModel: THREE.Object3D | null = null
  private crateModel: THREE.Object3D | null = null
  private barrowModel: THREE.Object3D | null = null
  private tweezersModel: THREE.Object3D | null = null
  private rampTurn = 0
  private readonly onResize = () => this.resize()
  /** Whatever the current question put on the bench: cleared and rebuilt for each question. */
  private stuff: Record<string, THREE.Group> = {}

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
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500)
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.maxPolarAngle = Math.PI * 0.49
    this.controls.minDistance = 4
    this.controls.maxDistance = 60
    this.controls.addEventListener('start', () => (this.flightId += 1))
    const scene = this.scene
    scene.background = new THREE.Color(0x0b0d12)
    scene.fog = new THREE.Fog(0x0b0d12, 70, 220)
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
      const w = id === 'inclined_plane' ? 46 : 30
      stageSet(g, { cx: id === 'inclined_plane' ? -4 : 0, cz: 0, w, d: 16, wall: { z: -8.5, h: 18 }, key: [4, 24, 14], aim: [0, 2, 0], keyI: 900, rimI: 200, rimAt: [12, 10, 7], dust: { n: 90, h: 14 } })
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

  /* ---------------- small builders ---------------- */
  private label(text: string, color = '#e6edf7', scale = 1): THREE.Sprite {
    // the canvas grows with the text, so long labels are never cut off
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
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }))
    s.scale.set(2.8 * scale * (w / 512), 0.7 * scale, 1)
    return s
  }

  private mat(color: number, metalness = 0.3, roughness = 0.5) {
    return new THREE.MeshStandardMaterial({ color, metalness, roughness })
  }

  /** A model scaled to a target size, standing on y = 0 and centred on x, z. */
  private fit(model: THREE.Object3D | null, o: { width?: number; height?: number; depth?: number; fallback: () => THREE.Object3D }): THREE.Group {
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

  private crate(size = 1.8): THREE.Group {
    return this.fit(this.crateModel, { height: size, fallback: () => new THREE.Mesh(new THREE.BoxGeometry(size, size, size), this.mat(0xb07a3d, 0.1, 0.8)) })
  }

  /** A thin rope through the points. */
  private rope(points: THREE.Vector3[], r = 0.07, color = 0xd9c4a0): THREE.Mesh {
    const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.02)
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, points.length * 8), r, 6, false), this.mat(color, 0, 0.9))
    m.castShadow = true
    return m
  }
  private setRope(m: THREE.Mesh, points: THREE.Vector3[]) {
    const r = (m.geometry as THREE.TubeGeometry).parameters.radius
    m.geometry.dispose()
    m.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.02), Math.max(8, points.length * 8), r, 6, false)
  }

  private arrow(color: number): BoldArrow {
    const a = new BoldArrow(color, 0.12)
    a.visible = false
    return a
  }
  /** Points an arrow from `from` along `dir`, with a length proportional to a force. */
  private pushArrow(a: BoldArrow, from: THREE.Vector3, dir: THREE.Vector3, force: number, ref: number) {
    const len = 0.9 + 2.6 * Math.min(1.4, force / Math.max(ref, 1e-6))
    a.position.copy(from)
    a.setDirection(dir)
    a.setLength(len, 0.7, 0.6)
    a.visible = true
  }

  /** A heap of dirt and rocks for the wheelbarrow's bucket, about 2.6 across and 1.4 high, standing on y = 0. */
  private rockPile(): THREE.Group {
    const g = new THREE.Group()
    const dirt = new THREE.Mesh(new THREE.SphereGeometry(1.5, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), this.mat(0x4a3626, 0, 1))
    dirt.scale.set(1.15, 0.55, 0.9)
    dirt.receiveShadow = true
    g.add(dirt)
    const tones = [0x7d7568, 0x8a8174, 0x5f594f, 0x9a9184]
    const rocks: [number, number, number, number][] = [
      [-0.7, 0.35, 0.2, 0.42], [0.1, 0.5, -0.35, 0.5], [0.75, 0.3, 0.3, 0.38], [-0.1, 0.82, 0.25, 0.36],
      [-0.95, 0.2, -0.5, 0.3], [0.5, 0.25, -0.75, 0.33], [0.15, 0.3, 0.8, 0.32],
    ]
    rocks.forEach(([x, y, z, r], i) => {
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), this.mat(tones[i % tones.length], 0.05, 0.95))
      m.position.set(x, y, z)
      m.rotation.set(i * 1.3, i * 0.7, i * 2.1)
      m.scale.set(1 + (i % 3) * 0.12, 0.85, 1 - (i % 2) * 0.15)
      m.castShadow = true
      g.add(m)
    })
    return g
  }

  /** Like pushArrow, but the arrow's tip lands on `tip`, so it visibly pushes or pulls at that very point. */
  private arrowTo(a: BoldArrow, tip: THREE.Vector3, dir: THREE.Vector3, force: number, ref: number) {
    const len = 0.9 + 2.6 * Math.min(1.4, force / Math.max(ref, 1e-6))
    this.pushArrow(a, tip.clone().addScaledVector(dir, -len), dir, force, ref)
  }

  /** The supplied wheelbarrow, its wheel axle at the origin and its handles towards +x; `armX` is the axle-to-grip distance. */
  private barrowRig(armX: number): { rig: THREE.Group; k: number } {
    // model metres: the axle sits at (z 0.52, y 0.24); the grips at z -0.75, y 0.82, so 1.27 m from the axle
    const k = armX / 1.27
    const rig = new THREE.Group()
    const yaw = new THREE.Group()
    yaw.rotation.y = -Math.PI / 2
    if (this.barrowModel) {
      const m = this.barrowModel.clone(true)
      m.scale.multiplyScalar(k)
      m.traverse((x) => {
        if (x instanceof THREE.Mesh) {
          x.castShadow = true
          x.receiveShadow = true
        }
      })
      yaw.add(m)
    } else {
      const tray = new THREE.Mesh(new THREE.BoxGeometry(3, 1.2, 4), this.mat(0x2b2f38, 0.4, 0.5))
      tray.position.set(0, 1.6, -3)
      yaw.add(tray)
    }
    rig.add(yaw)
    rig.position.set(0.52 * k, -0.24 * k, 0)
    const outer = new THREE.Group()
    outer.add(rig)
    return { rig: outer, k }
  }

  /** The supplied tweezers, hinged end at the origin and tips towards +x, the two arms one above the other. */
  private tweezersRig(length: number): THREE.Group {
    const out = new THREE.Group()
    const yaw = new THREE.Group()
    yaw.rotation.y = Math.PI / 2
    if (this.tweezersModel) {
      const m = this.tweezersModel.clone(true)
      const steel = this.mat(0xc9d1dd, 0.95, 0.28)
      m.traverse((x) => {
        if (x instanceof THREE.Mesh) {
          x.material = steel
          x.castShadow = true
        }
      })
      // model metres: 0.092 long; the riveted hinge end is at z = -0.077, the open tips at z = +0.014, the arms spread in y
      const k = length / 0.091
      m.scale.multiplyScalar(k)
      yaw.add(m)
      // turned by +90° about y, z becomes x: slide so the hinge end is exactly at x = 0 and the arms straddle y = 0
      yaw.position.set(0.077 * k, -0.0035 * k, 0)
    } else {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(length, 0.2, 0.3), this.mat(STEEL, 0.9, 0.35))
      arm.position.x = length / 2
      out.add(arm)
    }
    out.add(yaw)
    return out
  }

  private clear(id: string) {
    const g = this.stuff[id]
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry?.dispose()
    })
    g.clear()
    return g
  }

  /* ---------------- tab 1: levers ---------------- */
  /** A lever bar: a plain steel plank, or the crowbar model itself (used only in the types-of-lever demonstration). */
  private bar(length: number, crowbar = false): THREE.Group {
    const g = new THREE.Group()
    if (crowbar && this.crowbar) {
      // The model lies flat on its side with the claw curling sideways (towards -z). Stand it up so the claw curls
      // up at the load end, hooking under the crate's edge, with the straight shaft along the pivot line.
      const turned = new THREE.Group()
      const c = this.crowbar.clone(true)
      c.rotation.x = Math.PI / 2
      turned.add(c)
      const w = this.fit(turned, { width: length, fallback: () => new THREE.Object3D() })
      w.position.y = -0.18
      g.add(w)
      return g
    }
    const plank = new THREE.Mesh(new THREE.BoxGeometry(length, 0.34, 1.1), this.mat(STEEL, 0.9, 0.35))
    plank.castShadow = true
    g.add(plank)
    return g
  }

  private fulcrum(): THREE.Mesh {
    const shape = new THREE.Shape()
    shape.moveTo(-0.9, 0)
    shape.lineTo(0.9, 0)
    shape.lineTo(0, BAR_Y - 0.25)
    shape.closePath()
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 1.6, bevelEnabled: false }), this.mat(0x3a4254, 0.5, 0.5))
    m.position.z = -0.8
    m.castShadow = true
    return m
  }

  /** Turns a group about the point (px, py), as if it had pivoted there. */
  private pivot(g: THREE.Group, c0: THREE.Vector3, p: THREE.Vector2, angle: number) {
    g.rotation.z = angle
    const dx = c0.x - p.x
    const dy = c0.y - p.y
    g.position.set(p.x + dx * Math.cos(angle) - dy * Math.sin(angle), p.y + dx * Math.sin(angle) + dy * Math.cos(angle), c0.z)
  }

  private leverRig(group: THREE.Group, o: { length: number; z: number; load: number; fulcrumAt: number; effortAt: number; name?: string; crowbar?: boolean }) {
    const bar = this.bar(o.length, o.crowbar === true)
    const c0 = V(0, BAR_Y, o.z)
    bar.position.copy(c0)
    const fulc = this.fulcrum()
    const load = this.crate(1.7)
    load.position.set(o.load, 0.14, 0)
    bar.add(load)
    const loadAt = this.label('load', '#ffb4a8', 0.4)
    loadAt.position.set(o.load, 2.8, 0)
    bar.add(loadAt)
    const effort = new THREE.Group()
    const meter = new Readout(2.6, 0.8)
    meter.set('0.0 N', '#bff5c9')
    meter.position.set(o.effortAt, 8.8, 0)
    const earrow = this.arrow(0x4ade80)
    const larrow = this.arrow(0xff5470)
    group.add(bar, fulc, effort, meter, earrow, larrow)
    if (o.name) {
      const t = this.label(o.name, '#ffd9a0', 0.7)
      t.position.set(0, 7.4, o.z)
      group.add(t)
    }
    const rig = { bar, fulc, meter, earrow, larrow, c0, length: o.length, z: o.z, load: o.load, effortAt: o.effortAt }
    this.setFulcrum(rig, o.fulcrumAt)
    return rig
  }
  private setFulcrum(rig: { fulc: THREE.Mesh; z: number }, x: number) {
    rig.fulc.position.set(x, 0, rig.z - 0.8)
  }

  /** The bar tilting about the fulcrum, load end up when `lift` is 1. */
  private tilt(rig: { bar: THREE.Group; c0: THREE.Vector3; load: number }, fulcrumX: number, lift: number) {
    const loadLeft = rig.load < fulcrumX
    this.pivot(rig.bar, rig.c0, new THREE.Vector2(fulcrumX, BAR_Y), (loadLeft ? -1 : 1) * 0.11 * lift)
  }

  private async runLever(p: { W: number; L: number; d1: number; d2: number }) {
    this.abort()
    const g = this.clear('levers')
    const SC = 11 / p.L
    const len = p.L * SC
    const xl = -len / 2 // load at the left end
    const xe = len / 2 // effort at the right end
    const rig = this.leverRig(g, { length: len, z: 0, load: xl + 0.9, fulcrumAt: xl + p.d1 * SC, effortAt: xe - 0.5 })
    this.pushArrow(rig.larrow, V(xl + 0.9, 7.5, 0), V(0, -1, 0), p.W, p.W)
    const v = this.view('levers')
    await this.flyTo(v.pos, v.target, 1000)
    if (this.disposed) return
    const st = { t: 0 }
    return this.begin({
      update: (dt) => {
        st.t += dt
        // rest, slide the fulcrum d1 -> d2, rest. The bar lifts the load a little each time the effort is applied.
        const k = easeInOut(seg(st.t, 1.6, 4.2))
        const d = p.d1 + (p.d2 - p.d1) * k
        const fx = xl + d * SC
        this.setFulcrum(rig, fx)
        const E = leverEffort(p.W, d, p.L - d)
        const lift = Math.sin(clamp01(((st.t % 1.8) / 1.8)) * Math.PI) * (st.t > 0.5 ? 1 : 0)
        this.tilt(rig, fx, st.t < 1.6 || st.t > 4.2 ? lift : 0.35)
        rig.meter.set(`${f1(E)} N`, '#bff5c9')
        this.pushArrow(rig.earrow, V(xe - 0.5, 7.2, 0), V(0, -1, 0), E, p.W)
        this.emitGauges(dt, () => [
          { label: 'Load', value: `${f1(p.W)} N`, tone: 'info' },
          { label: 'Fulcrum from load', value: `${f2(d)} m` },
          { label: 'Effort arm', value: `${f2(p.L - d)} m` },
          { label: 'Effort needed', value: `${f1(E)} N`, tone: 'warn' },
        ])
        return st.t > 6.6 ? 900 : null
      },
      done: () => undefined,
    })
  }

  /**
   * One real lever, alone on the bench, built from its class and its two arms. The pivot group sits at the fulcrum,
   * so tilting it turns the bar about the fulcrum. Class 1 has the fulcrum between load and effort (the effort pushes
   * down); classes 2 and 3 have the fulcrum at one end and the effort lifts up.
   */
  private singleLever(g: THREE.Group, d: { cls: number; la: number; ea: number; name: string; W: number; title: string }) {
    const barrow = d.name.includes('wheelbarrow')
    const tweezers = d.name.includes('tweezers')
    const longest = d.cls === 1 ? d.la + d.ea : Math.max(d.la, d.ea)
    const k = 10 / longest
    const loadX = (d.cls === 1 ? -d.la : d.la) * k
    const effX = d.ea * k
    const minX = Math.min(0, loadX, effX) - 0.9
    const maxX = Math.max(0, loadX, effX) + 0.9
    const shift = -(minX + maxX) / 2
    const pivot = new THREE.Group()
    pivot.position.set(shift, BAR_Y, 0)
    const crowbar = d.name.includes('crowbar')
    // the barrow and the tweezers are the supplied models themselves, not a plank with a crate on it
    let barrowK = 0
    let objectY = 0.17
    let gripY = 0
    if (barrow) {
      const r = this.barrowRig(effX)
      barrowK = r.k
      pivot.add(r.rig)
      gripY = 0.58 * barrowK
      objectY = 0.75
    } else if (tweezers) {
      pivot.add(this.tweezersRig(loadX))
      objectY = -0.4
    } else {
      const bar = this.bar(maxX - minX, crowbar)
      bar.position.x = (minX + maxX) / 2
      pivot.add(bar)
    }
    // the load: dirt and rocks in the barrow's bucket, nothing at the tweezers' tips (only the forces), a crate otherwise
    let fingers: THREE.Mesh[] = []
    if (barrow) {
      const pile = this.rockPile()
      pile.position.set(loadX, objectY, 0)
      pile.scale.set(0.85, 1.6, 1.1)
      pivot.add(pile)
    } else if (tweezers) {
      // two fingertips pressing the arms together at the middle
      const skin = this.mat(0xe0ac8a, 0, 0.7)
      fingers = [1, -1].map(() => {
        const f = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 14), skin)
        f.scale.set(1.5, 0.7, 1.1)
        f.castShadow = true
        pivot.add(f)
        return f
      })
    } else {
      const crate = this.crate(1.6)
      crate.position.set(loadX + (crowbar ? 0.5 : 0), objectY, 0)
      pivot.add(crate)
    }
    g.add(pivot)
    // the fulcrum: the wheelbarrow's own wheel, a stone under the crowbar, or a steel wedge
    if (barrow) {
      // the wheels belong to the model, which touches the ground; nothing else to add
    } else if (crowbar) {
      const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(1.0, 0), this.mat(0x6d6254, 0.1, 1))
      stone.scale.set(1.2, 0.95, 1)
      stone.position.set(shift, 0.85, 0)
      stone.castShadow = true
      g.add(stone)
    } else if (d.cls === 1) {
      const f = this.fulcrum()
      f.position.set(shift, 0, -0.8)
      g.add(f)
    } else {
      // a class 3 lever is lifted at its middle, so its end must be held by a hinge, not just rest on a wedge
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, BAR_Y + 0.6, 0.5), this.mat(0x3a4254, 0.5, 0.5))
      post.position.set(shift, (BAR_Y + 0.6) / 2, -0.85)
      post.castShadow = true
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 2.0, 16).rotateX(Math.PI / 2), this.mat(STEEL, 0.9, 0.3))
      pin.position.set(shift, BAR_Y, 0)
      g.add(post, pin)
    }
    const meter = new Readout(2.8, 0.8)
    meter.set('0.0 N', '#bff5c9')
    const tag = this.label(d.title, '#ffd9a0', 1.1)
    tag.position.set(0, barrow ? 10.2 : 7.8, 0)
    const earrow = this.arrow(0x4ade80)
    const larrow = this.arrow(0xff5470)
    // tweezers squeeze: a second pair of arrows, one on each arm; the barrow's wheel pushes back up on the ground
    const earrow2 = this.arrow(0x4ade80)
    const larrow2 = this.arrow(0xff5470)
    const rarrow = this.arrow(0x60a5fa)
    g.add(meter, tag, earrow, larrow, earrow2, larrow2, rarrow)
    const E = leverEffort(d.W, d.la, d.ea)
    const up = d.cls !== 1
    const sign = loadX > 0 ? 1 : -1
    const at = (x: number, th: number, y = 0) => V(shift + x * Math.cos(th) - y * Math.sin(th), BAR_Y + x * Math.sin(th) + y * Math.cos(th), 0)
    const update = (lift: number) => {
      if (tweezers) {
        // squeeze: both arms are pushed together at the middle, and the object pushes the two tips apart
        const s = 1 - 0.35 * lift
        const gapE = 0.3 * s
        const gapL = 0.45 * s
        const ex = shift + effX
        const lx = shift + loadX
        // each fingertip rests on its arm; the arrow's tip lands on the fingertip's outer face
        const fy = gapE + 0.34 * 0.7
        fingers[0].position.set(effX, fy, 0)
        fingers[1].position.set(effX, -fy, 0)
        this.arrowTo(earrow, V(ex, BAR_Y + fy + 0.25, 0), V(0, -1, 0), E, d.W)
        this.arrowTo(earrow2, V(ex, BAR_Y - fy - 0.25, 0), V(0, 1, 0), E, d.W)
        this.pushArrow(larrow, V(lx, BAR_Y + gapL, 0), V(0, 1, 0), d.W, d.W)
        this.pushArrow(larrow2, V(lx, BAR_Y - gapL, 0), V(0, -1, 0), d.W, d.W)
        meter.position.set(ex - 2.8, BAR_Y + 3.4, 0.6)
        meter.set(`${f1(E)} N`, '#bff5c9')
        return
      }
      const th = sign * 0.12 * lift
      pivot.rotation.z = th
      const e = at(effX, th)
      const l = at(loadX, th)
      if (barrow) {
        const grip = at(effX, th, gripY)
        this.arrowTo(earrow, grip, V(0, 1, 0), E, d.W)
        this.arrowTo(larrow, at(loadX, th, objectY + 1.5), V(0, -1, 0), d.W, d.W)
        // the ground pushes up on the wheel with what the hands do not carry
        this.arrowTo(rarrow, V(shift, 0.9 + 2.6 * Math.min(1.4, Math.max(0, d.W - E) / d.W), 3.4), V(0, 1, 0), Math.max(0, d.W - E), d.W)
        meter.position.set(grip.x, grip.y + 2.6, 0.6)
      } else {
        this.pushArrow(earrow, up ? e.clone().add(V(0, -3.6, 0)) : e.clone().add(V(0, 4.6, 0)), V(0, up ? 1 : -1, 0), E, d.W)
        this.pushArrow(larrow, l.clone().add(V(0, 5.4, 0)), V(0, -1, 0), d.W, d.W)
        meter.position.set(e.x, up ? e.y + 2.0 : e.y + 5.6, 0.6)
      }
      meter.set(`${f1(E)} N`, '#bff5c9')
    }
    update(0)
    return { update, E }
  }

  /** One lever on its own, its class named once the student has run it. The crowbar shows class 1. */
  private async runLeverTypes(p: { W: number; focus: number; name: string; la: number; ea: number }) {
    this.abort()
    const g = this.clear('levers')
    const lev = this.singleLever(g, { cls: p.focus, la: p.la, ea: p.ea, name: p.name, W: p.W, title: `Class ${p.focus} lever: ${p.name}` })
    const v = this.view('levers')
    await this.flyTo(v.pos, v.target, 1000)
    if (this.disposed) return
    const st = { t: 0 }
    return this.begin({
      update: (dt) => {
        st.t += dt
        lev.update(Math.sin(clamp01(((st.t - 0.6) % 2.4) / 2.4) * Math.PI) * (st.t > 0.6 ? 1 : 0))
        this.emitGauges(dt, () => [
          { label: 'Class', value: `Class ${p.focus}`, tone: 'info' },
          { label: 'Load', value: `${f1(p.W)} N` },
          { label: 'Load arm', value: `${f2(p.la)} m` },
          { label: 'Effort arm', value: `${f2(p.ea)} m` },
          { label: 'Effort needed', value: `${f1(lev.E)} N`, tone: 'warn' },
        ])
        return st.t > 7.8 ? 900 : null
      },
      done: () => undefined,
    })
  }

  /** Two real levers lifting the same load, set up one after the other in the same place. */
  private async runLeverPair(p: { W: number; a: [string, number, number, number]; b: [string, number, number, number] }) {
    this.abort()
    const g = this.clear('levers')
    const build = (d: [string, number, number, number]) => this.singleLever(this.clear('levers'), { cls: d[1], la: d[2], ea: d[3], name: d[0], W: p.W, title: `${d[0]} (class ${d[1]})` })
    let lev = build(p.a)
    void g
    const v = this.view('levers')
    await this.flyTo(v.pos, v.target, 1000)
    if (this.disposed) return
    const st = { t: 0, second: false }
    const Ea = leverEffort(p.W, p.a[2], p.a[3])
    const Eb = leverEffort(p.W, p.b[2], p.b[3])
    return this.begin({
      update: (dt) => {
        st.t += dt
        if (!st.second && st.t > 4.4) {
          st.second = true
          lev = build(p.b)
          sound.click()
        }
        const t0 = st.second ? 4.8 : 0.6
        lev.update(Math.sin(clamp01(((st.t - t0) % 2.4) / 2.4) * Math.PI) * (st.t > t0 ? 1 : 0))
        this.emitGauges(dt, () => [
          { label: 'Same load', value: `${f1(p.W)} N`, tone: 'info' },
          { label: `${p.a[0]}: effort`, value: `${f1(Ea)} N`, tone: st.second ? undefined : 'warn' },
          { label: `${p.b[0]}: effort`, value: st.second ? `${f1(Eb)} N` : '–', tone: st.second ? 'warn' : undefined },
        ])
        return st.t > 9.2 ? 900 : null
      },
      done: () => undefined,
    })
  }

  /* ---------------- tab 2: the fixed pulley ---------------- */
  /**
   * One pulley hung from the top of a frame. The rope passes over it: the load hangs on the left end and the student
   * pulls the right end down through a force meter. `update(pulled)` takes the rope pulled in metres.
   */
  private pulleyBench(p: { W: number; h: number }) {
    const g = this.clear('pulleys')
    const TOP = 13.5
    const R = 1.5
    const S = 3 // scene units per metre the load rises
    const steel = this.mat(0x4a5266, 0.6, 0.5)
    for (const x of [-5, 5]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, TOP + 2.4, 0.6), steel)
      post.position.set(x, (TOP + 2.4) / 2, -1.2)
      post.castShadow = true
      g.add(post)
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(10.6, 0.7, 0.9), steel)
    beam.position.set(0, TOP + 2.4, -1.2)
    beam.castShadow = true
    const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.4, 0.3), this.mat(STEEL, 0.9, 0.3))
    hanger.position.set(0, TOP + 1.2, -0.5)
    g.add(beam, hanger)
    // the pulley wheel faces the viewer; it spins about its axle as the rope runs over it
    const spin = new THREE.Group()
    spin.position.set(0, TOP, 0)
    const wheel = this.fit(this.pulleyModel, { height: 2 * R + 0.3, fallback: () => new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.5, 28).rotateX(Math.PI / 2), this.mat(STEEL, 0.8, 0.3)) })
    wheel.position.y = -(R + 0.15)
    spin.add(wheel)
    g.add(spin)
    const tag = this.label('fixed pulley', '#ffd9a0', 0.6)
    tag.position.set(0, TOP + 3.4, 0)
    g.add(tag)
    const load = new THREE.Group()
    const crate = this.crate(1.8)
    crate.position.y = -2.1
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.07, 8, 16), this.mat(STEEL, 0.9, 0.3))
    hook.position.y = -0.1
    load.add(crate, hook)
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 12), this.mat(0xe3b78f, 0, 0.7))
    const handle = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.25, 0.25), this.mat(0x22252d, 0.2, 0.6))
    const rope = this.rope([V(-R, 4, 0), V(-R, TOP, 0)], 0.08)
    const meter = new Readout(2.8, 0.8)
    meter.set('0.0 N', '#bff5c9')
    const earrow = this.arrow(0x4ade80)
    const larrow = this.arrow(0xff5470)
    g.add(load, hand, handle, rope, meter, earrow, larrow)
    // a ruler beside the load, one mark every half metre
    const ruler = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3 * S + 0.4, 0.1), this.mat(0xf2f4f6, 0, 0.6))
    ruler.position.set(-4.0, 2.6 + (3 * S) / 2, -0.2)
    g.add(ruler)
    for (let i = 0; i <= 6; i++) {
      const tick = new THREE.Mesh(new THREE.BoxGeometry(i % 2 ? 0.35 : 0.6, 0.06, 0.12), this.mat(0x1a2330, 0, 0.6))
      tick.position.set(-4.0 + 0.2, 2.6 + (i * S) / 2 + 0.2, -0.1)
      g.add(tick)
    }
    const yl0 = 4.6 // the hook, before lifting
    const yh0 = 9 // the hand, before pulling
    const arc = (n: number) => Array.from({ length: n + 1 }, (_, i) => V(R * Math.cos(Math.PI - (Math.PI * i) / n), TOP + R * Math.sin(Math.PI - (Math.PI * i) / n), 0))
    const update = (pulledM: number, byHand = false) => {
      const d = pulledM * S
      const yl = yl0 + d
      load.position.set(-R, yl, 0)
      spin.rotation.z = byHand ? 0 : -d / R
      rope.visible = !byHand
      const yh = byHand ? yh0 : yh0 - d
      if (!byHand) this.setRope(rope, [V(-R, yl - 0.1, 0), V(-R, TOP - 0.2, 0), ...arc(10).slice(1, -1), V(R, TOP - 0.2, 0), V(R, yh, 0)])
      hand.position.set(byHand ? -R + 1.2 : R, byHand ? yl + 0.6 : yh - 0.4, 0.3)
      handle.position.set(byHand ? -R + 0.6 : R, byHand ? yl + 0.4 : yh - 0.1, 0.3)
      const E = p.W
      if (byHand) this.pushArrow(earrow, V(-R + 1.9, yl - 2.4, 0.4), V(0, 1, 0), E, p.W)
      else this.pushArrow(earrow, V(R + 0.9, yh + 0.4, 0.4), V(0, -1, 0), E, p.W)
      this.pushArrow(larrow, V(-R - 1.6, yl + 1.6, 0.4), V(0, -1, 0), p.W, p.W)
      meter.position.set(byHand ? -R + 3.8 : R + 2.6, byHand ? yl - 0.6 : yh - 1.2, 0.6)
      meter.set(`${f1(E)} N`, '#bff5c9')
    }
    update(0)
    return { update }
  }

  private async runPulley(p: { W: number; h: number; compare: boolean }) {
    this.abort()
    const bench = this.pulleyBench(p)
    const v = this.view('pulleys')
    await this.flyTo(v.pos, v.target, 1000)
    if (this.disposed) return
    const st = { t: 0 }
    // compare: first lift the load straight up by hand, lower it, then lift it again with the pulley
    const t0 = p.compare ? 4.6 : 0.6
    return this.begin({
      update: (dt) => {
        st.t += dt
        let phase = 'pulley'
        let lifted = 0
        if (p.compare && st.t < t0) {
          phase = 'hand'
          lifted = p.h * (st.t < 2.8 ? easeInOut(seg(st.t, 0.6, 2.6)) : 1 - easeInOut(seg(st.t, 3.0, 4.2)))
          bench.update(lifted, true)
        } else {
          lifted = p.h * easeInOut(seg(st.t, t0, t0 + 3.6))
          bench.update(lifted)
        }
        this.emitGauges(dt, () => [
          { label: 'Load', value: `${f1(p.W)} N`, tone: 'info' },
          { label: phase === 'hand' ? 'Lifting by hand' : 'Pulling the rope', value: `${f1(p.W)} N`, tone: 'warn' },
          { label: 'Rope pulled', value: phase === 'hand' ? '–' : `${f2(lifted)} m` },
          { label: 'Load lifted', value: `${f2(lifted)} m` },
        ])
        return st.t > t0 + 4.6 ? 900 : null
      },
      done: () => undefined,
    })
  }

  /* ---------------- tab 3: wheel and axle ---------------- */
  /**
   * A well windlass. A wheel and a thinner axle turn together. The bucket's rope winds onto the axle on the right; the
   * effort rope unwinds from the rim of the wheel on the left and is pulled down through a force meter. Turning the
   * pair anticlockwise lifts the bucket by r for every radian and pays out R of effort rope.
   */
  private wheelBench(p: { W: number; r: number; R: number; h: number }) {
    const g = this.clear('wheel_axle')
    const K = 18
    const ru = p.r * K
    const Ru = p.R * K
    const cy = Math.max(Ru, ru) + 7.5
    const wood = this.mat(0x7a5a3a, 0, 0.9)
    // one post behind the wheel carries the axle, so nothing stands between the viewer and the wheel
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.9, cy + 0.9, 0.9), wood)
    post.position.set(0, (cy + 0.9) / 2, -3.6)
    post.castShadow = true
    const foot = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.5, 2.4), wood)
    foot.position.set(0, 0.25, -3.6)
    g.add(post, foot)
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.2, 1.8, 28, 1, true), this.mat(0x6b6256, 0.1, 0.95))
    ring.position.set(ru, 0.9, 1.6)
    const water = new THREE.Mesh(new THREE.CircleGeometry(2.9, 28), this.mat(0x2a7fb5, 0.2, 0.2))
    water.rotation.x = -Math.PI / 2
    water.position.set(ru, 0.4, 1.6)
    g.add(ring, water)
    // the axle and the wheel spin together about z
    const spin = new THREE.Group()
    spin.position.set(0, cy, 0)
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(ru, ru, 6.0, 28).rotateX(Math.PI / 2).translate(0, 0, -0.5), this.mat(0xc9a24a, 0.7, 0.4))
    axle.castShadow = true
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.12, ru * 2.02, 6.02).translate(0, 0, -0.5), this.mat(0x6b4f1d, 0.3, 0.6))
    spin.add(axle, stripe)
    // the wheel model has its own short axle along x: turn it to face the viewer and set it in front
    const wm = this.fit(this.wheelModel, { height: 2 * Ru, fallback: () => new THREE.Mesh(new THREE.TorusGeometry(Ru, 0.25, 10, 40), this.mat(0x2b6cb0, 0.3, 0.5)) })
    const face = new THREE.Group()
    face.rotation.y = Math.PI / 2
    wm.position.y = -Ru
    face.add(wm)
    face.position.z = -2.0
    spin.add(face)
    g.add(spin)
    const bucket = new THREE.Group()
    const bk = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.8, 1.3, 18), this.mat(0x7c8798, 0.8, 0.4))
    bk.position.y = -0.65
    const bw = new THREE.Mesh(new THREE.CircleGeometry(0.9, 18), this.mat(0x2a7fb5, 0, 0.2))
    bw.rotation.x = -Math.PI / 2
    bw.position.y = -0.1
    bucket.add(bk, bw)
    const loadRope = this.rope([V(ru, cy, 1.6), V(ru, 2, 1.6)])
    const effRope = this.rope([V(-Ru, cy, -2.0), V(-Ru, 2, -2.0)], 0.07, 0xd7263d)
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 12), this.mat(0xe3b78f, 0, 0.7))
    const meter = new Readout(2.8, 0.8)
    meter.set('0.0 N', '#bff5c9')
    const earrow = this.arrow(0x4ade80)
    const larrow = this.arrow(0xff5470)
    const wl = this.label(`wheel, radius ${f1(p.R * 100)} cm`, '#ffd9a0', 0.62)
    wl.position.set(-Ru - 1.5, cy + Ru + 1, -2.0)
    const al = this.label(`axle, radius ${f1(p.r * 100)} cm`, '#ffd9a0', 0.62)
    al.position.set(ru + 3.6, cy + 1.6, 1.6)
    g.add(bucket, loadRope, effRope, hand, meter, earrow, larrow, wl, al)
    const E = wheelEffort(p.W, p.r, p.R)
    const yb0 = 1.4
    const rise = Math.min(cy - ru - 2.2 - yb0, 5.5)
    const yh0 = cy - Math.max(Ru, 0.5) - 0.5
    const update = (k: number) => {
      const theta = (rise * k) / ru
      spin.rotation.z = theta
      const yb = yb0 + rise * k
      bucket.position.set(ru, yb, 1.6)
      this.setRope(loadRope, [V(ru, cy, 1.6), V(ru, yb, 1.6)])
      const yh = Math.max(1.2, yh0 - Ru * theta * 0.35)
      this.setRope(effRope, [V(-Ru, cy, -2.0), V(-Ru, yh, -2.0)])
      hand.position.set(-Ru, yh - 0.3, -1.7)
      this.pushArrow(earrow, V(-Ru - 1.0, yh + 0.8, -1.6), V(0, -1, 0), E, p.W)
      this.pushArrow(larrow, V(ru + 1.6, yb + 3.0, 1.6), V(0, -1, 0), p.W, p.W)
      meter.position.set(-Ru - 3.2, yh - 0.4, -1.4)
      meter.set(`${f1(E)} N`, '#bff5c9')
    }
    update(0)
    return { update, E, cy }
  }

  private async runWheel(p: { W: number; r: number; R: number; h: number }) {
    this.abort()
    const bench = this.wheelBench(p)
    const v = this.view('wheel')
    await this.flyTo(V(v.pos.x + 2, bench.cy * 0.7, 18 + bench.cy * 1.6), V(v.target.x, bench.cy * 0.62, 0), 1000)
    if (this.disposed) return
    const turns = turnsToLift(p.h, p.r)
    const st = { t: 0 }
    return this.begin({
      update: (dt) => {
        st.t += dt
        const k = easeInOut(seg(st.t, 0.8, 6.0))
        bench.update(k)
        this.emitGauges(dt, () => [
          { label: 'Bucket weight', value: `${f1(p.W)} N`, tone: 'info' },
          { label: 'Effort on the wheel rope', value: `${f1(bench.E)} N`, tone: 'warn' },
          { label: 'Turns', value: f1(turns * k) },
          { label: 'Rope pulled off the wheel', value: `${f2(p.h * (p.R / p.r) * k)} m` },
          { label: 'Bucket lifted', value: `${f2(p.h * k)} m` },
        ])
        return st.t > 7 ? 900 : null
      },
      done: () => undefined,
    })
  }

  private async runScrewdriver(p: { W: number; r: number; R1: number; R2: number }) {
    this.abort()
    const g = this.clear('wheel_axle')
    const K = 110
    const items = [
      { x: -5.5, R: p.R1, name: 'thin handle' },
      { x: 5.5, R: p.R2, name: 'thick handle' },
    ].map((d) => {
      const grp = new THREE.Group()
      grp.position.set(d.x, 0, 0)
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(p.r * K, p.r * K, 6.5, 16), this.mat(STEEL, 0.9, 0.3))
      shaft.position.y = 3.6
      const tip = new THREE.Mesh(new THREE.ConeGeometry(p.r * K * 0.95, 0.9, 16), this.mat(STEEL, 0.9, 0.3))
      tip.rotation.x = Math.PI
      tip.position.y = 0.45
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(d.R * K, d.R * K, 5.2, 28), this.mat(d.R === p.R1 ? 0xd7263d : 0x2b6cb0, 0.1, 0.55))
      handle.position.y = 9.2
      handle.castShadow = true
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(p.r * K * 0.8, p.r * K * 0.8, 0.6, 12), this.mat(0xc9a24a, 0.9, 0.3))
      screw.position.y = 0.1
      // grip ridges so the turning shows
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.18, 4.6, 0.18), this.mat(0x1b1f27, 0.1, 0.6))
        rib.position.set(Math.cos(a) * d.R * K, 9.2, Math.sin(a) * d.R * K)
        grp.add(rib)
      }
      grp.add(shaft, tip, handle, screw)
      const meter = new Readout(2.8, 0.8)
      meter.set('0.0 N', '#bff5c9')
      meter.position.set(d.x, 13.0, 0)
      const lab = this.label(d.name, '#ffd9a0', 0.9)
      lab.position.set(d.x, 14.1, 0)
      const ar = this.arrow(0x4ade80)
      g.add(grp, meter, lab, ar)
      return { ...d, grp, meter, ar, E: wheelEffort(p.W, p.r, d.R) }
    })
    const board = new THREE.Mesh(new THREE.BoxGeometry(18, 0.6, 6), this.mat(0xb08a5a, 0, 0.9))
    board.position.y = -0.1
    g.add(board)
    const v = this.view('driver')
    await this.flyTo(v.pos, v.target, 1000)
    if (this.disposed) return
    const st = { t: 0 }
    return this.begin({
      update: (dt) => {
        st.t += dt
        const prog = easeInOut(seg(st.t, 0.6, 4.6))
        for (const it of items) {
          it.grp.rotation.y = -prog * Math.PI * 4
          const rim = V(it.x + it.R * K * Math.cos(-prog * Math.PI * 4), 9.2, it.R * K * Math.sin(-prog * Math.PI * 4))
          const tan = V(-Math.sin(-prog * Math.PI * 4), 0, Math.cos(-prog * Math.PI * 4))
          this.pushArrow(it.ar, rim.clone().sub(tan.clone().multiplyScalar(1.4)), tan, it.E, p.W)
          it.meter.set(`${f1(it.E)} N`, '#bff5c9')
        }
        this.emitGauges(dt, () => [
          { label: 'Turning effect needed', value: `${f1(p.W)} N at the shaft`, tone: 'info' },
          { label: 'Thin handle: grip force', value: `${f1(items[0].E)} N`, tone: 'warn' },
          { label: 'Thick handle: grip force', value: `${f1(items[1].E)} N`, tone: 'warn' },
        ])
        return st.t > 5.6 ? 900 : null
      },
      done: () => undefined,
    })
  }

  /* ---------------- tab 4: the inclined plane ---------------- */
  private rampMesh(len: number, hgt: number): THREE.Group {
    // the model is a unit wedge 2 long and 1 high: stretch it to this ramp, with its tall end towards +x
    const wrap = new THREE.Group()
    const w = 4
    if (this.rampModel) {
      // Bake the model into this ramp's size: turn it so the tall end faces +x, then stretch it to length x height x width.
      const src = this.rampModel
      src.updateMatrixWorld(true)
      const rot = new THREE.Matrix4().makeRotationY(this.rampTurn)
      const meshes: { geo: THREE.BufferGeometry; mat: THREE.Material | THREE.Material[] }[] = []
      const box = new THREE.Box3()
      src.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        const geo = m.geometry.clone()
        geo.applyMatrix4(m.matrixWorld)
        geo.applyMatrix4(rot)
        geo.computeBoundingBox()
        box.union(geo.boundingBox as THREE.Box3)
        meshes.push({ geo, mat: m.material })
      })
      const size = box.getSize(new THREE.Vector3())
      const c = box.getCenter(new THREE.Vector3())
      const M = new THREE.Matrix4().makeScale(len / size.x, hgt / size.y, w / size.z).multiply(new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z))
      for (const { geo, mat } of meshes) {
        geo.applyMatrix4(M)
        geo.computeVertexNormals()
        const mesh = new THREE.Mesh(geo, mat)
        mesh.castShadow = true
        mesh.receiveShadow = true
        wrap.add(mesh)
      }
    } else {
      const shape = new THREE.Shape()
      shape.moveTo(-len / 2, 0)
      shape.lineTo(len / 2, 0)
      shape.lineTo(len / 2, hgt)
      shape.closePath()
      const m = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false }), this.mat(0xb08a5a, 0, 0.8))
      m.position.z = -w / 2
      wrap.add(m)
    }
    return wrap
  }

  private async runRamp(p: { W: number; h: number; len1: number; len2: number }) {
    this.abort()
    const g = this.clear('inclined_plane')
    const HS = 3.2 // units per metre of height
    const LS = 2.2 // units per metre of ramp length
    const hu = p.h * HS
    const lengthen = p.len2 > p.len1 + 1e-6
    // the truck: a flat bed at the top of the ramp, with a cab behind it
    const bed = new THREE.Mesh(new THREE.BoxGeometry(11, 0.5, 5), this.mat(0x3a4254, 0.4, 0.6))
    bed.position.set(5.5, hu - 0.25, 0)
    const cab = new THREE.Mesh(new THREE.BoxGeometry(3, 3.2, 4.6), this.mat(0xd7263d, 0.3, 0.5))
    cab.position.set(9.8, hu + 1.6, 0)
    const wheelsT = [-1, 1].flatMap((s) => [2.5, 8].map((x) => {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.8, 18), this.mat(0x15171c, 0.1, 0.9))
      w.rotation.x = Math.PI / 2
      w.position.set(x, 1.1, s * 2.7)
      return w
    }))
    for (const m of [bed, cab]) m.castShadow = true
    const stand = new THREE.Mesh(new THREE.BoxGeometry(11, hu - 0.5, 4.6), this.mat(0x232733, 0.3, 0.7))
    stand.position.set(5.5, (hu - 0.5) / 2, 0)
    g.add(bed, cab, stand, ...wheelsT)
    let ramp = this.rampMesh(p.len1 * LS, hu)
    ramp.position.set(-p.len1 * LS / 2, 0, 0)
    g.add(ramp)
    const crate = this.crate(1.9)
    const liftX = -p.len1 * LS - 4.5
    crate.position.set(lengthen ? -p.len1 * LS - 1 : liftX, 0, 0)
    g.add(crate)
    const meter = new Readout(3.0, 0.85)
    meter.set('0.0 N', '#bff5c9')
    const earrow = this.arrow(0x4ade80)
    const larrow = this.arrow(0xff5470)
    const tag = this.label('truck bed', '#ffd9a0', 0.6)
    tag.position.set(5.5, hu + 2.4, 0)
    g.add(meter, earrow, larrow, tag)
    // a ruler along the ramp's foot and a height marker
    const hline = new THREE.Mesh(new THREE.BoxGeometry(0.12, hu, 0.12), this.mat(0xffd166, 0, 0.5))
    hline.position.set(0.2, hu / 2, 2.8)
    const hlab = this.label(`${f1(p.h)} m`, '#ffd166', 0.5)
    hlab.position.set(1.8, hu / 2, 2.8)
    g.add(hline, hlab)
    // frame everything from the crate's start (or the long ramp's foot) to the truck's cab
    const left = Math.min(lengthen ? -p.len2 * LS - 3 : liftX - 2, -p.len1 * LS - 3)
    const right = 12
    const cx = MODULE_X.inclined_plane + (left + right) / 2
    const span = right - left
    await this.flyTo(V(cx, 7 + span * 0.2, span * 1.45), V(cx, 3.2, 0), 1000)
    if (this.disposed) return
    const st = { t: 0, len: p.len1 }
    let rampLen = p.len1
    const place = (len: number) => {
      g.remove(ramp)
      ramp = this.rampMesh(len * LS, hu)
      ramp.position.set(-len * LS / 2, 0, 0)
      g.add(ramp)
      rampLen = len
    }
    return this.begin({
      update: (dt) => {
        st.t += dt
        let E = p.W
        let dist = 0
        let phase = 'lift'
        if (!lengthen) {
          // 1. lift straight up beside the ramp, 2. push up the ramp
          const a = easeInOut(seg(st.t, 0.8, 3.0))
          const b = easeInOut(seg(st.t, 4.2, 8.0))
          if (st.t < 3.8) {
            crate.position.set(liftX, a * hu, 0)
            E = p.W
            dist = p.h * a
            phase = 'lift'
            this.pushArrow(earrow, V(liftX, a * hu - 3.2, 0), V(0, 1, 0), E, p.W)
          } else {
            if (rampLen !== p.len1) place(p.len1)
            const slope = Math.atan2(hu, p.len1 * LS)
            const s = b * Math.hypot(p.len1 * LS, hu)
            crate.position.set(-p.len1 * LS + Math.cos(slope) * s - 0.3 + (1 - Math.min(1, st.t - 3.8)) * (liftX + p.len1 * LS) * Math.max(0, 1 - (st.t - 3.8) * 2), Math.sin(slope) * s, 0)
            if (st.t < 4.2) crate.position.set(liftX + (-p.len1 * LS - liftX) * easeInOut(seg(st.t, 3.8, 4.2)), 0, 0)
            crate.rotation.z = st.t >= 4.2 ? slope : 0
            E = rampEffort(p.W, p.h, p.len1)
            dist = p.len1 * b
            phase = 'ramp'
            this.pushArrow(earrow, crate.position.clone().add(V(-Math.cos(slope) * 3.4, -Math.sin(slope) * 3.4 + 0.9, 0)), V(Math.cos(slope), Math.sin(slope), 0), E, p.W)
          }
        } else {
          // push up the short ramp, then swap to the long one and push again
          const first = easeInOut(seg(st.t, 0.8, 3.8))
          const second = easeInOut(seg(st.t, 6.4, 10.4))
          const useLen = st.t < 4.8 ? p.len1 : p.len2
          if (useLen !== rampLen) {
            place(useLen)
            sound.click()
          }
          const prog = st.t < 4.8 ? first : second
          if (st.t >= 4.8) crate.position.set(-useLen * LS - 1, 0, 0)
          const slope = Math.atan2(hu, useLen * LS)
          const s = prog * Math.hypot(useLen * LS, hu)
          if (st.t < 4.8 || st.t >= 6.4) {
            crate.position.set(-useLen * LS + Math.cos(slope) * s - 0.3 - (prog === 0 ? 0.7 : 0), Math.sin(slope) * s, 0)
            crate.rotation.z = prog > 0 ? slope : 0
          } else crate.rotation.z = 0
          E = rampEffort(p.W, p.h, useLen)
          dist = useLen * prog
          phase = st.t < 4.8 ? 'short ramp' : 'long ramp'
          this.pushArrow(earrow, crate.position.clone().add(V(-Math.cos(slope) * 3.4, -Math.sin(slope) * 3.4 + 0.9, 0)), V(Math.cos(slope), Math.sin(slope), 0), E, p.W)
        }
        meter.position.set(crate.position.x - 2.2, crate.position.y + 4.2, 0)
        meter.set(`${f1(E)} N`, '#bff5c9')
        this.pushArrow(larrow, crate.position.clone().add(V(0, 3.6, 0)), V(0, -1, 0), p.W, p.W)
        this.emitGauges(dt, () => [
          { label: 'Crate weight', value: `${f1(p.W)} N`, tone: 'info' },
          { label: phase === 'lift' ? 'Lifting straight up' : phase === 'ramp' ? 'Pushing up the ramp' : phase, value: `${f1(E)} N`, tone: 'warn' },
          { label: 'Distance moved', value: `${f2(dist)} m` },
          { label: 'Ramp length', value: phase === 'lift' ? '–' : `${f1(phase === 'long ramp' ? p.len2 : p.len1)} m` },
        ])
        return st.t > (lengthen ? 11.4 : 9.0) ? 900 : null
      },
      done: () => undefined,
    })
  }

  /* ---------------- loading ---------------- */
  async load(): Promise<void> {
    const loader = new GLTFLoader()
    const a = this.lesson.assets
    const urls = [a.crowbar, a.pulley, a.wheel, a.cycleWheel, a.ramp, a.crate, a.wheelbarrow, a.tweezers].filter(Boolean)
    let done = 0
    const get = async (url: string | undefined) => {
      if (!url) return null
      const r = await loader.loadAsync(url).then((x) => x.scene).catch((err) => {
        console.warn('[machines] model failed to load, using a stand-in', url, err)
        return null
      })
      this.events.onProgress?.(++done, urls.length)
      return r
    }
    const [crowbar, pulley, wheel, cycle, ramp, crate, barrow, tweezers] = await Promise.all([get(a.crowbar), get(a.pulley), get(a.wheel), get(a.cycleWheel), get(a.ramp), get(a.crate), get(a.wheelbarrow), get(a.tweezers)])
    if (this.disposed) return
    this.crowbar = crowbar
    this.pulleyModel = pulley
    this.wheelModel = wheel
    this.cycleModel = cycle
    this.rampModel = ramp
    this.crateModel = crate
    this.barrowModel = barrow
    this.tweezersModel = tweezers
    if (ramp) this.findRampSlope(ramp)
    void this.cycleModel
  }

  /** Which way the wedge slopes: the sloping face's normal points up and towards the low end. */
  private findRampSlope(model: THREE.Object3D) {
    model.updateMatrixWorld(true)
    const n = new THREE.Vector3()
    const nm = new THREE.Matrix3()
    let hx = 0
    let hz = 0
    model.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      m.geometry.computeVertexNormals()
      const normals = m.geometry.attributes.normal as THREE.BufferAttribute
      nm.getNormalMatrix(m.matrixWorld)
      for (let i = 0; i < normals.count; i++) {
        n.fromBufferAttribute(normals, i).applyMatrix3(nm).normalize()
        if (n.y > 0.15 && n.y < 0.96) {
          hx -= n.x
          hz -= n.z
        }
      }
    })
    // rotating by this turn about y sends the tall end to +x
    this.rampTurn = Math.hypot(hx, hz) > 1e-6 ? Math.atan2(hz, hx) : 0
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
    const X2 = MODULE_X.pulleys
    const X3 = MODULE_X.wheel_axle
    const X4 = MODULE_X.inclined_plane
    switch (name) {
      case 'pair':
        return { pos: V(0, 13, 26), target: V(0, 3, 0) }
      case 'pulleys':
        return { pos: V(X2, 10.5, 35), target: V(X2, 8.8, 0) }
      case 'wheel':
        return { pos: V(X3, 8, 30), target: V(X3, 7, 0) }
      case 'driver':
        return { pos: V(X3, 12, 28), target: V(X3, 7.6, 0) }
      case 'ramp':
        return { pos: V(X4 - 2, 10, 32), target: V(X4 - 2, 3, 0) }
      default:
        return { pos: V(0, 9.5, 20), target: V(0, 3.4, 0) }
    }
  }

  async goto(moduleId: string, instant = false): Promise<void> {
    this.abort()
    this.moduleId = moduleId
    for (const [id, g] of Object.entries(this.groups)) g.visible = id === moduleId
    this.events.onGauges?.(null)
    this.events.onNote?.(null)
    const v = this.view(moduleId === 'pulleys' ? 'pulleys' : moduleId === 'wheel_axle' ? 'wheel' : moduleId === 'inclined_plane' ? 'ramp' : 'levers')
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
      case 'lever':
        void this.stageLever({ W: num(params.W, 200), L: num(params.L, 2), d1: num(params.d1, 1), d2: num(params.d2, 1) })
        break
      case 'lever_pair':
      case 'lever_types':
        // nothing is set out before the prediction: the lever would give the answer away
        this.clear('levers')
        void this.flyTo(this.view('levers').pos, this.view('levers').target, 900)
        break
      case 'pulley':
        this.pulleyBench({ W: num(params.W, 200), h: num(params.h, 1) })
        void this.flyTo(this.view('pulleys').pos, this.view('pulleys').target, 900)
        break
      case 'wheel': {
        const b = this.wheelBench({ W: num(params.W, 150), r: num(params.r, 0.05), R: num(params.R, 0.25), h: num(params.h, 1) })
        void this.flyTo(V(MODULE_X.wheel_axle + 2, b.cy * 0.7, 18 + b.cy * 1.6), V(MODULE_X.wheel_axle, b.cy * 0.62, 0), 900)
        break
      }
      case 'screwdriver':
        this.clear('wheel_axle')
        break
      case 'ramp':
        this.clear('inclined_plane')
        break
      default:
    }
  }

  private async stageLever(p: { W: number; L: number; d1: number; d2: number }) {
    const g = this.clear('levers')
    const SC = 11 / p.L
    const len = p.L * SC
    const rig = this.leverRig(g, { length: len, z: 0, load: -len / 2 + 0.9, fulcrumAt: -len / 2 + p.d1 * SC, effortAt: len / 2 - 0.5 })
    this.pushArrow(rig.larrow, V(-len / 2 + 0.9, 7.5, 0), V(0, -1, 0), p.W, p.W)
    const v = this.view('levers')
    void this.flyTo(v.pos, v.target, 900)
  }

  async run(action: string, params: Record<string, unknown> = {}): Promise<void> {
    this.events.onNote?.(null)
    switch (action) {
      case 'lever':
        return this.runLever({ W: num(params.W, 200), L: num(params.L, 2), d1: num(params.d1, 1), d2: num(params.d2, 0.5) })
      case 'lever_types':
        return this.runLeverTypes({ W: num(params.W, 200), focus: num(params.focus, 1), name: String(params.name ?? 'lever'), la: num(params.la, 0.25), ea: num(params.ea, 1) })
      case 'lever_pair':
        return this.runLeverPair({
          W: num(params.W, 200),
          a: [String(params.aName ?? 'lever A'), num(params.aCls, 2), num(params.aLoad, 0.5), num(params.aEffort, 1.4)],
          b: [String(params.bName ?? 'lever B'), num(params.bCls, 3), num(params.bLoad, 0.12), num(params.bEffort, 0.07)],
        })
      case 'pulley':
        return this.runPulley({ W: num(params.W, 200), h: num(params.h, 1), compare: params.compare === true })
      case 'wheel':
        return this.runWheel({ W: num(params.W, 150), r: num(params.r, 0.05), R: num(params.R, 0.25), h: num(params.h, 1) })
      case 'screwdriver':
        return this.runScrewdriver({ W: num(params.W, 60), r: num(params.r, 0.004), R1: num(params.R1, 0.01), R2: num(params.R2, 0.02) })
      case 'ramp':
        return this.runRamp({ W: num(params.W, 800), h: num(params.h, 1.2), len1: num(params.len1, 4), len2: num(params.len2, 4) })
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
