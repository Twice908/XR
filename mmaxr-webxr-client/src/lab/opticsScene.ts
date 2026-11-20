import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { OpticsLaw, OpticsLessonContract } from '@mmaxr/schema'
import { sound } from './sound'
import { centreX, diagramFor, focalX, ruleDiagram, surfaceX, type Diagram, type Geometry, type MirrorKind, type Pt, type RuleParams, type Seg } from './opticsGeometry'

/*
 * The optics bench. Everything is in metres; the lab faces +z and the principal axis runs along x.
 *
 *  - Plane-mirror stage: the laser sends five parallel beams (a "ray comb") across the bench in the horizontal
 *    plane onto either the plane mirror (laser-pointer-ray.glb as the beam, plane-mirror.glb) or crumpled foil.
 *  - Mirror stages: a spherical mirror cap is mounted on concave-convex-mirror-stand.glb. Ray diagrams are drawn in
 *    the vertical plane z = 0 that contains the principal axis, so they read exactly like the textbook figure.
 */
const BENCH_Y = 0.9
const BENCH_W = 3.2
const BENCH_D = 1.1
const AXIS_Y = BENCH_Y + 0.24
const X_POLE = -0.85
const REACH = 2.15
const APERTURE = 0.22
const OBJ_H = 0.08
const INFINITY_X = 1.6

/** Plane-mirror stage layout (horizontal plane, x-z). */
const SURFACE_Z = -0.15
const SURFACE_X: Record<string, number> = { smooth: -0.3, rough: 0.5 }
const INCIDENT = new THREE.Vector3(Math.SQRT1_2, 0, -Math.SQRT1_2)
const BEAM_LEN_IN = 0.8
const COMB_SPACING = 0.05
const BEAM_THICK = 4.5
const BEAM_GLB_LEN = 0.8

export type Stage = 'plane' | 'laws' | 'rules' | 'concave' | 'convex'

export interface OpticsSceneEvents {
  onSurfaceClick(id: string): void
  onLaserClick(): void
  /** The candle was dropped on a lesson position (index into the cases passed to `setCases`). */
  onCandleSnap(index: number): void
}

export interface CaseSpot {
  id: string
  uOverF: number | null
}

type Ease = (t: number) => number
const easeInOut: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const easeOut: Ease = (t) => 1 - Math.pow(1 - t, 3)

const world = (p: Pt, z = 0) => new THREE.Vector3(X_POLE + p.x, AXIS_Y + p.y, z)

