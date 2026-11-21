import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { BiologyLessonContract } from '@mmaxr/schema'
import { sound } from './sound'
import type { JourneyScene } from './journeyScene'

/*
 * The respiratory theatre. The body is the "torso with removable organs" model (heart, lungs, bronchi, trachea),
 * topped by a simple head with the nose, nasal cavity, pharynx, larynx and epiglottis, with ribs and a diaphragm
 * that move. A high-poly "human lungs" model floats beside it as a close-up for the larynx, trachea, bronchi and
 * lungs stops. The nose lining, one alveolus with its capillary, a body cell, muscle and yeast are built from shapes
 * and carry the molecule-level animations. Nothing here names an answer: labels come from the server's reveal.
 */

const S = 2.0 // the body, in model units (metres), is drawn at this scale
const BODY_Y = 0.45 // it stands on the pedestal
/** The whole body is in view while an animation plays, so floating text must be large to stay readable. */
const LABEL_K = 3.4
type Ease = (t: number) => number
const easeInOut: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const easeOut: Ease = (t) => 1 - Math.pow(1 - t, 3)
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const mat = (color: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.02, ...o })
const glass = (color: number, opacity: number, o: Partial<THREE.MeshPhysicalMaterialParameters> = {}) => new THREE.MeshPhysicalMaterial({ color, transparent: true, opacity, roughness: 0.35, depthWrite: false, side: THREE.DoubleSide, ...o })

export interface RespiratorySceneEvents {
  onProgress?(done: number, total: number): void
}

/** The air's route, in body (model) space: nostril, nasal cavity, pharynx, larynx, trachea, carina. */
const AIR: [number, number, number][] = [
  [0, 0.795, 0.165],
  [0, 0.812, 0.1],
  [0, 0.805, 0.055],
  [0, 0.76, 0.013],
  [0, 0.69, 0.011],
  [0, 0.635, 0.025],
  [0, 0.57, 0.025],
  [0, 0.515, 0.025],
]
const CARINA = V(0, 0.515, 0.025)

/** Where the airway runs inside the close-up lungs model (its own local units, metres). */
const LUNG_TRACHEA: [number, number, number][] = [[0, 0.285, 0], [0, 0.22, 0], [0.004, 0.172, 0]]
const LUNG_LOBES: { key: string; x: number; y: number }[] = [
  { key: 'R-sup', x: -0.07, y: 0.17 },
  { key: 'R-inf', x: -0.06, y: 0.06 },
  { key: 'L-sup', x: 0.07, y: 0.17 },
  { key: 'L-inf', x: 0.065, y: 0.06 },
]

interface Inset {
  key: string
  group: THREE.Group
  /** The model inside it, wrapped so it can swell and shrink without disturbing the magnification. */
  holder: THREE.Group
  home: THREE.Vector3
  ready: boolean
  shown: number
  target: number
  /** Magnification while its animation plays (the whole body is in view, so the close-up must be bigger). */
  boost: number
  boostTarget: number
  light: THREE.PointLight
  line: THREE.Line
}

interface Particle {
  mesh: THREE.Mesh
  vel: THREE.Vector3
  life: number
  max: number
  gravity: number
}

type Parts = Record<string, any>

/** A lobe of the lung with the route air takes to reach it, in body space. */
interface Lobe {
  name: string
  side: 'R' | 'L'
  mesh: THREE.Mesh
  center: THREE.Vector3
  path: THREE.Vector3[]
}

export class RespiratoryScene implements JourneyScene {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  private readonly clock = new THREE.Clock()
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2(10, 10)
  private readonly handPoint = new THREE.Vector3(0, 1, 0.5)
  private readonly handPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -0.4)
  private readonly body = new THREE.Group()
  private body_: Parts = {}
  private lobes: Lobe[] = []
  private heartAt = V(0.03, 0.42, 0.05)
  private insets: Record<string, Inset> = {}
  private halos: THREE.Mesh[] = []
  private anchors: THREE.Vector3[] = []
  private activeHalo = -1
  private airCurve = new THREE.CatmullRomCurve3(AIR.map(([x, y, z]) => V(x, y, z)), false, 'catmullrom', 0.4)
  private tweens = new Set<(dt: number) => boolean>()
  private particles: Particle[] = []
  private temps: THREE.Object3D[] = []
  private dust: THREE.Points | null = null
  private insetsPx = { left: 0, right: 0, top: 0, bottom: 0 }
  private insetsTarget = { left: 0, right: 0, top: 0, bottom: 0 }
  private swayUntil = 0
  private vibrateUntil = 0
  private disposed = false
  private running = false
  private busy = false
  private flightId = 0
  private finalLoop = 0
  private currentIndex = -1
  private readonly onResize = () => this.resize()

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly lesson: BiologyLessonContract,
    private readonly events: RespiratorySceneEvents = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.xr.enabled = true

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.03, 40)
    this.camera.position.set(0.5, 1.6, 5.2)
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.target.set(0, 1.3, 0)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.enablePan = false
    this.controls.minDistance = 0.45
    this.controls.maxDistance = 6.5
    this.controls.minPolarAngle = Math.PI * 0.25
    this.controls.maxPolarAngle = Math.PI * 0.62
    this.controls.minAzimuthAngle = -Math.PI * 0.45
    this.controls.maxAzimuthAngle = Math.PI * 0.45
    this.controls.rotateSpeed = 0.55
    this.controls.addEventListener('start', () => (this.flightId += 1)) // the student took over

    this.buildStage()
    this.buildHeadAndFrame()
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
    scene.background = new THREE.Color(0x080b12)
    scene.fog = new THREE.Fog(0x080b12, 7, 15)
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.7
    scene.add(new THREE.HemisphereLight(0xbcd0ff, 0x1a1410, 0.7))
    const key = new THREE.DirectionalLight(0xfff1dd, 2.3)
    key.position.set(1.5, 3, 3)
    scene.add(key)
    const rimA = new THREE.PointLight(0x4f8cff, 9, 8)
    rimA.position.set(-2, 1.8, -1.2)
    const rimB = new THREE.PointLight(0xff7ab6, 6, 8)
    rimB.position.set(2.2, 1.4, -1)
    scene.add(rimA, rimB)

    const floor = new THREE.Mesh(new THREE.CircleGeometry(8, 64), new THREE.MeshStandardMaterial({ color: 0x10131a, roughness: 0.5, metalness: 0.3 }))
    floor.rotation.x = -Math.PI / 2
    scene.add(floor)
    for (const [r0, r1, o] of [[1.0, 1.05, 0.35], [1.8, 1.82, 0.15]] as const) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 96), new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: o, side: THREE.DoubleSide }))
      ring.rotation.x = -Math.PI / 2
      ring.position.y = 0.002
      scene.add(ring)
    }
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.58, BODY_Y, 48), new THREE.MeshStandardMaterial({ color: 0xe9ecf2, roughness: 0.35, metalness: 0.1 }))
    ped.position.y = BODY_Y / 2
    scene.add(ped)

    const n = 160
    const pos = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 7
      pos[i * 3 + 1] = Math.random() * 3.6
      pos[i * 3 + 2] = (Math.random() - 0.5) * 5
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.dust = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xaecbff, size: 0.012, transparent: true, opacity: 0.4, depthWrite: false }))
    scene.add(this.dust)
  }

  /* ---------------- the body ---------------- */
  /** The parts the torso model lacks: head, nose, throat, voice box, ribs and the diaphragm. */
  private buildHeadAndFrame() {
    const b = this.body
    // The torso model is drawn mirrored so the patient's right is on the viewer's left, like a textbook.
    b.scale.set(-S, S, S)
    b.position.y = BODY_Y
    this.scene.add(b)
    const P: Parts = (this.body_ = {})

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.066, 0.16, 28, 1, true), glass(0xcfe0ff, 0.14))
    neck.position.set(0, 0.68, 0.02)
    b.add(neck)

    // Head group: authored for a figure 0.41 m taller, then lowered onto the torso's neck.
    const headG = new THREE.Group()
    headG.position.set(0, -0.41, 0.025)
    b.add(headG)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.118, 40, 28), glass(0xcfe0ff, 0.2))
    head.position.set(0, 1.24, 0)
    head.scale.set(0.88, 1.08, 1)
    headG.add(head)
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.065, 20), glass(0xf1c7b0, 0.55))
    nose.rotation.x = Math.PI / 2
    nose.position.set(0, 1.205, 0.14)
    headG.add(nose)
    for (const sx of [-1, 1]) {
      const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 8), mat(0x6b2d2d))
      nostril.position.set(sx * 0.012, 1.196, 0.168)
      headG.add(nostril)
    }
    const cavity = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), glass(0xff9aa8, 0.5))
    cavity.scale.set(0.028, 0.034, 0.07)
    cavity.position.set(0, 1.225, 0.06)
    headG.add(cavity)
    const tube = (pts: [number, number, number][], r: number, m: THREE.Material) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => V(x, y, z))), 24, r, 14, false), m)
    headG.add(tube([[0, 1.215, 0.025], [0, 1.17, -0.015], [0, 1.1, -0.016], [0, 1.062, -0.006]], 0.02, glass(0xff8fa0, 0.55)))
    headG.add(tube([[0, 1.1, -0.03], [0, 1.0, -0.036], [0, 0.9, -0.04]], 0.008, glass(0xc98a5a, 0.22)))

    const larynx = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.021, 0.04, 24, 1, true), glass(0xf4f1e8, 0.6))
    larynx.position.set(0, 1.04, 0)
    headG.add(larynx)
    P.cords = [-1, 1].map((sx) => {
      const piv = new THREE.Group()
      piv.position.set(sx * 0.017, 1.038, -0.014)
      const cord = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.003, 0.026), mat(0xff8a9a, { emissive: 0x551a22 }))
      cord.position.z = 0.013
      piv.add(cord)
      piv.rotation.y = sx * -0.25
      headG.add(piv)
      piv.userData.rest = piv.rotation.y
      return piv
    })
    const epi = new THREE.Group()
    epi.position.set(0, 1.066, 0.016)
    const flap = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.002, 0.024), mat(0xffc7a8))
    flap.position.z = -0.012
    epi.add(flap)
    epi.rotation.x = 1.05 // open: tilted up and back
    headG.add(epi)
    P.epiglottis = epi

    // Ribs (a group, so they can lift and spread when we inhale) and sternum.
    const ribs = new THREE.Group()
    for (let i = 0; i < 7; i++) {
      const g = new THREE.TorusGeometry(0.178 - Math.abs(i - 2) * 0.003, 0.0028, 8, 48, Math.PI * 2 - 0.5)
      g.rotateZ(Math.PI / 2 + 0.25)
      g.rotateX(Math.PI / 2)
      g.scale(1, 1, 0.6)
      const r = new THREE.Mesh(g, mat(0xeeeadf, { transparent: true, opacity: 0.2, roughness: 0.5, depthWrite: false }))
      r.position.y = 0.55 - i * 0.036
      ribs.add(r)
    }
    const sternum = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.23, 0.006), mat(0xeeeadf, { transparent: true, opacity: 0.45 }))
    sternum.position.set(0, 0.45, 0.108)
    ribs.add(sternum)
    b.add(ribs)
    P.ribs = ribs

    // Diaphragm: a dome under the lungs.
    const dia = new THREE.Mesh(new THREE.SphereGeometry(0.17, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xc4524f, { transparent: true, opacity: 0.8, side: THREE.DoubleSide, roughness: 0.55 }))
    dia.scale.set(1, 0.42, 0.62)
    dia.position.y = 0.285
    dia.userData.base = dia.scale.clone()
    b.add(dia)
    P.diaphragm = dia
  }

  /** The detailed torso: shell made see-through, organs kept, parts we animate tracked. */
  private async loadTorso(loader: GLTFLoader) {
    const url = this.lesson.assets.torso ?? this.lesson.modelUrl
    const gltf = await loader
      .loadAsync(url, (e) => {
        if (e.total) this.events.onProgress?.(Math.round((e.loaded / e.total) * 70), 100)
      })
      .catch((err) => {
        console.warn('[respiratory] torso failed to load', err)
        return null
      })
    if (!gltf || this.disposed) return
    const root = gltf.scene
    const lobeMeshes: THREE.Mesh[] = []
    const bronchi: THREE.Mesh[] = []
    const rings: THREE.Mesh[] = []
    root.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const n = m.name.replace(/_/g, ' ')
      if (/liver|stomach|intestine|bowel|kidney|renal|ureter/i.test(n)) {
        m.visible = false
        return
      }
      const own = () => (m.material = (m.material as THREE.Material).clone())
      if (/torso shell/i.test(n)) {
        const sm = own() as THREE.MeshStandardMaterial
        sm.transparent = true
        sm.opacity = 0.13
        sm.depthWrite = false
        sm.side = THREE.DoubleSide
        m.renderOrder = 1
        return
      }
      if (/^(left|right) lung .*lobe/i.test(n)) {
        own()
        lobeMeshes.push(m)
      } else if (/bronchus/i.test(n)) {
        own()
        bronchi.push(m)
      } else if (/tracheal cartilage ring/i.test(n)) {
        own()
        rings.push(m)
      } else if (/heart/i.test(n)) {
        m.geometry.computeBoundingBox()
        this.heartAt = m.geometry.boundingBox!.getCenter(V())
      }
    })
    const center = (m: THREE.Mesh) => {
      m.geometry.computeBoundingBox()
      return m.geometry.boundingBox!.getCenter(V())
    }
    // Routes air takes: carina -> main bronchus -> lobar bronchus -> the lobe itself.
    const find = (re: RegExp) => bronchi.find((m) => re.test(m.name.replace(/_/g, ' ')))
    this.lobes = lobeMeshes.map((m) => {
      const nm = m.name.replace(/_/g, ' ')
      const side = /^right/i.test(nm) ? 'R' : 'L'
      const lobe = (nm.match(/(superior|middle|inferior)/i)?.[1] ?? '').toLowerCase()
      const main = find(new RegExp(`^${side === 'R' ? 'right' : 'left'} main bronchus`, 'i'))
      const lobar = find(new RegExp(`^${side === 'R' ? 'right' : 'left'} ${lobe} lobar bronchus`, 'i'))
      const c = center(m)
      const path = [CARINA.clone(), ...(main ? [center(main)] : []), ...(lobar ? [center(lobar)] : []), c]
      return { name: nm, side, mesh: m, center: c, path } as Lobe
    })
    // The lungs and the bronchi swell together about the middle of the chest.
    const pivot = new THREE.Group()
    pivot.position.set(0, 0.44, 0.0)
    this.body.add(pivot)
    this.body.add(root)
    this.body.updateMatrixWorld(true)
    for (const m of [...lobeMeshes, ...bronchi]) pivot.attach(m)
    rings.sort((a, c) => center(c).y - center(a).y)
    this.body_.pivot = pivot
    this.body_.rings = rings
    this.body_.bronchi = bronchi
    this.body_.lobes = lobeMeshes
    this.events.onProgress?.(70, 100)
  }

  /** The detailed lungs (with larynx, trachea and bronchi), shown as a close-up beside the body. */
  private async loadLungsInset(loader: GLTFLoader) {
    const url = this.lesson.assets.lungs
    if (!url) return
    const gltf = await loader.loadAsync(url, (e) => {
      if (e.total) this.events.onProgress?.(70 + Math.round((e.loaded / e.total) * 30), 100)
    }).catch((err) => {
      console.warn('[respiratory] lungs model failed to load', err)
      return null
    })
    if (!gltf || this.disposed) return
    const model = gltf.scene
    this.addInset('lungs', V(-1.05, 1.5, 0.3), 0.62, 0xffb0b8, model)
    this.insets.lungs.group.userData.parts = { model }
    this.events.onProgress?.(100, 100)
  }

  /* ---------------- close-up models ---------------- */
  private addInset(key: string, home: THREE.Vector3, size: number, tint: number, model: THREE.Object3D) {
    const box = new THREE.Box3().setFromObject(model)
    const sz = box.getSize(new THREE.Vector3())
    model.scale.multiplyScalar(size / (sz.x || 1))
    const b2 = new THREE.Box3().setFromObject(model)
    model.position.sub(b2.getCenter(new THREE.Vector3()))
    const group = new THREE.Group()
    const holder = new THREE.Group()
    holder.add(model)
    group.add(holder)
    group.userData.parts = model.userData.parts
    group.position.copy(home)
    group.scale.setScalar(0.001)
    group.visible = false
    const light = new THREE.PointLight(tint, 0, 1.8)
    light.position.set(0, 0, 0.6)
    group.add(light)
    this.scene.add(group)
    const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: tint, dashSize: 0.025, gapSize: 0.02, transparent: true, opacity: 0 }))
    line.frustumCulled = false
    this.scene.add(line)
    this.insets[key] = { key, group, holder, home: home.clone(), ready: true, shown: 0, target: 0, boost: 1, boostTarget: 1, light, line }
    this.refreshInsetFor(this.currentIndex)
  }

  private buildInsets() {
    this.addInset('nasal', V(1.0, 2.1, 0.3), 0.62, 0xffd8a0, buildNasalLining())
    this.addInset('alveolus', V(1.05, 1.45, 0.3), 0.62, 0x9bd4ff, buildAlveolus())
    this.addInset('cell', V(1.0, 0.95, 0.3), 0.58, 0xffa060, buildCell())
    this.addInset('anaerobic', V(1.15, 0.72, 0.3), 0.9, 0xd8ff7a, buildAnaerobic())
  }

  async load(): Promise<void> {
    const loader = new GLTFLoader()
    this.buildInsets()
    this.buildAnchors()
    await this.loadTorso(loader)
    this.buildAnchors()
    void this.loadLungsInset(loader)
  }

  private bodyToWorld(p: THREE.Vector3) {
    this.body.updateMatrixWorld(true)
    return this.body.localToWorld(p.clone())
  }

  private buildAnchors() {
    for (const h of this.halos) this.scene.remove(h)
    this.halos = []
    this.anchors = this.lesson.checkpoints.map((cp) => this.bodyToWorld(V(cp.modelAnchor.x, cp.modelAnchor.y, cp.modelAnchor.z)))
    const sizes: Record<string, [number, number, number]> = { nasal_cavity: [0.05, 0.05, 0.08], pharynx: [0.025, 0.06, 0.03], larynx_trachea: [0.03, 0.1, 0.03], bronchi: [0.13, 0.09, 0.05], lungs: [0.2, 0.17, 0.1], alveoli: [0.05, 0.05, 0.05], diaphragm: [0.21, 0.05, 0.12], cells: [0.06, 0.06, 0.06], anaerobic: [0.06, 0.06, 0.06] }
    this.lesson.checkpoints.forEach((cp, i) => {
      const s = sizes[cp.id] ?? [0.08, 0.08, 0.06]
      const halo = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }))
      halo.scale.set(s[0] * S, s[1] * S, s[2] * S)
      halo.position.copy(this.anchors[i])
      halo.renderOrder = 6
      this.scene.add(halo)
      this.halos.push(halo)
    })
  }

  /* ---------------- camera + journey ---------------- */
  private viewFor(i: number): { pos: THREE.Vector3; target: THREE.Vector3 } {
    const cp = this.lesson.checkpoints[i]
    const anchor = this.anchors[i] ?? V(0, 1.3, 0)
    const inset = cp.detail ? this.insets[cp.detail]?.home ?? null : null
    const target = inset ? anchor.clone().lerp(inset, 0.5) : anchor.clone()
    const dist = inset ? 2.1 : ({ pharynx: 1.2, bronchi: 1.6, lungs: 2.2, diaphragm: 2.4 } as Record<string, number>)[cp.id] ?? 1.7
    const side = inset ? Math.sign(inset.x) * 0.1 : 0
    return { pos: V(target.x + side, target.y + 0.08, target.z + dist), target }
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

  async arrive(i: number, instant = false): Promise<void> {
    const prev = this.currentIndex
    this.currentIndex = i
    this.activeHalo = i
    this.refreshInsetFor(i)
    const v = this.viewFor(i)
    if (instant) {
      this.camera.position.copy(v.pos)
      this.controls.target.copy(v.target)
      return
    }
    sound.whoosh(1.2)
    await this.flyTo(v.pos, v.target, prev < 0 ? 2200 : 2300)
  }

  private refreshInsetFor(i: number) {
    const cp = this.lesson.checkpoints[i]
    for (const ins of Object.values(this.insets)) ins.target = cp?.detail === ins.key ? 1 : 0
  }

  private overviewView() {
    return { pos: V(0.1, 1.4, 6.0), target: V(0.1, 1.35, 0) }
  }

  overview(on: boolean) {
    if (this.busy) return
    if (on) {
      const o = this.overviewView()
      void this.flyTo(o.pos, o.target, 900)
    } else {
      const v = this.viewFor(Math.max(0, this.currentIndex))
      void this.flyTo(v.pos, v.target, 900)
    }
  }

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

  /* ---------------- tweens, particles, labels ---------------- */
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

  private burst(at: THREE.Vector3, n: number, o: { color: number; size?: number; speed?: number; life?: number; gravity?: number; up?: number }) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(o.size ?? 0.006, 8, 6), new THREE.MeshBasicMaterial({ color: o.color, transparent: true, opacity: 0.9, depthWrite: false }))
      m.position.copy(at)
      const sp = o.speed ?? 0.3
      const a = Math.random() * Math.PI * 2
      this.scene.add(m)
      this.particles.push({ mesh: m, vel: V(Math.cos(a) * sp * Math.random(), (o.up ?? 0.3) * sp * (0.4 + Math.random()), Math.sin(a) * sp * Math.random()), life: 0, max: (o.life ?? 1) * (0.7 + Math.random() * 0.6), gravity: o.gravity ?? 0 })
    }
  }

  private temp<T extends THREE.Object3D>(o: T, parent: THREE.Object3D = this.scene): T {
    parent.add(o)
    this.temps.push(o)
    return o
  }
  private clearTemps() {
    for (const o of this.temps) {
      o.parent?.remove(o)
      o.traverse((c) => {
        if (c instanceof THREE.Mesh || c instanceof THREE.Line) {
          c.geometry.dispose()
          for (const m of Array.isArray(c.material) ? c.material : [c.material]) m.dispose()
        }
      })
    }
    this.temps = []
  }

  private label(text: string, at: THREE.Vector3, scale = 1, bg = '#f4f1e8', color = '#14161a') {
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
    let size = 64
    ctx.font = `700 ${size}px Figtree, system-ui, sans-serif`
    // Long names lose their bracketed part ("Air (a mixture of gases)" becomes "Air") so the type stays large.
    if (ctx.measureText(text).width > 470) text = text.replace(/\s*\(.*\)\s*$/, '') || text
    while (ctx.measureText(text).width > 470 && size > 28) {
      size -= 4
      ctx.font = `700 ${size}px Figtree, system-ui, sans-serif`
    }
    ctx.fillText(text, 256, 72)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, depthTest: false }))
    sp.scale.set(0.3 * scale * LABEL_K, 0.082 * scale * LABEL_K, 1)
    sp.position.copy(at)
    sp.renderOrder = 9
    this.temp(sp)
    void this.animate(400, (k) => ((sp.material as THREE.SpriteMaterial).opacity = k))
    return sp
  }

  private labelStack(labels: string[], at: THREE.Vector3, gap = 0.058 * LABEL_K, scale = 0.62) {
    labels.slice(0, 7).forEach((t, i) => this.label(t, V(at.x, at.y - i * gap, at.z), scale))
  }

  /** A small ball. */
  private ball(color: number, r: number, at: THREE.Vector3, parent: THREE.Object3D = this.scene, emissive = 0) {
    const m = this.temp(new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), new THREE.MeshStandardMaterial({ color, emissive: emissive || color, emissiveIntensity: emissive ? 0.6 : 0.25, roughness: 0.35 })), parent)
    m.position.copy(at)
    return m
  }

  /** O₂ is two red atoms; CO₂ is a dark carbon with two red atoms. Radius is in world units. */
  private molecule(kind: 'o2' | 'co2', at: THREE.Vector3, r = 0.011) {
    const g = this.temp(new THREE.Group())
    const atom = (color: number, x: number, rr: number) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(rr, 14, 10), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.3 }))
      m.position.x = x
      g.add(m)
    }
    if (kind === 'o2') {
      atom(0xff3b3b, -r * 0.8, r)
      atom(0xff3b3b, r * 0.8, r)
    } else {
      atom(0x3a3f4a, 0, r * 1.15)
      atom(0xff3b3b, -r * 2.1, r * 0.95)
      atom(0xff3b3b, r * 2.1, r * 0.95)
    }
    g.position.copy(at)
    g.rotation.z = Math.random() * Math.PI
    return g
  }

  /** Beads that stream along a curve. By default they live in the body group (model space). */
  private stream(curve: THREE.Curve<THREE.Vector3>, n: number, ms: number, o: { color: number; to?: number; r?: number; stagger?: number; ease?: Ease; parent?: THREE.Object3D }) {
    const parent = o.parent ?? this.body
    const a = new THREE.Color(o.color)
    const bcol = new THREE.Color(o.to ?? o.color)
    const jobs: Promise<void>[] = []
    for (let i = 0; i < n; i++) {
      const m = this.ball(o.color, o.r ?? 0.0065, curve.getPoint(0), parent)
      m.visible = false
      const mm = m.material as THREE.MeshStandardMaterial
      jobs.push(
        (async () => {
          await this.wait(i * (o.stagger ?? ms / n / 2))
          m.visible = true
          await this.animate(ms, (k) => {
            m.position.copy(curve.getPoint(k))
            mm.color.copy(a).lerp(bcol, k)
            mm.emissive.copy(a).lerp(bcol, k)
          }, o.ease ?? ((t) => t))
          m.visible = false
        })(),
      )
    }
    return Promise.all(jobs).then(() => undefined)
  }

  private setEmissive(m: THREE.Mesh, hex: number, k: number) {
    const mm = m.material as THREE.MeshStandardMaterial
    if (!mm.emissive) return
    mm.emissive.setHex(hex)
    mm.emissiveIntensity = k
  }

  /* ---------------- reveal animations ---------------- */
  async playReveal(cpId: string, labels: string[], minMs = 5000): Promise<void> {
    const i = this.lesson.checkpoints.findIndex((c) => c.id === cpId)
    if (i < 0 || this.busy) return
    this.busy = true
    const halo = this.halos[i]
    const back = this.viewFor(i)
    const o = this.overviewView()
    void this.flyTo(o.pos, o.target, 1000)
    const detail = this.lesson.checkpoints[i].detail
    const ins = detail ? this.insets[detail] : undefined
    let started = performance.now()
    try {
      if (ins) {
        ins.boostTarget = 1.7
        await this.wait(750)
        started = performance.now()
      }
      if (halo) void this.animate(700, (k) => ((halo.material as THREE.MeshBasicMaterial).color.setHex(0x66ffaa), ((halo.material as THREE.MeshBasicMaterial).opacity = 0.35 * k)))
      const names = labels.filter(Boolean)
      switch (cpId) {
        case 'nasal_cavity': await this.animNose(names); break
        case 'pharynx': await this.animPharynx(names); break
        case 'larynx_trachea': await this.animLarynx(names); break
        case 'bronchi': await this.animBronchi(names); break
        case 'lungs': await this.animLungs(names); break
        case 'alveoli': await this.animAlveoli(names); break
        case 'diaphragm': await this.animBreathing(names); break
        case 'cells': await this.animCell(names); break
        case 'anaerobic': await this.animAnaerobic(names); break
      }
      const left = minMs - (performance.now() - started)
      if (left > 0) await this.wait(left)
    } finally {
      this.clearTemps()
      if (ins) ins.boostTarget = 1
      this.busy = false
    }
    await this.flyTo(back.pos, back.target, 900)
  }

  private inset(key: string): Inset | undefined {
    return this.insets[key]
  }
  private home(key: string, fallback = V(0.9, 1.2, 0.3)) {
    return this.insets[key]?.home ?? fallback
  }

  private async animNose(names: string[]) {
    const parts = this.inset('nasal')?.group.userData.parts as Parts | undefined
    const home = this.home('nasal')
    this.labelStack(names, V(home.x + 1.03, home.y + 0.3, home.z + 0.1))
    this.swayUntil = performance.now() + 6500
    sound.whoosh(1.4)
    // Cold air in, warm air out.
    const airJob = this.stream(this.airCurve, 14, 2400, { color: 0x7fc2ff, to: 0xff9a4a, r: 0.0075, stagger: 170, ease: easeInOut })
    // Dust is stopped by the hairs, then trapped in the mucus and swept along by the cilia.
    if (parts) {
      const wall: THREE.Object3D = parts.mucusTop
      for (let n = 0; n < 12; n++) {
        const start = wall.localToWorld(V(-0.34 - Math.random() * 0.06, 0.07 + Math.random() * 0.1, (Math.random() - 0.5) * 0.12))
        const stick = wall.localToWorld(V(-0.18 + Math.random() * 0.45, 0.003, (Math.random() - 0.5) * 0.12))
        const hairStop = wall.localToWorld(V(-0.26 + Math.random() * 0.1, 0.07 + Math.random() * 0.05, (Math.random() - 0.5) * 0.1))
        const d = this.ball(0x7a5a35, 0.008 + Math.random() * 0.004, start)
        void (async () => {
          await this.wait(n * 260)
          if (n % 3 === 0) await this.animate(500, (k) => d.position.lerpVectors(start, hairStop, k), easeOut)
          const from = d.position.clone()
          await this.animate(700, (k) => d.position.lerpVectors(from, stick, k), easeOut)
          const from2 = d.position.clone()
          const away = from2.clone().add(wall.localToWorld(V(0.4, 0, 0)).sub(wall.localToWorld(V(0, 0, 0))).multiplyScalar(0.5))
          await this.animate(1600, (k) => d.position.lerpVectors(from2, away, k))
        })()
      }
    }
    await airJob
    await this.wait(900)
  }

  private async animPharynx(names: string[]) {
    const P = this.body_
    const at = this.bodyToWorld(V(0, 0.71, 0.0))
    this.labelStack(names, V(at.x + 0.79, at.y + 0.1, at.z + 0.1))
    sound.whoosh(1)
    const path = new THREE.CatmullRomCurve3([V(0, 0.805, 0.055), V(0, 0.76, 0.013), V(0, 0.69, 0.011), V(0, 0.64, 0.025)])
    await this.stream(path, 8, 1500, { color: 0x7fc2ff, to: 0xff9a4a, stagger: 120 })
    // Swallowing: the epiglottis folds over the larynx and the food goes behind it.
    this.label('Epiglottis closes', V(at.x - 0.55, at.y + 0.02, at.z + 0.1), 0.7)
    const food = this.ball(0xd69a52, 0.012, V(0, 0.78, 0.065), this.body, 0xd69a52)
    const route = new THREE.CatmullRomCurve3([V(0, 0.78, 0.055), V(0, 0.73, 0.005), V(0, 0.67, -0.008), V(0, 0.58, -0.012), V(0, 0.47, -0.012)])
    sound.plop()
    const epi = P.epiglottis as THREE.Group
    const from = epi.rotation.x
    await this.animate(500, (k) => (epi.rotation.x = from + (-0.05 - from) * k))
    await this.animate(1700, (k) => food.position.copy(route.getPoint(k)), easeInOut)
    await this.animate(500, (k) => (epi.rotation.x = -0.05 + (from + 0.05) * k))
  }

  private async animLarynx(names: string[]) {
    const P = this.body_
    const home = this.home('lungs')
    this.labelStack(names, V(home.x - 1.07, home.y + 0.3, home.z + 0.1))
    this.vibrateUntil = performance.now() + 4200
    sound.whoosh(1.2)
    // Air runs down the trachea of the body and of the close-up.
    const down = new THREE.CatmullRomCurve3([V(0, 0.69, 0.011), V(0, 0.635, 0.025), V(0, 0.57, 0.025), V(0, 0.515, 0.025)])
    void this.stream(down, 12, 1800, { color: 0x7fc2ff, stagger: 140 })
    const lungs = (this.inset('lungs')?.group.userData.parts as Parts | undefined)?.model as THREE.Object3D | undefined
    if (lungs) void this.stream(new THREE.CatmullRomCurve3(LUNG_TRACHEA.map(([x, y, z]) => V(x, y, z))), 10, 1800, { color: 0x7fc2ff, r: 0.006, stagger: 160, parent: lungs })
    // Sound waves leave the voice box.
    const at = this.bodyToWorld(V(0, 0.66, 0.06))
    for (let n = 0; n < 3; n++) {
      const ring = this.temp(new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.003, 6, 32), new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.8 })))
      ring.position.copy(at)
      void (async () => {
        await this.wait(n * 500)
        await this.animate(1400, (k) => {
          ring.scale.setScalar(1 + k * 3.2)
          ;(ring.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k)
        })
      })()
    }
    this.label('Sound', V(at.x + 0.5, at.y + 0.05, at.z + 0.1), 0.8)
    // The cartilage rings of the real trachea light up one after another.
    const rings = (P.rings ?? []) as THREE.Mesh[]
    await this.animate(1800, (k) => rings.forEach((r, i) => this.setEmissive(r, 0x66ccff, Math.max(0, 1 - Math.abs(k * (rings.length + 4) - 2 - i) / 2.5))))
    rings.forEach((r) => this.setEmissive(r, 0x000000, 0))
    await this.wait(1500)
  }

  private async animBronchi(names: string[]) {
    const P = this.body_
    const at = this.bodyToWorld(V(0, 0.5, 0.03))
    this.labelStack(names, V(at.x + 0.91, at.y + 0.3, at.z + 0.1))
    sound.whoosh(1.4)
    // Body: air splits at the carina, runs down both main bronchi and into every lobe.
    const jobs = this.lobes.map((l, n) => this.stream(new THREE.CatmullRomCurve3(l.path, false, 'catmullrom', 0.2), 4, 2600, { color: 0x7fc2ff, r: 0.006, stagger: 280 + n * 40, ease: easeInOut }))
    // Close-up: the same four branches inside the detailed lungs.
    const lungs = (this.inset('lungs')?.group.userData.parts as Parts | undefined)?.model as THREE.Object3D | undefined
    if (lungs) {
      for (const [n, l] of LUNG_LOBES.entries()) {
        const side = Math.sign(l.x)
        const pts = [V(...LUNG_TRACHEA[2]), V(side * 0.03, 0.15, 0), V(side * 0.05, (0.15 + l.y) / 2, 0), V(l.x, l.y, 0)]
        jobs.push(this.stream(new THREE.CatmullRomCurve3(pts), 4, 2600, { color: 0x7fc2ff, r: 0.005, stagger: 300 + n * 40, ease: easeInOut, parent: lungs }))
      }
    }
    // The real bronchi glow while the air passes.
    const bronchi = (P.bronchi ?? []) as THREE.Mesh[]
    void this.animate(3200, (k) => bronchi.forEach((m) => this.setEmissive(m, 0x66ccff, 0.9 * Math.sin(Math.min(1, k * 1.2) * Math.PI))))
    await Promise.all(jobs)
    bronchi.forEach((m) => this.setEmissive(m, 0x000000, 0))
  }

  private async animLungs(names: string[]) {
    const at = this.bodyToWorld(V(0, 0.45, 0.03))
    this.labelStack(names, V(at.x + 0.99, at.y + 0.35, at.z + 0.1))
    // Lobe labels sit on the real lobes: 3 on the right lung, 2 on the left.
    const side = (s: 'R' | 'L') => this.lobes.filter((l) => l.side === s)
    for (const s of ['R', 'L'] as const) {
      const ls = side(s)
      if (!ls.length) continue
      const top = ls.reduce((a, l) => (l.center.y > a.center.y ? l : a))
      const w = this.bodyToWorld(top.center.clone().add(V(0, 0.07, 0.07)))
      this.label(`${s === 'R' ? 'Right' : 'Left'} lung: ${ls.length} lobes`, w, 0.6)
    }
    sound.whoosh(1.5)
    const lobes = (this.body_.lobes ?? []) as THREE.Mesh[]
    const glow = (k: number) => lobes.forEach((m) => this.setEmissive(m, 0x66ccff, k))
    for (let n = 0; n < 2; n++) {
      await this.animate(1250, (k) => {
        const b = Math.sin(k * Math.PI)
        this.setBreath(b)
        glow(0.12 * b)
      })
    }
    glow(0)
    this.setBreath(0)
  }

  /** k = 0 at rest, 1 when breathed in fully. */
  private setBreath(k: number) {
    const P = this.body_
    const pv = P.pivot as THREE.Group | undefined
    pv?.scale.set(1 + 0.07 * k, 1 + 0.1 * k, 1 + 0.07 * k)
    const lungs = this.insets.lungs
    lungs?.holder.scale.set(1 + 0.06 * k, 1 + 0.08 * k, 1 + 0.06 * k)
    const d = P.diaphragm as THREE.Mesh
    const b = d.userData.base as THREE.Vector3
    d.scale.set(b.x, b.y * (1 - 0.7 * k), b.z)
    d.position.y = 0.285 - 0.02 * k
    const ribs = P.ribs as THREE.Group
    ribs.scale.set(1 + 0.05 * k, 1, 1 + 0.05 * k)
    ribs.position.y = 0.012 * k
  }

  private async animBreathing(names: string[]) {
    const at = this.bodyToWorld(V(0, 0.4, 0.0))
    this.labelStack(names, V(at.x + 1.04, at.y + 0.5, at.z + 0.1))
    const inL = this.label('INHALE: diaphragm contracts and flattens, ribs lift', V(at.x - 0.85, at.y + 0.7, at.z + 0.1), 0.9, '#d9f7e3')
    const outL = this.label('EXHALE: diaphragm relaxes, ribs drop', V(at.x - 0.85, at.y + 0.7, at.z + 0.1), 0.9, '#ffe3d6')
    ;(outL.material as THREE.SpriteMaterial).opacity = 0
    const vol = this.label('Volume up, pressure down', V(at.x + 0.85, at.y - 0.55, at.z + 0.1), 0.7, '#d9f7e3')
    const noseIn = new THREE.CatmullRomCurve3(AIR.map(([x, y, z]) => V(x, y, z)))
    for (let n = 0; n < 2; n++) {
      sound.whoosh(1.1)
      void this.stream(noseIn, 8, 1200, { color: 0x7fc2ff, stagger: 90 })
      ;(inL.material as THREE.SpriteMaterial).opacity = 1
      ;(outL.material as THREE.SpriteMaterial).opacity = 0
      await this.animate(1300, (k) => this.setBreath(k), easeInOut)
      ;(inL.material as THREE.SpriteMaterial).opacity = 0
      ;(outL.material as THREE.SpriteMaterial).opacity = 1
      const out = new THREE.CatmullRomCurve3([...AIR].reverse().map(([x, y, z]) => V(x, y, z)))
      void this.stream(out, 8, 1200, { color: 0xffa070, stagger: 90 })
      ;(vol.material as THREE.SpriteMaterial).opacity = 0.6
      await this.animate(1500, (k) => this.setBreath(1 - k), easeInOut)
    }
    this.setBreath(0)
  }

  /** The star of the show: oxygen crosses into the blood, carbon dioxide crosses out. */
  private async animAlveoli(names: string[]) {
    const ins = this.inset('alveolus')
    const parts = ins?.group.userData.parts as Parts | undefined
    const home = this.home('alveolus')
    this.labelStack(names, V(home.x + 1.07, home.y + 0.3, home.z + 0.12))
    if (!parts) return
    const sac: THREE.Object3D = parts.sacCenter
    const curve = parts.capPath as THREE.CatmullRomCurve3
    const capW = (t: number) => sac.localToWorld(curve.getPoint(t))
    const inside = (a: number, e: number, r = 0.55) => sac.localToWorld(V(Math.sin(e) * Math.cos(a) * r, Math.cos(e) * r * 0.9, Math.sin(e) * Math.sin(a) * r))
    const ringR = 1 // local radius of the sac wall is 1 (the model is scaled as a whole)
    this.label('Alveolus (air sac)', sac.localToWorld(V(-1.55, 1.05, 0)), 0.62)
    this.label('Capillary (blood)', sac.localToWorld(V(1.7, -0.3, 0)), 0.62, '#ffd6d6')
    this.label('O₂ in', sac.localToWorld(V(-1.55, 0.1, 0)), 0.7, '#ffd6d6')
    this.label('CO₂ out', sac.localToWorld(V(1.5, 1.05, 0)), 0.7, '#e3e6ea')
    sound.fizz(1.6)
    // Red blood cells move along the capillary; blue (low oxygen) gets redder as it passes.
    const rbcs = (parts.rbc as THREE.Mesh[]).map((m) => m)
    void this.animate(7000, (k) => rbcs.forEach((m, i) => {
      const t = (k * 0.9 + i / rbcs.length) % 1
      m.position.copy(curve.getPoint(t))
      const mm = m.material as THREE.MeshStandardMaterial
      mm.color.setHex(0x8f2a3c).lerp(new THREE.Color(0xff2d3b), Math.min(1, t * 1.6))
    }))
    // Oxygen: air -> through the wall -> into red blood cells.
    for (let n = 0; n < 10; n++) {
      const a = (n / 10) * Math.PI * 2
      const from = inside(a, 1.2 + (n % 3) * 0.3)
      const wallPt = capW(0.1 + (n / 10) * 0.8)
      const o2 = this.molecule('o2', from, 0.018)
      void (async () => {
        await this.wait(n * 330)
        const mid = sac.localToWorld(V(Math.cos(a) * ringR * 0.9, Math.sin(a * 2) * 0.5, Math.sin(a) * ringR * 0.9))
        await this.animate(900, (k) => o2.position.lerpVectors(from, mid, k), easeInOut)
        await this.animate(800, (k) => o2.position.lerpVectors(mid, wallPt, k), easeInOut)
        const t0 = 0.1 + (n / 10) * 0.8
        await this.animate(2200, (k) => o2.position.copy(capW(Math.min(1, t0 + k * 0.35))))
        o2.visible = false
      })()
    }
    // Carbon dioxide: out of the blood, through the wall, into the air and away up the bronchiole.
    for (let n = 0; n < 7; n++) {
      const t0 = 0.05 + (n / 7) * 0.8
      const co2 = this.molecule('co2', capW(t0), 0.016)
      void (async () => {
        await this.wait(400 + n * 420)
        const a = n * 0.9
        const into = inside(a, 1.5, 0.45)
        await this.animate(1000, (k) => co2.position.lerpVectors(capW(t0), into, k), easeInOut)
        const exit = sac.localToWorld(V(0, 2.4, 0))
        await this.animate(2000, (k) => co2.position.lerpVectors(into, exit, k), easeInOut)
        co2.visible = false
      })()
    }
    await this.wait(5600)
  }

  private async animCell(names: string[]) {
    const parts = this.inset('cell')?.group.userData.parts as Parts | undefined
    const home = this.home('cell')
    if (!parts) return
    const mito = parts.mito as THREE.Object3D[]
    const c: THREE.Object3D = parts.cellCenter
    this.labelStack(names, V(home.x + 1.05, home.y + 0.3, home.z + 0.1))
    this.label('Glucose + O₂ in', c.localToWorld(V(-1.3, 0.85, 0)), 0.6)
    this.label('Mitochondrion: energy (ATP)', c.localToWorld(V(0.1, -1.05, 0.3)), 0.62, '#fff0b8')
    this.label('CO₂ + H₂O out', c.localToWorld(V(1.35, 0.85, 0)), 0.6, '#e3e6ea')
    sound.fizz(1.4)
    const target = (i: number) => mito[i % mito.length].getWorldPosition(V())
    for (let n = 0; n < 6; n++) {
      const gl = this.ball(0xffd23f, 0.014, c.localToWorld(V(-1.45, 0.3 + (n % 3) * 0.25, 0)))
      const o2 = this.molecule('o2', c.localToWorld(V(-1.45, -0.1 - (n % 3) * 0.2, 0.1)), 0.009)
      const to = target(n)
      void (async () => {
        await this.wait(n * 450)
        const glFrom = gl.position.clone()
        const oFrom = o2.position.clone()
        await this.animate(1700, (k) => {
          gl.position.lerpVectors(glFrom, to, k)
          o2.position.lerpVectors(oFrom, to, k)
        }, easeInOut)
        gl.visible = false
        o2.visible = false
        // Products leave: ATP glows out of the mitochondrion, CO2 and water drift away.
        const atp = this.ball(0xffe14a, 0.013, to.clone(), this.scene, 0xffe14a)
        const co2 = this.molecule('co2', to.clone(), 0.009)
        const h2o = this.ball(0x66ccff, 0.009, to.clone())
        const atpEnd = to.clone().add(V(0.05 * (n % 2 ? 1 : -1), -0.18, 0.12))
        const co2End = c.localToWorld(V(1.5, 0.3 + (n % 3) * 0.25, 0))
        const h2oEnd = c.localToWorld(V(1.5, -0.1 - (n % 3) * 0.2, 0.1))
        sound.spark()
        this.burst(to.clone(), 6, { color: 0xffe14a, size: 0.004, speed: 0.12, life: 0.7 })
        await this.animate(1700, (k) => {
          atp.position.lerpVectors(to, atpEnd, k)
          co2.position.lerpVectors(to, co2End, k)
          h2o.position.lerpVectors(to, h2oEnd, k)
        }, easeInOut)
      })()
    }
    for (const m of mito) void this.animate(5200, (k) => m.scale.setScalar(1 + 0.08 * Math.sin(k * 30)))
    await this.wait(5600)
    for (const m of mito) m.scale.setScalar(1)
  }

  private async animAnaerobic(names: string[]) {
    const parts = this.inset('anaerobic')?.group.userData.parts as Parts | undefined
    const home = this.home('anaerobic')
    if (!parts) return
    const muscle: THREE.Object3D = parts.muscleCenter
    const yeast: THREE.Object3D = parts.yeastCenter
    this.labelStack(names, V(home.x, home.y - 0.62, home.z + 0.1), 0.058 * LABEL_K, 0.6)
    this.label('Muscles: not enough air', muscle.localToWorld(V(0, 1.5, 0.2)), 0.62, '#ffe3d6')
    this.label('Yeast: no air at all', yeast.localToWorld(V(0, 1.5, 0.2)), 0.62, '#fff0b8')
    this.label('Lactic acid builds up: muscles ache', muscle.localToWorld(V(0, -1.55, 0.2)), 0.7, '#e6f7a8')
    this.label('Ethanol + CO₂ (bubbles)', yeast.localToWorld(V(0, -1.55, 0.2)), 0.7, '#fff0b8')
    this.label('Energy: only 2 ATP (aerobic: about 30)', home.clone().add(V(0, -0.42, 0.1)), 0.78, '#ffd6d6')
    sound.fizz(1.6)
    // Lactic acid blobs gather around the muscle fibres.
    for (let n = 0; n < 14; n++) {
      const b = this.ball(0xd8ff4a, 0.011, muscle.localToWorld(V((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 0.7, 0.1)))
      b.scale.setScalar(0.01)
      void (async () => {
        await this.wait(n * 280)
        await this.animate(500, (k) => b.scale.setScalar(Math.max(0.01, k)))
      })()
    }
    // Yeast: CO2 bubbles rise, ethanol droplets leave.
    const yeasts = parts.yeasts as THREE.Object3D[]
    for (let n = 0; n < 16; n++) {
      const y = yeasts[n % yeasts.length]
      const from = y.getWorldPosition(V()).add(V(0, 0.02, 0.05))
      const bubble = n % 3 === 0 ? this.ball(0xc8d0d8, 0.011, from) : this.ball(0xe0a43a, 0.008, from)
      const up = from.clone().add(V((Math.random() - 0.5) * 0.12, 0.3 + Math.random() * 0.1, 0.02))
      void (async () => {
        await this.wait(n * 260)
        await this.animate(1700, (k) => {
          bubble.position.lerpVectors(from, up, k)
          ;(bubble.material as THREE.MeshStandardMaterial).opacity = 1 - k * 0.6
        }, easeOut)
      })()
    }
    await this.wait(5600)
  }

  /* ---------------- the final check: one oxygen molecule's whole trip ---------------- */
  async enterFinal(): Promise<void> {
    const id = ++this.finalLoop
    this.currentIndex = 0
    this.activeHalo = 0
    this.refreshInsetFor(-1)
    sound.whoosh(1.4)
    await this.flyTo(V(0.2, 2.15, 2.9), V(0.05, 2.1, 0), 1800)
    const lobe = this.lobes.find((l) => l.side === 'R' && /inferior/i.test(l.name)) ?? this.lobes[0]
    const pts = lobe ? lobe.path : [CARINA.clone(), V(-0.05, 0.4, 0.03)]
    const route = new THREE.CatmullRomCurve3([...AIR.map(([x, y, z]) => V(x, y, z)), ...pts.slice(1)], false, 'catmullrom', 0.3)
    const tip = pts[pts.length - 1]
    const toCell = new THREE.CatmullRomCurve3([tip, this.heartAt.clone(), this.heartAt.clone().add(V(0.1, -0.12, 0.02)), V(0.12, 0.15, 0.06)])
    while (id === this.finalLoop && !this.disposed) {
      const o2 = this.molecule('o2', this.bodyToWorld(route.getPoint(0)), 0.02)
      o2.parent?.remove(o2)
      this.body.add(o2)
      o2.scale.setScalar(1 / S)
      const tag = this.label('Oxygen', V(0, 0, 0), 0.8)
      await this.animate(12000, (k) => {
        const p = k < 0.72 ? route.getPoint(k / 0.72) : toCell.getPoint((k - 0.72) / 0.28)
        o2.position.copy(p)
        tag.position.copy(this.bodyToWorld(p)).add(V(0.2, 0.08, 0.05))
        o2.rotation.z += 0.04
        o2.children.forEach((c) => ((c as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5 + 0.3 * Math.sin(k * 40))
      })
      this.clearTemps()
      await this.wait(700)
    }
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
    const now = performance.now()
    for (const tw of [...this.tweens]) if (!tw(dt)) this.tweens.delete(tw)
    this.applyInsets(dt)
    this.controls.update()

    this.halos.forEach((h, i) => {
      const m = h.material as THREE.MeshBasicMaterial
      const target = i === this.activeHalo ? 0.22 + Math.sin(time * 3) * 0.07 : 0
      m.opacity += (target - m.opacity) * Math.min(1, dt * 6)
      if (i !== this.activeHalo && m.opacity < 0.01) m.color.setHex(0x66ccff)
    })

    // Cilia sway while the nose is being shown; vocal cords vibrate while sound is made.
    const sway = now < this.swayUntil
    const nasal = this.insets.nasal?.group.userData.parts as Parts | undefined
    if (nasal) (nasal.cilia as THREE.Mesh[]).forEach((c, i) => (c.rotation.z = sway ? Math.sin(time * 7 + i * 0.6) * 0.45 : Math.sin(time * 1.2 + i) * 0.06))
    const vib = now < this.vibrateUntil
    const wob = vib ? Math.sin(time * 60) * 0.18 : 0
    ;(this.body_.cords as THREE.Group[] | undefined)?.forEach((c) => (c.rotation.y = c.userData.rest + wob * 0.3))

    for (const ins of Object.values(this.insets)) {
      ins.shown += (ins.target - ins.shown) * Math.min(1, dt * 4)
      ins.group.visible = ins.shown > 0.01
      ins.boost += (ins.boostTarget - ins.boost) * Math.min(1, dt * 5)
      ins.group.scale.setScalar(Math.max(0.001, ins.shown) * ins.boost)
      ins.group.rotation.y = Math.sin(time * 0.6) * 0.35
      ins.group.position.y = ins.home.y + Math.sin(time * 1.4) * 0.01
      ins.light.intensity = ins.shown * 1.8
      ;(ins.line.material as THREE.LineDashedMaterial).opacity = ins.shown * 0.5
      const here = this.lesson.checkpoints[this.currentIndex]
      const idx = here?.detail === ins.key ? this.currentIndex : this.lesson.checkpoints.findIndex((c) => c.detail === ins.key)
      if (idx >= 0 && this.anchors[idx]) {
        ins.line.geometry.setFromPoints([this.anchors[idx], ins.group.position.clone()])
        ins.line.computeLineDistances()
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.life += dt
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

    if (this.dust) {
      const a = (this.dust.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array
      for (let i = 0; i < a.length; i += 3) {
        a[i + 1] += Math.sin(time * 0.4 + i) * 0.0001
        a[i] += Math.cos(time * 0.3 + i) * 0.00008
      }
      this.dust.geometry.attributes.position.needsUpdate = true
    }
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.disposed = true
    this.finalLoop++
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

/* ================= models made from shapes (local units; they are scaled to fit when added) ================= */

/** The lining of the nasal cavity: wall, mucus, cilia, nasal hairs at the entrance, and a capillary below. */
function buildNasalLining(): THREE.Group {
  const root = new THREE.Group()
  const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 0.06, 0.34), mat(0xd9788c, { roughness: 0.7 }))
  wall.position.y = -0.11
  root.add(wall)
  const mucus = new THREE.Mesh(new THREE.BoxGeometry(1, 0.045, 0.34), glass(0xd9e86a, 0.5, { roughness: 0.2, clearcoat: 1 }))
  mucus.position.y = -0.045
  root.add(mucus)
  const mucusTop = new THREE.Object3D()
  mucusTop.position.set(0, -0.02, 0)
  root.add(mucusTop)
  const cilia: THREE.Mesh[] = []
  const cg = new THREE.CylinderGeometry(0.004, 0.006, 0.09, 6)
  cg.translate(0, 0.045, 0)
  for (let i = 0; i < 110; i++) {
    const c = new THREE.Mesh(cg, mat(0xffc2cf, { roughness: 0.5 }))
    c.position.set(-0.46 + (i % 22) * 0.042 + (Math.random() - 0.5) * 0.01, -0.08, -0.14 + Math.floor(i / 22) * 0.07)
    root.add(c)
    cilia.push(c)
  }
  const hg = new THREE.CylinderGeometry(0.003, 0.005, 0.2, 5)
  hg.translate(0, 0.1, 0)
  for (let i = 0; i < 16; i++) {
    const h = new THREE.Mesh(hg, mat(0x3b2a24, { roughness: 0.8 }))
    h.position.set(-0.47 + (i % 8) * 0.035, -0.022, -0.14 + Math.floor(i / 8) * 0.28 + (Math.random() - 0.5) * 0.04)
    h.rotation.z = (Math.random() - 0.5) * 0.5
    root.add(h)
  }
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 16), mat(0xd01f2f, { emissive: 0x500810, roughness: 0.35 }))
  cap.rotation.z = Math.PI / 2
  cap.position.y = -0.2
  root.add(cap)
  root.userData.parts = { cilia, mucusTop }
  return root
}

/** One alveolus wrapped in a capillary, among a few neighbours, at the end of a bronchiole. */
function buildAlveolus(): THREE.Group {
  const root = new THREE.Group()
  const sacCenter = new THREE.Object3D()
  root.add(sacCenter)
  const sac = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 30), glass(0xbfe3ff, 0.16, { roughness: 0.15 }))
  sacCenter.add(sac)
  const rim = new THREE.Mesh(new THREE.SphereGeometry(1.003, 28, 20), new THREE.MeshBasicMaterial({ color: 0x9bd4ff, wireframe: true, transparent: true, opacity: 0.1 }))
  sacCenter.add(rim)
  // Neighbours.
  for (let i = 0; i < 4; i++) {
    const a = Math.PI * (0.25 + i * 0.5)
    const n = new THREE.Mesh(new THREE.SphereGeometry(0.62, 24, 18), glass(0xffb7c5, 0.16))
    n.position.set(Math.cos(a) * 1.35, Math.sin(a) * 0.5 - 0.35, Math.sin(a) * 0.45 - 0.3)
    root.add(n)
  }
  // The bronchiole feeding it, from the top.
  const bronchiole = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 1.5, 20, 1, true), glass(0xe9d3ff, 0.3))
  bronchiole.position.y = 1.7
  sacCenter.add(bronchiole)
  // Capillary: a tube winding round the sac, blue (low oxygen) at the start and red (oxygenated) at the end.
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= 40; i++) {
    const t = i / 40
    const phi = t * Math.PI * 5
    const th = Math.PI * (0.18 + 0.64 * t)
    const r = 1.1
    pts.push(V(r * Math.sin(th) * Math.cos(phi), r * Math.cos(th), r * Math.sin(th) * Math.sin(phi)))
  }
  const capPath = new THREE.CatmullRomCurve3(pts)
  const capGeo = new THREE.TubeGeometry(capPath, 160, 0.09, 12, false)
  const colors: number[] = []
  const uv = capGeo.attributes.uv as THREE.BufferAttribute
  const c0 = new THREE.Color(0x3b5bdb)
  const c1 = new THREE.Color(0xe03131)
  const cc = new THREE.Color()
  for (let i = 0; i < uv.count; i++) {
    cc.copy(c0).lerp(c1, uv.getX(i))
    colors.push(cc.r, cc.g, cc.b)
  }
  capGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  const cap = new THREE.Mesh(capGeo, new THREE.MeshPhysicalMaterial({ vertexColors: true, transparent: true, opacity: 0.55, roughness: 0.3, depthWrite: false }))
  sacCenter.add(cap)
  const rbc: THREE.Mesh[] = []
  const rg = new THREE.CylinderGeometry(0.07, 0.07, 0.025, 16)
  rg.rotateX(Math.PI / 2)
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(rg, mat(0x8f2a3c, { emissive: 0x300008, roughness: 0.35 }))
    m.position.copy(capPath.getPoint(i / 8))
    sacCenter.add(m)
    rbc.push(m)
  }
  root.userData.parts = { sacCenter, capPath, rbc }
  return root
}