/** Small deterministic generator so the foil scatters the same way every time it is fired. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

interface Beam {
  root: THREE.Group
  reticle: THREE.Object3D | null
}

export class OpticsScene {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  private readonly clock = new THREE.Clock()
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2(10, 10)
  private readonly handPoint = new THREE.Vector3(0, BENCH_Y, 0.2)
  private readonly benchPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BENCH_Y)
  private readonly midPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)

  private tweens = new Set<(dt: number) => boolean>()
  private insets = { left: 0, right: 0, top: 0, bottom: 0 }
  private stage: Stage = 'plane'
  private mirror: MirrorKind = 'concave'
  private geo: Geometry
  private cases: CaseSpot[] = []
  private f: number
  private disposed = false
  private busy = false
  private viewTween: ((dt: number) => boolean) | null = null
  private downAt = { x: 0, y: 0 }
  private dragging = false
  private candleX = X_POLE + 0.8

  /* ---- scene objects ---- */
  private beamTemplate: THREE.Object3D | null = null
  private beams: Beam[] = []
  private extras: THREE.Object3D[] = []
  private standGroup = new THREE.Group()
  private mirrorHolder = new THREE.Group()
  private capMesh: THREE.Group | null = null
  private mirrorLabel: THREE.Sprite | null = null
  private planeGroup = new THREE.Group()
  private surfaces: Record<string, THREE.Group> = {}
  private surfaceBase: Record<string, THREE.Object3D[]> = {}
  private selectedSurface = 'smooth'
  private laser = new THREE.Group()
  private laserPole!: THREE.Mesh
  private comb!: THREE.Group
  private laserGlow!: THREE.Mesh
  private candle = new THREE.Group()
  private flame!: THREE.Mesh
  private flameLight!: THREE.PointLight
  private ghost: THREE.Group | null = null
  private opticsGroup = new THREE.Group()
  private markers: THREE.Object3D[] = []
  private infinityLabel: THREE.Sprite | null = null
  private pickables: THREE.Object3D[] = []
  private hoverId = ''
  private readonly onResize = () => this.resize()

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly events: OpticsSceneEvents,
    focalLength = 0.25,
  ) {
    this.f = focalLength
    this.geo = { mirror: 'concave', f: focalLength, aperture: APERTURE, reach: REACH }
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.95
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.xr.enabled = true

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 40)
    this.camera.position.set(0, AXIS_Y + 1.3, 1.8)
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.target.set(0, AXIS_Y - 0.05, 0.1)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.enablePan = false
    this.controls.minDistance = 0.8
    this.controls.maxDistance = 5
    this.controls.minPolarAngle = Math.PI * 0.12
    this.controls.maxPolarAngle = Math.PI * 0.52
    this.controls.minAzimuthAngle = -Math.PI * 0.35
    this.controls.maxAzimuthAngle = Math.PI * 0.35
    this.controls.rotateSpeed = 0.55
    this.controls.addEventListener('start', () => {
      this.viewTween = null
    })

    this.buildEnvironment()
    this.buildLaser()
    this.buildCandle()
    this.buildSurfaces()
    this.buildMirrorUnit()
    this.scene.add(this.planeGroup, this.opticsGroup)
    this.setStage('plane', false)
    this.resize()
    window.addEventListener('resize', this.onResize)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointerleave', this.onPointerLeave)
  }

  get head(): THREE.Vector3 {
    return this.camera.position
  }
  get hand(): THREE.Vector3 {
    return this.handPoint
  }

  /* ================= environment ================= */
  private buildEnvironment() {
    const scene = this.scene
    scene.background = new THREE.Color(0x05070c)
    scene.fog = new THREE.Fog(0x05070c, 5, 11)
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.55
    scene.add(new THREE.HemisphereLight(0x8ea8ff, 0x120e0a, 0.22))

    // A darkened optics lab: one soft key from above so the beams are the brightest thing in the room.
    const key = new THREE.SpotLight(0xdfe8ff, 22, 8, Math.PI / 4.4, 0.8, 1.6)
    key.position.set(0.6, 2.9, 1.6)
    key.target.position.set(0, BENCH_Y, 0)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.bias = -0.0004
    scene.add(key, key.target)
    const rim = new THREE.PointLight(0x2f6bff, 3, 5)
    rim.position.set(-1.8, 1.8, -0.8)
    scene.add(rim)

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshStandardMaterial({ color: 0x0d1016, roughness: 0.6, metalness: 0.1 }))
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    scene.add(floor)
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(16, 6), new THREE.MeshStandardMaterial({ color: 0x0f131b, roughness: 0.9 }))
    wall.position.set(0, 3, -1.5)
    wall.receiveShadow = true
    scene.add(wall)

    const top = new THREE.Mesh(new THREE.BoxGeometry(BENCH_W, 0.05, BENCH_D), new THREE.MeshStandardMaterial({ color: 0x151921, roughness: 0.4, metalness: 0.2 }))
    top.position.set(0, BENCH_Y - 0.025, 0)
    top.receiveShadow = true
    top.castShadow = true
    scene.add(top)

    // Optical rail with a ruler: a faint metre scale along the front edge of the bench.
    const rail = new THREE.Mesh(new THREE.BoxGeometry(BENCH_W - 0.1, 0.012, 0.03), new THREE.MeshStandardMaterial({ color: 0x8993a3, metalness: 0.8, roughness: 0.35 }))
    rail.position.set(0, BENCH_Y + 0.006, 0.0)
    rail.receiveShadow = true
    scene.add(rail)
    const tickMat = new THREE.MeshBasicMaterial({ color: 0x5d6b82 })
    for (let i = -15; i <= 15; i++) {
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.0016, i % 5 === 0 ? 0.04 : 0.025), tickMat)
      tick.position.set(i * 0.1, BENCH_Y + 0.013, 0.027)
      scene.add(tick)
    }
  }

  /* ================= laser ================= */
  private buildLaser() {
    const body = new THREE.MeshStandardMaterial({ color: 0x1b2f6b, metalness: 0.85, roughness: 0.28 })
    const trim = new THREE.MeshStandardMaterial({ color: 0xaab4c6, metalness: 0.95, roughness: 0.2 })
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 28), body)
    tube.rotation.x = Math.PI / 2
    tube.position.z = -0.1
    const front = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.022, 0.035, 28), trim)
    front.rotation.x = Math.PI / 2
    front.position.z = 0.0
    const rear = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 28), trim)
    rear.rotation.x = Math.PI / 2
    rear.position.z = -0.215
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.013, 24), new THREE.MeshBasicMaterial({ color: 0x66aaff }))
    lens.position.z = 0.0185
    this.laserGlow = new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 12), new THREE.MeshBasicMaterial({ color: 0x4aa8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
    this.laserGlow.position.z = 0.03
    const button = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.01, 12), new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0x551010 }))
    button.position.set(0, 0.021, -0.12)
    // Five-slit ray comb at the front: turns the pen into a parallel-beam source.
    this.comb = new THREE.Group()
    const plate = new THREE.Mesh(new THREE.BoxGeometry(COMB_SPACING * 5 + 0.03, 0.04, 0.008), new THREE.MeshStandardMaterial({ color: 0x0a0c12, metalness: 0.6, roughness: 0.5 }))
    plate.castShadow = true
    this.comb.add(plate)
    for (let i = -2; i <= 2; i++) {
      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.026, 0.01), new THREE.MeshBasicMaterial({ color: 0x66aaff }))
      slit.position.x = i * COMB_SPACING
      this.comb.add(slit)
    }
    this.comb.position.z = 0.06
    // Stand: a pole to the bench so the laser can sit at the height of the optical axis.
    this.laserPole = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 12), trim)
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.02, 24), new THREE.MeshStandardMaterial({ color: 0x20242d, metalness: 0.7, roughness: 0.4 }))
    for (const m of [tube, front, rear, button, plate]) {
      m.castShadow = true
    }
    this.laser.add(tube, front, rear, lens, this.laserGlow, button, this.comb)
    const mount = new THREE.Group()
    mount.add(this.laser)
    mount.userData.id = 'laser'
    this.laserRoot.add(mount, this.laserPole, foot)
    this.laserFoot = foot
    this.laser.traverse((o) => (o.userData.id = 'laser'))
    this.scene.add(this.laserRoot)
  }
  private laserRoot = new THREE.Group()
  private laserFoot!: THREE.Mesh

  /** Put the laser at `origin` (its muzzle), pointing along `dir`. */
  private aimLaser(origin: THREE.Vector3, dir: THREE.Vector3, comb: boolean) {
    this.laser.position.copy(origin)
    this.laser.lookAt(origin.clone().add(dir))
    this.comb.visible = comb
    const h = Math.max(0.02, origin.y - BENCH_Y)
    const px = origin.x - dir.x * 0.1
    const pz = origin.z - dir.z * 0.1
    this.laserPole.scale.y = h
    this.laserPole.position.set(px, BENCH_Y + h / 2, pz)
    this.laserFoot.position.set(px, BENCH_Y + 0.01, pz)
  }

  private buildCandle() {
    const wax = new THREE.MeshStandardMaterial({ color: 0xf1e8d4, roughness: 0.7 })
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.055, 20), wax)
    body.position.y = 0.0275
    body.castShadow = true
    const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.008, 6), new THREE.MeshBasicMaterial({ color: 0x222222 }))
    wick.position.y = 0.059
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
    this.flame = new THREE.Mesh(new THREE.SphereGeometry(0.01, 14, 12), flameMat)
    this.flame.scale.set(0.8, 1.7, 0.8)
    this.flame.position.y = 0.0675
    this.flameLight = new THREE.PointLight(0xffa24a, 0.35, 0.8)
    this.flameLight.position.y = 0.068
    // Carriage and post that hold the candle at the height of the axis.
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, AXIS_Y - BENCH_Y, 10), new THREE.MeshStandardMaterial({ color: 0x9aa3b2, metalness: 0.85, roughness: 0.3 }))
    post.position.y = -(AXIS_Y - BENCH_Y) / 2
    const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.024, 0.07), new THREE.MeshStandardMaterial({ color: 0x242a36, metalness: 0.6, roughness: 0.4 }))
    carriage.position.y = -(AXIS_Y - BENCH_Y) + 0.012
    carriage.castShadow = true
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.016, 0.01, 20), new THREE.MeshStandardMaterial({ color: 0xb7c0cf, metalness: 0.9, roughness: 0.25 }))
    cup.position.y = -0.005
    this.candle.add(body, wick, this.flame, this.flameLight, post, carriage, cup)
    this.candle.traverse((o) => (o.userData.id = 'candle'))
    this.scene.add(this.candle)
  }

  /** The candle's visual: a clone without hit-testing or lights, used for the image. */
  private makeGhost(real: boolean): THREE.Group {
    const color = real ? 0x3ef2c4 : 0xb98bff
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: real ? 0.95 : 0.8, depthWrite: false, blending: THREE.AdditiveBlending })
    const g = new THREE.Group()
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.055, 20), mat)
    body.position.y = 0.0275
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.013, 14, 12), mat)
    flame.scale.set(0.8, 1.7, 0.8)
    flame.position.y = 0.0675
    const base = new THREE.Mesh(new THREE.RingGeometry(0.016, 0.022, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }))
    base.rotation.x = -Math.PI / 2
    g.add(body, flame, base)
    return g
  }

  /* ================= plane-mirror stage ================= */
  private buildSurfaces() {
    for (const id of ['smooth', 'rough']) {
      const g = new THREE.Group()
      g.position.set(SURFACE_X[id], BENCH_Y, SURFACE_Z)
      g.userData.id = id
      this.surfaces[id] = g
      this.planeGroup.add(g)
    }
    // Crumpled aluminium foil on a backing card: a faceted, randomly dented sheet that scatters light.
    const rand = rng(20240511)
    const W = 0.44
    const N = 26
    const geo = new THREE.PlaneGeometry(W, W, N, N)
    const pos = geo.attributes.position as THREE.BufferAttribute
    const dent = Array.from({ length: 9 }, () => ({ x: (rand() - 0.5) * W, y: (rand() - 0.5) * W, r: 0.04 + rand() * 0.07, s: (rand() - 0.5) * 0.05 }))
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      let z = (rand() - 0.5) * 0.02
      for (const d of dent) z += d.s * Math.exp(-((x - d.x) ** 2 + (y - d.y) ** 2) / (d.r * d.r))
      z += Math.sin(x * 61 + y * 17) * 0.006 + Math.sin(x * 23 - y * 71) * 0.006
      pos.setZ(i, z)
    }
    geo.computeVertexNormals()
    const foil = new THREE.Mesh(geo.toNonIndexed(), new THREE.MeshStandardMaterial({ color: 0xd7dbe0, metalness: 1, roughness: 0.42, flatShading: true, envMapIntensity: 1.2 }))
    foil.position.y = W / 2 + 0.02
    foil.castShadow = true
    foil.receiveShadow = true
    const card = new THREE.Mesh(new THREE.BoxGeometry(W + 0.04, W + 0.04, 0.012), new THREE.MeshStandardMaterial({ color: 0x1c1f27, roughness: 0.8 }))
    card.position.set(0, W / 2 + 0.02, -0.014)
    const label = this.makeLabel('Crumpled foil', '#c9d1e0', 0.22)
    label.position.set(0, -0.005, 0.11)
    foil.userData.id = 'rough'
    card.userData.id = 'rough'
    this.surfaces.rough.add(card, foil)
    this.surfaceBase.rough = [foil, card]
    this.addSurfaceFoot(this.surfaces.rough)
    this.surfaces.rough.add(label)
    const mirrorLabel = this.makeLabel('Plane mirror', '#c9d1e0', 0.22)
    mirrorLabel.position.set(0, -0.005, 0.11)
    this.surfaces.smooth.add(mirrorLabel)
    this.addSurfaceFoot(this.surfaces.smooth)
  }

  private addSurfaceFoot(g: THREE.Group) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.016, 0.12), new THREE.MeshStandardMaterial({ color: 0x242a36, metalness: 0.6, roughness: 0.4 }))
    foot.position.set(0, 0.008, 0)
    foot.castShadow = true
    foot.userData.id = g.userData.id
    g.add(foot)
  }

  /* ================= mirror unit (stand + cap) ================= */
  private buildMirrorUnit() {
    this.mirrorHolder.position.set(X_POLE, AXIS_Y, 0)
    this.opticsGroup.add(this.mirrorHolder, this.standGroup)
    this.mirrorLabel = this.makeLabel('CONCAVE', '#ffffff', 0.3)
    this.mirrorLabel.position.set(X_POLE - 0.04, BENCH_Y + 0.58, 0)
    this.opticsGroup.add(this.mirrorLabel)
    this.setCap('concave')
  }

  /** Spherical cap of radius of curvature 2f, axis along +x, reflecting face toward +x (concave) or +x bulging (convex). */
  private buildCap(kind: MirrorKind): THREE.Group {
    const g = new THREE.Group()
    const pts: THREE.Vector2[] = []
    const g2: Geometry = { ...this.geo, mirror: kind }
    for (let i = 0; i <= 40; i++) {
      const r = (APERTURE * i) / 40
      pts.push(new THREE.Vector2(r, surfaceX(g2, r)))
    }
    const lathe = new THREE.LatheGeometry(pts, 72)
    lathe.rotateZ(-Math.PI / 2) // lathe axis y -> world +x
    const glass = new THREE.MeshStandardMaterial({ color: 0xe9eef5, metalness: 1, roughness: 0.035, envMapIntensity: 1.9, side: THREE.DoubleSide })
    const face = new THREE.Mesh(lathe, glass)
    face.castShadow = true
    const rim = new THREE.Mesh(new THREE.TorusGeometry(APERTURE + 0.004, 0.006, 12, 72), new THREE.MeshStandardMaterial({ color: 0x2b3342, metalness: 0.8, roughness: 0.35 }))
    rim.rotation.y = Math.PI / 2
    rim.position.x = surfaceX(g2, APERTURE)
    g.add(face, rim)
    return g
  }

  private setCap(kind: MirrorKind) {
    if (this.capMesh) {
      this.mirrorHolder.remove(this.capMesh)
      this.capMesh.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.geometry) m.geometry.dispose()
      })
    }
    this.capMesh = this.buildCap(kind)
    this.capMesh.traverse((o) => (o.userData.id = 'mirror'))
    this.mirrorHolder.add(this.capMesh)
    this.mirror = kind
    this.geo = { ...this.geo, mirror: kind }
    if (this.mirrorLabel) this.redrawLabel(this.mirrorLabel, kind === 'concave' ? 'CONCAVE' : 'CONVEX', '#ffffff')
  }

  /* ================= labels ================= */
  private makeLabel(text: string, color: string, width: number): THREE.Sprite {
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 128
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false, depthWrite: false }))
    sprite.scale.set(width * 2, width * 0.5, 1)
    sprite.renderOrder = 20
    this.redrawLabel(sprite, text, color)
    return sprite
  }
  private redrawLabel(sprite: THREE.Sprite, text: string, color: string) {
    const mat = sprite.material as THREE.SpriteMaterial
    const tex = mat.map as THREE.CanvasTexture
    const c = tex.image as HTMLCanvasElement
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.font = '600 58px Inter, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = 'rgba(8,10,16,0.55)'
    const w = ctx.measureText(text).width + 40
    ctx.beginPath()
    ctx.roundRect((c.width - w) / 2, 24, w, 80, 22)
    ctx.fill()
    ctx.fillStyle = color
    ctx.fillText(text, c.width / 2, 66)
    tex.needsUpdate = true
  }

  /** P, F and C pegs on the axis. Behind a convex mirror they are drawn hollow: no light really goes there. */
  private rebuildMarkers() {
    for (const m of this.markers) {
      this.opticsGroup.remove(m)
      m.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.geometry && !(mesh as unknown as THREE.Sprite).isSprite) mesh.geometry.dispose()
      })
    }
    this.markers = []
    const g = this.geo
    const spots: { label: string; x: number; color: number }[] = [
      { label: 'P', x: 0, color: 0xffffff },
      { label: 'F', x: focalX(g), color: 0xffcf4a },
      { label: 'C', x: centreX(g), color: 0xff6b8a },
    ]
    const axis = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([world({ x: -0.6, y: 0 }), world({ x: REACH, y: 0 })]),
      new THREE.LineDashedMaterial({ color: 0x6f7c96, dashSize: 0.03, gapSize: 0.022, transparent: true, opacity: 0.8 }),
    )
    axis.computeLineDistances()
    this.markers.push(axis)
    for (const s of spots) {
      const behind = s.x < -1e-6
      const grp = new THREE.Group()
      const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, AXIS_Y - BENCH_Y, 8), new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: behind ? 0.4 : 0.8 }))
      peg.position.y = -(AXIS_Y - BENCH_Y) / 2
      const ball = new THREE.Mesh(
        behind ? new THREE.TorusGeometry(0.014, 0.0035, 8, 24) : new THREE.SphereGeometry(0.013, 16, 12),
        new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: behind ? 0.9 : 1 }),
      )
      const lab = this.makeLabel(behind && s.label !== 'P' ? `${s.label} (virtual)` : s.label, '#ffffff', behind && s.label !== 'P' ? 0.2 : 0.1)
      lab.position.set(0, -(AXIS_Y - BENCH_Y) - 0.04, 0.13)
      grp.add(peg, ball, lab)
      grp.position.set(X_POLE + s.x, AXIS_Y, 0)
      this.markers.push(grp)
    }
    for (const m of this.markers) this.opticsGroup.add(m)
  }

  /* ================= loading ================= */
  async load(lesson: OpticsLessonContract, onProgress?: (done: number, total: number) => void): Promise<void> {
    const loader = new GLTFLoader()
    const dir = lesson.modelUrl.slice(0, lesson.modelUrl.lastIndexOf('/') + 1)
    // The same lab bench cabinet the acid-base lab stands on, so the worktop is not floating in the air.
    const urls = { laser: lesson.assets.laser, plane: lesson.assets.planeMirror, stand: lesson.assets.mirrorStand, desk: `${dir}chemistry_lab_bench.glb` }
    let done = 0
    const one = (url: string) =>
      loader
        .loadAsync(url)
        .catch((err) => {
          console.warn('optics model failed to load, using a built-in stand-in:', url, err)
          return null
        })
        .then((g) => {
          onProgress?.(++done, Object.keys(urls).length)
          return g
        })
    const [laser, plane, stand, desk] = await Promise.all([one(urls.laser), one(urls.plane), one(urls.stand), one(urls.desk)])
    if (this.disposed) return

    this.beamTemplate = laser ? this.prepareBeam(laser.scene) : this.fallbackBeam()
    this.placeDesk(desk?.scene ?? null)
    this.mountPlaneMirror(plane?.scene ?? null)
    this.mountStand(stand?.scene ?? null)
    this.rebuildMarkers()
    this.collectPickables()
  }

  /** Stand the bench cabinet under the worktop: upright, as wide as the bench, never taller than the worktop height. */
  private placeDesk(model: THREE.Object3D | null) {
    if (!model) return
    const dims = () => new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3())
    let size = dims()
    if (size.z > size.y && size.z >= size.x) model.rotateX(-Math.PI / 2)
    else if (size.x > size.y && size.x > size.z) model.rotateZ(Math.PI / 2)
    model.updateMatrixWorld(true)
    size = dims()
    model.scale.multiplyScalar(BENCH_W / (size.x || 1))
    let box = new THREE.Box3().setFromObject(model)
    if (box.getSize(new THREE.Vector3()).y > BENCH_Y - 0.05) model.scale.multiplyScalar((BENCH_Y - 0.05) / box.getSize(new THREE.Vector3()).y)
    box = new THREE.Box3().setFromObject(model)
    const c = box.getCenter(new THREE.Vector3())
    model.position.x -= c.x
    model.position.z -= c.z
    model.position.y -= box.min.y
    model.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.castShadow = true
        m.receiveShadow = true
      }
    })
    // A single cabinet, centred under the worktop (same as the acid-base lab).
    const wrap = new THREE.Group()
    wrap.add(model)
    wrap.position.x = 0
    this.scene.add(wrap)
  }

  /** Re-skin the beam model as light: bright core, additive glow, no lighting or tone mapping. */
  private prepareBeam(src: THREE.Object3D): THREE.Object3D {
    const root = src.clone(true)
    root.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      m.castShadow = false
      m.receiveShadow = false
      const mat = (m.material as THREE.MeshStandardMaterial).clone()
      const glow = /glow/.test(o.name)
      mat.emissiveIntensity = glow ? 2.2 : 4
      mat.toneMapped = false
      mat.depthWrite = false
      mat.blending = THREE.AdditiveBlending
      mat.transparent = true
      m.material = mat
    })
    return root
  }

  private fallbackBeam(): THREE.Object3D {
    const root = new THREE.Group()
    const mk = (r: number, op: number, name: string) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, BEAM_GLB_LEN, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0x2a8bff, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false }))
      m.rotation.x = Math.PI / 2
      m.position.z = BEAM_GLB_LEN / 2
      m.name = name
      root.add(m)
    }
    mk(0.0015, 1, 'ray-core')
    mk(0.003, 0.4, 'ray-glow')
    const ret = new THREE.Mesh(new THREE.CircleGeometry(0.015, 20), new THREE.MeshBasicMaterial({ color: 0x4aa8ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }))
    ret.name = 'reticle'
    root.add(ret)
    return root
  }

  private mountPlaneMirror(src: THREE.Object3D | null) {
    const holder = this.surfaces.smooth
    const SCALE = 0.53
    if (src) {
      const m = src.clone(true)
      m.scale.setScalar(SCALE)
      m.position.y = 0.016
      m.traverse((o) => {
        o.userData.id = 'smooth'
        const mesh = o as THREE.Mesh
        if (mesh.isMesh) {
          mesh.castShadow = true
          mesh.receiveShadow = true
          const mat = mesh.material as THREE.MeshStandardMaterial
          if (mat.name === 'mirror') {
            mat.metalness = 1
            mat.roughness = 0.03
            mat.envMapIntensity = 1.8
          }
        }
      })
      holder.add(m)
    } else {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.22, 48), new THREE.MeshStandardMaterial({ color: 0xe9eef5, metalness: 1, roughness: 0.03 }))
      disc.position.y = 0.24
      disc.userData.id = 'smooth'
      holder.add(disc)
    }
  }

  private mountStand(src: THREE.Object3D | null) {
    // The model is a framed plate whose face points along local +z. Turn it so the face looks along +x (toward the
    // light), and put the plate's centre on the optical axis with its front face at the mirror's pole.
    const PLATE_FRONT_Z = 0.115
    const PLATE_CENTRE = new THREE.Vector3(0.29, 0.24, 0)
    if (src) {
      const m = src.clone(true)
      m.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.isMesh) {
          mesh.castShadow = true
          mesh.receiveShadow = true
        }
      })
      // The model hangs the plate off the side of a weighted block. Mirror it left-to-right so the block ends up
      // behind the axis plane, out of the camera's way and clear of every ray.
      m.scale.x = -1
      const g = new THREE.Group()
      g.add(m)
      g.rotation.y = Math.PI / 2
      // After the turn, local z maps to world x and the (flipped) local x to world z.
      g.position.set(X_POLE - PLATE_FRONT_Z, BENCH_Y, -PLATE_CENTRE.x)
      this.standGroup.add(g)
    } else {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, AXIS_Y - BENCH_Y, 0.03), new THREE.MeshStandardMaterial({ color: 0x9aa3b2, metalness: 0.85, roughness: 0.3 }))
      post.position.set(X_POLE - 0.03, BENCH_Y + (AXIS_Y - BENCH_Y) / 2, 0)
      this.standGroup.add(post)
    }
    // Cap sits on the stand's plate; mark it so a click on it is the mirror.
    this.standGroup.traverse((o) => (o.userData.id = 'mirror'))
  }

  private collectPickables() {
    this.pickables = [this.laser, this.candle, this.surfaces.smooth, this.surfaces.rough]
  }

  /* ================= staging ================= */
  /** Arrange the bench for one experiment. */
  setStage(stage: Stage, animate = true) {
    this.stage = stage
    this.clearRays()
    const laws = stage === 'laws'
    const plane = stage === 'plane' || laws
    this.planeGroup.visible = plane
    this.opticsGroup.visible = !plane
    // The laws are tested on the plane mirror alone, standing in the middle of the bench.
    this.surfaces.rough.visible = !laws
    this.surfaces.smooth.position.x = laws ? 0 : SURFACE_X.smooth
    if (laws) this.selectedSurface = 'smooth'
    this.candle.visible = stage === 'concave' || stage === 'convex'
    this.laserRoot.visible = true
    if (plane) {
      if (!laws) this.selectSurface(this.selectedSurface, false)
      const cx = laws ? 0 : 0.1
      this.flyTo(new THREE.Vector3(cx, AXIS_Y + (laws ? 1.25 : 1.15), laws ? 1.55 : 1.75), new THREE.Vector3(cx, AXIS_Y - 0.1, laws ? 0.1 : -0.05), animate)
    } else {
      const kind: MirrorKind = stage === 'convex' ? 'convex' : 'concave'
      if (kind !== this.mirror) this.swapMirror(kind)
      else this.rebuildMarkers()
      this.setCandleSpot(null, false, true)
      this.aimLaserForRules(1)
      this.flyTo(new THREE.Vector3(-0.05, AXIS_Y + 0.32, 1.95), new THREE.Vector3(-0.15, AXIS_Y - 0.03, 0), animate)
    }
    this.updateFramingNow()
  }

  /** Swap the cap on the stand: lift off, change, settle back, so it is clear the mirror is the same stand. */
  private swapMirror(kind: MirrorKind) {
    const holder = this.mirrorHolder
    sound.click()
    this.tween(0.22, (t) => holder.scale.setScalar(1 - easeInOut(t) * 0.92), () => {
      this.setCap(kind)
      this.rebuildMarkers()
      this.tween(0.3, (t) => holder.scale.setScalar(0.08 + easeOut(t) * 0.92))
    })
  }

  private surfaceCenter(id: string) {
    return new THREE.Vector3(this.stage === 'laws' && id === 'smooth' ? 0 : SURFACE_X[id], AXIS_Y - 0.01, SURFACE_Z)
  }

  selectSurface(id: string, animate = true) {
    this.selectedSurface = id
    this.clearRays()
    const S = this.surfaceCenter(id)
    const origin = S.clone().addScaledVector(INCIDENT, -BEAM_LEN_IN)
    this.laserMuzzle(origin, INCIDENT, true, animate)
    for (const [k, g] of Object.entries(this.surfaces)) g.userData.selected = k === id
  }

  private laserMuzzle(origin: THREE.Vector3, dir: THREE.Vector3, comb: boolean, animate: boolean) {
    if (!animate) return this.aimLaser(origin, dir, comb)
    const from = this.laser.position.clone()
    const fromDir = new THREE.Vector3(0, 0, 1).applyQuaternion(this.laser.quaternion)
    this.tween(0.55, (t) => {
      const k = easeInOut(t)
      this.aimLaser(from.clone().lerp(origin, k), fromDir.clone().lerp(dir, k).normalize(), comb)
    })
  }

  private aimLaserForRules(rule: 1 | 2 | 3 | 4, animate = false, params?: RuleParams) {
    const r = ruleDiagram(this.geo, rule, params).rays[0].segs[0]
    const a = world(r.a)
    const b = world(r.b)
    this.laserMuzzle(a, b.clone().sub(a).normalize(), false, animate)
  }

  /** Show which ray will be fired, as a faint dotted guide, without revealing where it goes. */
  previewRule(rule: 1 | 2 | 3 | 4, params?: RuleParams) {
    this.clearRays()
    this.aimLaserForRules(rule, true, params)
    const d = ruleDiagram(this.geo, rule, params)
    this.addGuide(d.rays[0].segs[0])
    this.addFlash(world(d.hit), 0x66aaff, 0.012, 0.35)
  }

  /** Move the candle to one of the lesson's object positions; `null` parks it at infinity. */
  setCandleSpot(uOverF: number | null, animate = true, immediate = false) {
    this.clearRays(true)
    const inf = uOverF === null
    const x = inf ? INFINITY_X : X_POLE + uOverF * this.f
    const apply = (xx: number) => {
      this.candle.position.set(xx, AXIS_Y, 0)
      this.candleX = xx
    }
    this.candle.visible = (this.stage === 'concave' || this.stage === 'convex') && !inf
    if (!this.infinityLabel) {
      this.infinityLabel = this.makeLabel('Object at infinity  →', '#ffd479', 0.45)
      this.opticsGroup.add(this.infinityLabel)
    }
    this.infinityLabel.visible = inf && (this.stage === 'concave' || this.stage === 'convex')
    this.infinityLabel.position.set(INFINITY_X - 0.35, AXIS_Y + 0.12, 0)
    if (immediate || !animate || inf) return apply(x)
    const from = this.candleX
    this.candle.visible = true
    this.tween(0.5, (t) => apply(from + (x - from) * easeInOut(t)))
  }

  setCases(cases: CaseSpot[]) {
    this.cases = cases
  }

  /* ================= playing ================= */
  clearRays(keepGhost = false) {
    for (const b of this.beams) this.disposeBeam(b)
    this.beams = []
    for (const e of this.extras) {
      e.parent?.remove(e)
      e.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.geometry && m.userData.owns) m.geometry.dispose()
      })
    }
    this.extras = []
    if (!keepGhost && this.ghost) {
      this.opticsGroup.remove(this.ghost)
      this.ghost = null
    }
  }

  private disposeBeam(b: Beam) {
    this.scene.remove(b.root)
  }

  private makeBeam(): Beam {
    const root = (this.beamTemplate ?? this.fallbackBeam()).clone(true)
    root.renderOrder = 10
    let reticle: THREE.Object3D | null = null
    root.traverse((o) => {
      if (o.name === 'reticle') {
        reticle = o
        o.visible = false
      }
    })
    const wrap = new THREE.Group()
    wrap.add(root)
    wrap.visible = false
    this.scene.add(wrap)
    const beam: Beam = { root: wrap, reticle }
    this.beams.push(beam)
    return beam
  }

  /** Lay a beam from a to b, grown to `progress` of its length. */
  private setBeam(beam: Beam, a: THREE.Vector3, b: THREE.Vector3, progress: number, spot = false) {
    const len = a.distanceTo(b)
    const p = Math.max(0.0001, progress)
    beam.root.visible = progress > 0
    beam.root.position.copy(a)
    beam.root.lookAt(b)
    beam.root.scale.set(BEAM_THICK, BEAM_THICK, (len * p) / BEAM_GLB_LEN)
    if (beam.reticle) {
      beam.reticle.visible = spot && progress >= 1
      beam.reticle.position.z = BEAM_GLB_LEN
      beam.reticle.scale.set(0.3, 0.3, 1)
    }
  }

  /** A dashed construction line (virtual rays and previews). */
  private addDashed(a: THREE.Vector3, b: THREE.Vector3, color: number, dash = 0.022): THREE.Line {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineDashedMaterial({ color, dashSize: dash, gapSize: dash * 0.7, transparent: true, opacity: 0 }))
    line.computeLineDistances()
    line.userData.owns = true
    line.renderOrder = 9
    this.scene.add(line)
    this.extras.push(line)
    return line
  }

  private addGuide(seg: Seg) {
    const l = this.addDashed(world(seg.a), world(seg.b), 0x7fb2ff, 0.02)
    ;(l.material as THREE.LineDashedMaterial).opacity = 0.6
  }

  private addFlash(p: THREE.Vector3, color: number, r = 0.02, opacity = 0.9): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }))
    m.position.copy(p)
    m.userData.owns = true
    this.scene.add(m)
    this.extras.push(m)
    return m
  }

  private async grow(items: { beam: Beam; a: THREE.Vector3; b: THREE.Vector3; spot?: boolean }[], seconds: number) {
    await this.tweenP(seconds, (t) => {
      const k = easeOut(t)
      for (const it of items) this.setBeam(it.beam, it.a, it.b, k, it.spot)
    })
    for (const it of items) this.setBeam(it.beam, it.a, it.b, 1, it.spot)
  }

  private fade(line: THREE.Line, to: number, seconds: number) {
    const mat = line.material as THREE.Material
    return this.tweenP(seconds, (t) => (mat.opacity = to * easeOut(t)))
  }

  /** Fire the five-beam comb at the selected surface. Smooth: all five leave parallel. Foil: each meets a different facet. */
  async playPlane(id: string): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      this.selectedSurface = id
      this.clearRays()
      const S = this.surfaceCenter(id)
      const normal = new THREE.Vector3(0, 0, 1)
      sound.spark()
      this.laserOn(true)
      const hits: THREE.Vector3[] = []
      const inc: { beam: Beam; a: THREE.Vector3; b: THREE.Vector3 }[] = []
      for (let i = -2; i <= 2; i++) {
        const hit = S.clone().addScaledVector(new THREE.Vector3(1, 0, 0), i * COMB_SPACING * Math.SQRT2)
        hits.push(hit)
        inc.push({ beam: this.makeBeam(), a: hit.clone().addScaledVector(INCIDENT, -BEAM_LEN_IN), b: hit })
      }
      // Muzzle sits on the incident line of the centre beam; the comb spreads the rest.
      await this.grow(inc, 0.55)
      const flashes = hits.map((h) => this.addFlash(h, 0x9cc8ff, 0.016, 0.9))
      sound.whoosh(0.5)

      const rand = rng(id === 'rough' ? 77031 : 5)
      const out: { beam: Beam; a: THREE.Vector3; b: THREE.Vector3; spot: boolean }[] = []
      hits.forEach((hit) => {
        let dir: THREE.Vector3
        let len = BEAM_LEN_IN
        if (id === 'smooth') {
          dir = INCIDENT.clone().sub(normal.clone().multiplyScalar(2 * INCIDENT.dot(normal)))
        } else {
          // Each ray still obeys the law of reflection, but every facet of the foil has its own normal.
          const n = normal.clone()
          n.x += (rand() - 0.5) * 1.5
          n.y += (rand() - 0.5) * 0.9
          n.z += 0.25 + rand() * 0.3
          n.normalize()
          dir = INCIDENT.clone().sub(n.clone().multiplyScalar(2 * INCIDENT.dot(n))).normalize()
          if (dir.z < 0.08) dir.z = 0.08 + rand() * 0.25
          dir.normalize()
          len = 0.55 + rand() * 0.5
        }
        out.push({ beam: this.makeBeam(), a: hit, b: hit.clone().addScaledVector(dir, len), spot: true })
      })
      await this.grow(out, 0.7)
      await this.tweenP(0.5, (t) => flashes.forEach((f) => ((f.material as THREE.Material).opacity = 0.9 * (1 - t))))
      this.laserOn(false)
      this.surfaces[id].userData.fired = true
    } finally {
      this.busy = false
    }
  }

  /* ---------------- laws of reflection ---------------- */
  /**
   * Geometry of one law demonstration at the plane mirror, in the mirror's frame: n is the normal, t a direction
   * along the mirror tilted `elevation` below horizontal. The incident ray makes exactly `angle` with the normal.
   */
  private lawFrame(l: OpticsLaw) {
    const i = (l.incidentAngleDeg * Math.PI) / 180
    const e = (l.elevationDeg * Math.PI) / 180
    const n = new THREE.Vector3(0, 0, 1)
    const t = new THREE.Vector3((l.side === 'right' ? -1 : 1) * Math.cos(e), -Math.sin(e), 0)
    const d = t.clone().multiplyScalar(Math.sin(i)).addScaledVector(n, -Math.cos(i))
    const r = t.clone().multiplyScalar(Math.sin(i)).addScaledVector(n, Math.cos(i))
    const S = this.surfaceCenter('smooth')
    return { i, n, t, d, r, S }
  }

  private addLine(points: THREE.Vector3[], color: number, dashed = false, opacity = 0.9): THREE.Line {
    const mat = dashed ? new THREE.LineDashedMaterial({ color, dashSize: 0.025, gapSize: 0.018, transparent: true, opacity }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity })
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), mat)
    if (dashed) line.computeLineDistances()
    line.userData.owns = true
    line.renderOrder = 9
    this.scene.add(line)
    this.extras.push(line)
    return line
  }

  /** An arc from the normal toward `toward`, radius `rad`, spanning the angle between them. */
  private addArc(S: THREE.Vector3, n: THREE.Vector3, toward: THREE.Vector3, rad: number, color: number): THREE.Vector3 {
    const ang = Math.acos(Math.min(1, n.dot(toward)))
    const axis = new THREE.Vector3().crossVectors(n, toward).normalize()
    const pts: THREE.Vector3[] = []
    for (let k = 0; k <= 24; k++) pts.push(S.clone().add(n.clone().applyAxisAngle(axis, (ang * k) / 24).multiplyScalar(rad)))
    this.addLine(pts, color, false, 0.95)
    return S.clone().add(n.clone().applyAxisAngle(axis, ang / 2).multiplyScalar(rad + 0.07))
  }

  private addTag(text: string, at: THREE.Vector3, color = '#ffffff', width = 0.2) {
    const l = this.makeLabel(text, color, width)
    l.position.copy(at)
    this.scene.add(l)
    this.extras.push(l)
    return l
  }

  /** Aim the laser for a law, draw the normal and mark the angle of incidence: nothing about the outcome. */
  previewLaw(l: OpticsLaw) {
    this.clearRays()
    const f = this.lawFrame(l)
    this.laserMuzzle(f.S.clone().addScaledVector(f.d, -BEAM_LEN_IN), f.d, false, true)
    this.addLine([f.S.clone().addScaledVector(f.n, -0.02), f.S.clone().addScaledVector(f.n, 0.55)], 0xffd479, true, 0.95)
    this.addTag('normal', f.S.clone().addScaledVector(f.n, 0.63), '#ffd479', 0.16)
    this.addGuide3(f.S.clone().addScaledVector(f.d, -BEAM_LEN_IN), f.S)
    const mid = this.addArc(f.S, f.n, f.d.clone().negate(), 0.2, 0x7fb2ff)
    this.addTag(`i = ${l.incidentAngleDeg}°`, mid, '#9cc8ff', 0.17)
  }

  private addGuide3(a: THREE.Vector3, b: THREE.Vector3) {
    this.addLine([a, b], 0x7fb2ff, true, 0.55)
  }

  async playLaw(l: OpticsLaw): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      this.clearRays()
      const f = this.lawFrame(l)
      const origin = f.S.clone().addScaledVector(f.d, -BEAM_LEN_IN)
      this.aimLaser(origin, f.d, false)
      this.addLine([f.S.clone().addScaledVector(f.n, -0.02), f.S.clone().addScaledVector(f.n, 0.55)], 0xffd479, true, 0.95)
      this.addTag('normal', f.S.clone().addScaledVector(f.n, 0.63), '#ffd479', 0.16)
      this.laserOn(true)
      sound.spark()
      const b1 = this.makeBeam()
      await this.grow([{ beam: b1, a: origin, b: f.S }], 0.6)
      this.addFlash(f.S, 0xffffff, 0.016, 0.9)
      sound.click()
      const end = f.S.clone().addScaledVector(f.r, 0.8)
      const b2 = this.makeBeam()
      await this.grow([{ beam: b2, a: f.S, b: end, spot: true }], 0.7)
      this.laserOn(false)
      const incMid = this.addArc(f.S, f.n, f.d.clone().negate(), 0.2, 0x7fb2ff)
      const refMid = this.addArc(f.S, f.n, f.r, 0.2, 0x3ef2c4)
      this.addTag(`i = ${l.incidentAngleDeg}°`, incMid, '#9cc8ff', 0.17)
      this.addTag(`r = ${l.incidentAngleDeg}°`, refMid, '#7ff5d9', 0.17)
      if (l.id === 'law_plane') {
        // The plane that holds the incident ray, the normal and the reflected ray.
        const half = 0.62
        const a = f.S.clone().addScaledVector(f.t, -half).addScaledVector(f.n, -0.02)
        const b = f.S.clone().addScaledVector(f.t, half).addScaledVector(f.n, -0.02)
        const c = f.S.clone().addScaledVector(f.t, half).addScaledVector(f.n, 0.62)
        const dd = f.S.clone().addScaledVector(f.t, -half).addScaledVector(f.n, 0.62)
        const geo = new THREE.BufferGeometry().setFromPoints([a, b, c, a, c, dd])
        const mat = new THREE.MeshBasicMaterial({ color: 0x3ef2c4, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
        const sheet = new THREE.Mesh(geo, mat)
        sheet.userData.owns = true
        this.scene.add(sheet)
        this.extras.push(sheet)
        this.addTag('plane of incidence', dd.clone().addScaledVector(f.n, 0.05), '#7ff5d9', 0.2)
        await this.tweenP(0.7, (t) => (mat.opacity = 0.2 * easeOut(t)))
      }
      if (l.id === 'law_sides') {
        this.addTag('incident side', f.S.clone().addScaledVector(f.d, -0.5).addScaledVector(f.n, 0.13), '#9cc8ff', 0.24)
        this.addTag('reflected side', end.clone().addScaledVector(f.n, 0.13), '#7ff5d9', 0.26)
      }
      sound.click()
    } finally {
      this.busy = false
    }
  }

  /** Fire one ray at the concave mirror and watch where it goes. */
  async playRule(rule: 1 | 2 | 3 | 4, params?: RuleParams): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      this.clearRays()
      this.aimLaserForRules(rule, false, params)
      const d = ruleDiagram(this.geo, rule, params)
      const segs = d.rays[0].segs
      const [inc, ref] = [segs[0], segs[1]]
      this.laserOn(true)
      sound.spark()
      const b1 = this.makeBeam()
      await this.grow([{ beam: b1, a: world(inc.a), b: world(inc.b) }], 0.6)
      this.addFlash(world(d.hit), 0xffffff, 0.016, 0.9)
      sound.click()
      const b2 = this.makeBeam()
      await this.grow([{ beam: b2, a: world(ref.a), b: world(ref.b), spot: true }], 0.75)
      this.laserOn(false)
    } finally {
      this.busy = false
    }
  }

  /** Trace the principal rays for the candle's current position and show the image. */
  async playCase(uOverF: number | null): Promise<Diagram> {
    const u = uOverF === null ? null : uOverF * this.f
    const diagram = diagramFor(this.geo, u, OBJ_H)
    if (this.busy) return diagram
    this.busy = true
    try {
      this.clearRays()
      sound.spark()
      // Stage 1: incident rays travel to the mirror.
      const incident = diagram.rays.map((r) => ({ r, seg: r.segs[0] }))
      const b1 = incident.map((x) => ({ beam: this.makeBeam(), a: world(x.seg.a), b: world(x.seg.b) }))
      await this.grow(b1, 0.7)
      for (const x of incident) this.addFlash(world(x.seg.b), 0xffffff, 0.011, 0.85)
      sound.whoosh(0.5)
      // Stage 2: reflected rays leave; virtual extensions appear dashed behind the mirror.
      const reflected: { beam: Beam; a: THREE.Vector3; b: THREE.Vector3; spot?: boolean }[] = []
      const virtual: THREE.Line[] = []
      for (const r of diagram.rays) {
        for (const s of r.segs.slice(1)) {
          if (s.style === 'reflected') reflected.push({ beam: this.makeBeam(), a: world(s.a), b: world(s.b) })
          else virtual.push(this.addDashed(world(s.a), world(s.b), 0xb98bff))
        }
      }
      await Promise.all([this.grow(reflected, 0.85), ...virtual.map((l) => this.fade(l, 0.9, 0.9))])
      // Stage 3: the image appears where the rays meet (or seem to).
      await this.showImage(diagram)
      return diagram
    } finally {
      this.busy = false
    }
  }

  private async showImage(d: Diagram) {
    const im = d.image
    if (im.atInfinity || !im.tip) {
      if (im.atInfinity) {
        const l = this.makeLabel('Rays leave parallel: image at infinity', '#ffd479', 0.4)
        l.position.set(X_POLE + 0.95, AXIS_Y + 0.3, 0)
        this.opticsGroup.add(l)
        this.extras.push(l)
        const mat = l.material as THREE.SpriteMaterial
        mat.opacity = 0
        await this.tweenP(0.6, (t) => (mat.opacity = t))
      }
      return
    }
    const g = this.makeGhost(im.real)
    const base = world({ x: im.v ?? 0, y: 0 })
    g.position.copy(base)
    const m = im.m
    // A point image (object at infinity) is shown as a bright focal spot rather than a tiny candle.
    if (im.m === 0) {
      const spot = this.addFlash(world(im.tip), im.real ? 0x3ef2c4 : 0xb98bff, 0.014, 0.95)
      this.ghost = null
      void spot
      sound.click()
      return
    }
    g.scale.set(Math.max(0.5, Math.abs(m)), m, Math.max(0.5, Math.abs(m)))
    g.visible = true
    this.opticsGroup.add(g)
    this.ghost = g
    const tag = this.makeLabel(`${im.real ? 'Real' : 'Virtual'} image`, im.real ? '#7ff5d9' : '#d6b8ff', 0.26)
    const tipY = im.tip.y
    tag.position.set(base.x, AXIS_Y + (tipY >= 0 ? tipY + 0.09 : tipY - 0.12), 0)
    this.opticsGroup.add(tag)
    this.extras.push(tag)
    const mats: THREE.Material[] = []
    g.traverse((o) => {
      const mm = (o as THREE.Mesh).material as THREE.Material | undefined
      if (mm) mats.push(mm)
    })
    const targets = mats.map((mm) => mm.opacity)
    mats.forEach((mm) => (mm.opacity = 0))
    sound.click()
    await this.tweenP(0.7, (t) => mats.forEach((mm, i) => (mm.opacity = targets[i] * easeOut(t))))
  }

  private laserOn(on: boolean) {
    const mat = this.laserGlow.material as THREE.MeshBasicMaterial
    mat.opacity = on ? 0.75 : 0
  }

  /* ================= camera ================= */
  private flyTo(pos: THREE.Vector3, target: THREE.Vector3, animate: boolean) {
    if (!animate) {
      this.camera.position.copy(pos)
      this.controls.target.copy(target)
      this.controls.update()
      return
    }
    const p0 = this.camera.position.clone()
    const t0 = this.controls.target.clone()
    let el = 0
    const D = 1.0
    const step = (dt: number) => {
      el += dt
      const k = easeInOut(Math.min(1, el / D))
      this.camera.position.lerpVectors(p0, pos, k)
      this.controls.target.lerpVectors(t0, target, k)
      return el < D
    }
    this.viewTween = step
  }

  setInsets(insets: { left: number; right: number; top: number; bottom: number }) {
    this.insets = insets
    this.updateFramingNow()
  }
  private updateFramingNow() {
    this.resize()
  }

  /* ================= input ================= */
  private setPointer(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect()
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    this.raycaster.ray.intersectPlane(this.benchPlane, this.handPoint)
  }
  private idAt(): string {
    const hit = this.raycaster.intersectObjects(this.pickables, true).find((h) => h.object.userData.id || h.object.parent?.userData.id)
    if (!hit) return ''
    let o: THREE.Object3D | null = hit.object
    while (o) {
      if (o.userData.id) return String(o.userData.id)
      o = o.parent
    }
    return ''
  }
  private onPointerMove = (e: PointerEvent) => {
    this.setPointer(e)
    if (this.dragging) {
      const p = new THREE.Vector3()
      if (this.raycaster.ray.intersectPlane(this.midPlane, p)) {
        const x = Math.min(X_POLE + 1.95, Math.max(X_POLE + 0.08, p.x))
        this.candle.position.x = x
        this.candleX = x
        this.candle.visible = true
        if (this.infinityLabel) this.infinityLabel.visible = false
      }
      return
    }
    const id = this.idAt()
    if (id !== this.hoverId) {
      this.hoverId = id
      this.canvas.style.cursor = id === 'candle' ? 'grab' : id === 'laser' || id === 'smooth' || id === 'rough' ? 'pointer' : ''
    }
  }
  private onPointerDown = (e: PointerEvent) => {
    this.downAt = { x: e.clientX, y: e.clientY }
    this.setPointer(e)
    if (this.stage !== 'plane' && !this.busy && this.idAt() === 'candle' && this.stage !== 'rules') {
      this.dragging = true
      this.controls.enabled = false
      this.canvas.style.cursor = 'grabbing'
      this.canvas.setPointerCapture(e.pointerId)
    }
  }
  private onPointerUp = (e: PointerEvent) => {
    this.controls.enabled = true
    if (this.dragging) {
      this.dragging = false
      this.canvas.releasePointerCapture?.(e.pointerId)
      this.canvas.style.cursor = ''
      const idx = this.nearestCase(this.candleX)
      if (idx >= 0) this.events.onCandleSnap(idx)
      return
    }
    if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 6) return
    this.setPointer(e)
    const id = this.idAt()
    if (id === 'laser') this.events.onLaserClick()
    else if (id === 'smooth' || id === 'rough') this.events.onSurfaceClick(id)
  }
  private onPointerLeave = () => {
    this.pointer.set(10, 10)
    this.hoverId = ''
  }

  private nearestCase(x: number): number {
    let best = -1
    let bestD = Infinity
    this.cases.forEach((c, i) => {
      const cx = c.uOverF === null ? INFINITY_X : X_POLE + c.uOverF * this.f
      const d = Math.abs(cx - x)
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    return best
  }

  /* ================= loop ================= */
  private tween(seconds: number, step: (t: number) => void, done?: () => void) {
    let el = 0
    this.tweens.add((dt) => {
      el += dt
      const t = Math.min(1, el / seconds)
      step(t)
      if (t >= 1) {
        done?.()
        return false
      }
      return true
    })
  }
  private tweenP(seconds: number, step: (t: number) => void): Promise<void> {
    return new Promise((resolve) => this.tween(seconds, step, resolve))
  }

  private resize() {
    const w = this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || 800
    const h = this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || 600
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    // Keep the whole bench visible in the part of the screen the panels leave free: shift the picture into the free
    // area and widen the field of view when the panels take a lot of room.
    const freeW = Math.max(300, w - this.insets.left - this.insets.right)
    const freeH = Math.max(240, h - this.insets.top - this.insets.bottom)
    this.camera.setViewOffset(w, h, -(this.insets.left - this.insets.right) / 2, -(this.insets.top - this.insets.bottom) / 2, w, h)
    const need = Math.max(w / freeW, h / freeH)
    this.camera.fov = Math.min(72, 38 * Math.max(1, need * (this.stage === 'plane' ? 0.95 : 1.05)))
    this.camera.updateProjectionMatrix()
  }
  start() {
    this.renderer.setAnimationLoop(() => this.frame())
  }

  private frame() {
    if (this.disposed) return
    const dt = Math.min(0.05, this.clock.getDelta())
    for (const t of [...this.tweens]) if (!t(dt)) this.tweens.delete(t)
    if (this.viewTween && !this.viewTween(dt)) this.viewTween = null
    const now = performance.now() / 1000
    this.flame.scale.y = 1.7 + Math.sin(now * 13) * 0.12 + Math.sin(now * 7.3) * 0.08
    this.flameLight.intensity = 0.33 + Math.sin(now * 11) * 0.04
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.disposed = true
    this.renderer.setAnimationLoop(null)
    window.removeEventListener('resize', this.onResize)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave)
    this.controls.dispose()
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh
      m.geometry?.dispose?.()
      const mat = m.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else mat?.dispose?.()
    })
    this.renderer.dispose()
  }
}