/** A body cell with a nucleus and three mitochondria. */
function buildCell(): THREE.Group {
  const root = new THREE.Group()
  const cellCenter = new THREE.Object3D()
  root.add(cellCenter)
  const cell = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 26), glass(0xffc2cf, 0.22, { roughness: 0.25 }))
  cell.scale.set(1.25, 1, 0.9)
  cellCenter.add(cell)
  const nucleus = new THREE.Mesh(new THREE.SphereGeometry(0.36, 24, 18), mat(0x8a6ad8, { transparent: true, opacity: 0.8 }))
  nucleus.position.set(-0.4, 0.35, -0.15)
  cellCenter.add(nucleus)
  const mito: THREE.Object3D[] = []
  const spots: [number, number, number, number][] = [[0.35, 0.05, 0.1, 0.4], [-0.1, -0.45, 0.15, -0.5], [0.55, -0.4, 0.05, 0.9]]
  for (const [x, y, z, rot] of spots) {
    const g = new THREE.Group()
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), glass(0xff9a4a, 0.55, { roughness: 0.3 }))
    body.scale.set(1.6, 0.8, 0.8)
    g.add(body)
    for (let i = 0; i < 4; i++) {
      const fold = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.02, 6, 16), mat(0xd9531e))
      fold.rotation.y = Math.PI / 2
      fold.position.x = -0.32 + i * 0.21
      fold.scale.set(1, 1, 0.6)
      g.add(fold)
    }
    g.position.set(x, y, z)
    g.rotation.z = rot
    cellCenter.add(g)
    mito.push(g)
  }
  root.userData.parts = { cellCenter, mito }
  return root
}

/** Left: muscle fibres that collect lactic acid. Right: yeast cells, some budding, that make alcohol and CO2. */
function buildAnaerobic(): THREE.Group {
  const root = new THREE.Group()
  const muscleCenter = new THREE.Object3D()
  muscleCenter.position.x = -0.85
  const yeastCenter = new THREE.Object3D()
  yeastCenter.position.x = 0.85
  root.add(muscleCenter, yeastCenter)
  for (let i = 0; i < 5; i++) {
    const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 1.0, 6, 14), mat(0xb5332f, { roughness: 0.55 }))
    f.rotation.z = Math.PI / 2
    f.position.set(0, (i - 2) * 0.24, (i % 2) * 0.06)
    muscleCenter.add(f)
  }
  const yeasts: THREE.Object3D[] = []
  const flask = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.3, 32, 1, true), glass(0xeedc9a, 0.2))
  yeastCenter.add(flask)
  const spots: [number, number][] = [[-0.25, -0.35], [0.2, -0.4], [-0.1, 0.0], [0.28, 0.05], [-0.28, 0.38], [0.1, 0.4]]
  spots.forEach(([x, y], i) => {
    const y1 = new THREE.Group()
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14), mat(0xe6d3a3, { roughness: 0.6 }))
    c.scale.set(1.15, 1, 1)
    y1.add(c)
    if (i % 2 === 0) {
      const bud = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), mat(0xe6d3a3, { roughness: 0.6 }))
      bud.position.set(0.17, 0.1, 0)
      y1.add(bud)
    }
    y1.position.set(x, y, 0)
    yeastCenter.add(y1)
    yeasts.push(y1)
  })
  root.userData.parts = { muscleCenter, yeastCenter, yeasts }
  return root
}
