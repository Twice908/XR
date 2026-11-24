import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { MaterialKind, MetalsLessonContract, MetalsSample, MetalsTool } from '@mmaxr/schema'
import { sound } from './sound'

/* Layout (metres). The bench top is y = BENCH_Y and the lab faces +z. */
const BENCH_Y = 0.9
const BENCH_W = 3.4
const BENCH_D = 0.95
const SAMPLE_Z = 0.04
const SAMPLE_SPACING = 0.3
const TOOL_Z = -0.3
const TOOL_SPACING = 0.4
const RISER_H = 0.1
const ARENA = new THREE.Vector3(0, BENCH_Y, 0.36)

export interface MetalsSceneEvents {
  onSampleClick(index: number): void
  onToolClick(id: string): void
}

export interface PlayResult {
  outcome: string
  litmus?: string | null
}

interface SampleObj {
  index: number
  look: MetalsSample
  group: THREE.Group
  ring: THREE.Mesh
  badge: THREE.Sprite | null
  hover: number
}

interface ToolObj {
  id: string
  /** The moving tool. */
  group: THREE.Group
  /** The fixed pad, label and hit area it rests on. */
  station: THREE.Group
  pad: THREE.Mesh
  home: THREE.Vector3
  homeRot: THREE.Euler
  flame?: THREE.Mesh
  bulb?: THREE.Mesh
  water?: THREE.Mesh
  hover: number
  active: boolean
}

interface Particle {
  mesh: THREE.Mesh
  vel: THREE.Vector3
  life: number
  max: number
  gravity: number
  floor: number
}

type Ease = (t: number) => number
const easeInOut: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const easeOut: Ease = (t) => 1 - Math.pow(1 - t, 3)
const easeIn: Ease = (t) => t * t * t

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)

/** Build one sample from how it looks: chunk, powder, crystals, flakes, a soft block or a drop of liquid. */
function makePiece(look: MetalsSample): { group: THREE.Group; mats: THREE.MeshStandardMaterial[] } {
  const shiny = look.lustre === 'shiny'
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(look.colorHex), metalness: shiny ? 0.92 : 0.05, roughness: shiny ? 0.22 : 0.85 })
  const group = new THREE.Group()
  const add = (m: THREE.Mesh) => {
    m.castShadow = true
    m.receiveShadow = true
    group.add(m)
  }
  const rnd = (n: number) => (Math.random() - 0.5) * n
  switch (look.texture) {
    case 'liquid': {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.045, 28, 20), new THREE.MeshStandardMaterial({ color: new THREE.Color(look.colorHex), metalness: 1, roughness: 0.05 }))
      m.scale.set(1.25, 0.32, 1.25)
      m.position.y = 0.016
      add(m)
      mat.dispose()
      return { group, mats: [m.material as THREE.MeshStandardMaterial] }
    }
    case 'powder': {
      for (let i = 0; i < 46; i++) {
        const r = 0.006 + Math.random() * 0.007
        const a = Math.random() * Math.PI * 2
        const d = Math.random() * 0.045
        const m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat)
        m.position.set(Math.cos(a) * d, r + (0.045 - d) * 0.5 * Math.random(), Math.sin(a) * d)
        add(m)
      }
      break
    }
    case 'crystal': {
      for (let i = 0; i < 7; i++) {
        const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.018 + Math.random() * 0.016, 0), mat)
        m.position.set(rnd(0.07), 0.02 + Math.random() * 0.03, rnd(0.07))
        m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3)
        add(m)
      }
      break
    }
    case 'flaky': {
      for (let i = 0; i < 6; i++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.07 - i * 0.004, 0.008, 0.05), mat)
        m.position.set(rnd(0.012), 0.005 + i * 0.009, rnd(0.012))
        m.rotation.y = rnd(0.7)
        add(m)
      }
      break
    }
    case 'soft': {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.05, 0.05, 4, 4, 4), mat)
      const pos = m.geometry.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i)
        const k = 0.04 / Math.max(0.0001, v.length())
        v.lerp(v.clone().multiplyScalar(k * 0.9), 0.55)
        pos.setXYZ(i, v.x, v.y, v.z)
      }
      m.geometry.computeVertexNormals()
      m.position.y = 0.026
      add(m)
      break
    }
    default: {
      const geo = new THREE.IcosahedronGeometry(0.05, 1)
      const pos = geo.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i).multiplyScalar(0.82 + Math.random() * 0.32)
        pos.setXYZ(i, v.x, v.y * 0.8, v.z)
      }
      geo.computeVertexNormals()
      const m = new THREE.Mesh(geo, mat)
      m.position.y = 0.04
      add(m)
    }
  }
  return { group, mats: [mat] }
}

export class MetalsScene {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  private readonly clock = new THREE.Clock()
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2(10, 10)
  private readonly handPoint = new THREE.Vector3(0, BENCH_Y, 0.2)
  private readonly benchPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BENCH_Y)
  private samples: SampleObj[] = []
  private tools: Record<string, ToolObj> = {}
  private pickables: THREE.Object3D[] = []
  private tweens = new Set<(dt: number) => boolean>()
  private particles: Particle[] = []
  private temps: THREE.Object3D[] = []
  private dust: THREE.Points | null = null
  private insets = { left: 0, right: 0, top: 0, bottom: 0 }
  private insetsTarget = { left: 0, right: 0, top: 0, bottom: 0 }
  private focusTarget = new THREE.Vector3(0, 1, 0)
  private focusPos = new THREE.Vector3()
  private focusing = false
  private userMoved = false
  private focusCustom = false
  private defaultPos = new THREE.Vector3(0, 1.5, 1.6)
  private defaultTarget = new THREE.Vector3(0, 1.0, 0)
  private hoveredSample = -1
  private hoveredTool = ''
  private downAt = { x: 0, y: 0, t: 0 }
  private disposed = false
  private running = false
  private busy = false
  private readonly onResize = () => this.resize()

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly events: MetalsSceneEvents,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.95
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.xr.enabled = true

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 40)
    this.camera.position.copy(this.defaultPos)
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.target.copy(this.defaultTarget)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.enablePan = false
    this.controls.minDistance = 0.5
    this.controls.maxDistance = 4.2
    this.controls.minPolarAngle = Math.PI * 0.2
    this.controls.maxPolarAngle = Math.PI * 0.5
    this.controls.minAzimuthAngle = -Math.PI * 0.32
    this.controls.maxAzimuthAngle = Math.PI * 0.32
    this.controls.rotateSpeed = 0.55
    this.controls.addEventListener('start', () => {
      this.focusing = false
      this.userMoved = true
    })

    this.buildEnvironment()
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

  /* ---------------- environment ---------------- */
  private buildEnvironment() {
    const scene = this.scene
    scene.background = new THREE.Color(0x0b0d12)
    scene.fog = new THREE.Fog(0x0b0d12, 4, 9)
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.4
    scene.add(new THREE.HemisphereLight(0x9bb4ff, 0x1a1410, 0.28))

    const key = new THREE.SpotLight(0xfff3e0, 36, 8, Math.PI / 4.6, 0.7, 1.6)
    key.position.set(0.8, 2.6, 1.7)
    key.target.position.set(0, BENCH_Y, 0.1)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.bias = -0.0004
    scene.add(key, key.target)
    const rimA = new THREE.PointLight(0xf59e0b, 5, 5)
    rimA.position.set(-1.9, 1.7, -0.8)
    const rimB = new THREE.PointLight(0x22d3ee, 4, 5)
    rimB.position.set(1.9, 1.5, -0.9)
    scene.add(rimA, rimB)

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshStandardMaterial({ color: 0x14171d, roughness: 0.55, metalness: 0.1 }))
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    scene.add(floor)
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(14, 5), new THREE.MeshStandardMaterial({ color: 0x1b2029, roughness: 0.85 }))
    wall.position.set(0, 2.5, -1.35)
    wall.receiveShadow = true
    scene.add(wall)
    const top = new THREE.Mesh(new THREE.BoxGeometry(BENCH_W, 0.05, BENCH_D), new THREE.MeshStandardMaterial({ color: 0x20252e, roughness: 0.32, metalness: 0.15 }))
    top.position.set(0, BENCH_Y - 0.025, 0)
    top.receiveShadow = true
    top.castShadow = true
    scene.add(top)

    const n = 140
    const pos = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 4
      pos[i * 3 + 1] = BENCH_Y + Math.random() * 1.6
      pos[i * 3 + 2] = (Math.random() - 0.5) * 3
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.dust = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xcdd6ff, size: 0.008, transparent: true, opacity: 0.35, depthWrite: false }))
    scene.add(this.dust)
  }

  /* ---------------- loading ---------------- */
  async load(lesson: MetalsLessonContract, onProgress?: (done: number, total: number) => void): Promise<void> {
    const loader = new GLTFLoader()
    const dir = lesson.modelUrl.slice(0, lesson.modelUrl.lastIndexOf('/') + 1)
    const urls = { bench: lesson.modelUrl, hammer: lesson.assets?.hammer ?? `${dir}claw-hammer.glb`, burner: lesson.assets?.bunsenBurner ?? `${dir}bunsen-burner.glb` }
    let done = 0
    const total = Object.keys(urls).length
    const one = (url: string) =>
      loader
        .loadAsync(url)
        .catch((err) => {
          console.warn('[metals] asset failed, skipping', url, err)
          return null
        })
        .finally(() => onProgress?.(++done, total))
    const [bench, hammer, burner] = await Promise.all([one(urls.bench), one(urls.hammer), one(urls.burner)])

    if (bench) this.placeCabinet(bench.scene)
    if (hammer) this.placeProp(hammer.scene, 0.26, 1.5, 0.15, -0.5)
    if (burner) this.placeProp(burner.scene, 0.24, -1.5, 0.12, 0.3)
    this.placeTools(lesson.tools)
    this.placeSamples(lesson.samples ?? [])
  }

  private fit(model: THREE.Object3D, opts: { height?: number; width?: number }): THREE.Group {
    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    const k = opts.height ? opts.height / (size.y || 1) : (opts.width ?? 1) / (size.x || 1)
    model.scale.multiplyScalar(k)
    const b2 = new THREE.Box3().setFromObject(model)
    const c = b2.getCenter(new THREE.Vector3())
    model.position.x -= c.x
    model.position.z -= c.z
    model.position.y -= b2.min.y
    const wrap = new THREE.Group()
    wrap.add(model)
    return wrap
  }
  private uprighten(model: THREE.Object3D) {
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3())
    if (size.z > size.y && size.z >= size.x) model.rotateX(-Math.PI / 2)
    else if (size.x > size.y && size.x > size.z) model.rotateZ(Math.PI / 2)
    model.updateMatrixWorld(true)
  }
  private shadows(root: THREE.Object3D) {
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true
        o.receiveShadow = true
      }
    })
  }
  private placeCabinet(model: THREE.Object3D) {
    this.uprighten(model)
    const wrap = this.fit(model, { width: BENCH_W })
    const size = new THREE.Box3().setFromObject(wrap).getSize(new THREE.Vector3())
    if (size.y > BENCH_Y - 0.05) wrap.scale.multiplyScalar((BENCH_Y - 0.05) / size.y)
    this.shadows(wrap)
    this.scene.add(wrap)
  }
  private placeProp(model: THREE.Object3D, height: number, x: number, z: number, rotY: number) {
    this.uprighten(model)
    const wrap = this.fit(model, { height })
    wrap.position.set(x, BENCH_Y, z)
    wrap.rotation.y = rotY
    this.shadows(wrap)
    this.scene.add(wrap)
  }

  /* ---------------- samples ---------------- */
  private placeSamples(looks: MetalsSample[]) {
    const span = (looks.length - 1) * SAMPLE_SPACING
    looks.forEach((look, i) => {
      const x = -span / 2 + i * SAMPLE_SPACING
      const group = new THREE.Group()
      group.position.set(x, BENCH_Y, SAMPLE_Z)

      const tray = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.125, 0.012, 40), new THREE.MeshStandardMaterial({ color: 0x2b313c, roughness: 0.4, metalness: 0.3 }))
      tray.position.y = 0.006
      tray.receiveShadow = true
      group.add(tray)
      const { group: piece } = makePiece(look)
      piece.position.y = 0.012
      group.add(piece)
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.128, 0.15, 56), new THREE.MeshBasicMaterial({ color: 0x8ab4ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }))
      ring.rotation.x = -Math.PI / 2
      ring.position.y = 0.004
      group.add(ring)
      const label = this.textSprite(String(i + 1), { size: 96, bg: '#1f242e', fg: '#ffffff', round: true })
      label.scale.setScalar(0.06)
      label.position.set(0, 0.0, 0.17)
      group.add(label)
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.14, 12), new THREE.MeshBasicMaterial({ visible: false }))
      hit.position.y = 0.07
      group.add(hit)

      group.traverse((o) => (o.userData.sampleIndex = i))
      this.scene.add(group)
      this.pickables.push(group)
      this.samples.push({ index: i, look, group, ring, badge: null, hover: 0 })
    })
  }

  /** Show the student's current call above a sample so their model stays visible on the bench. */
  setConclusion(i: number, kind: MaterialKind | null) {
    const s = this.samples[i]
    if (!s) return
    if (s.badge) {
      s.group.remove(s.badge)
      s.badge.material.dispose()
      s.badge = null
    }
    if (!kind) return
    const sp = this.textSprite(kind === 'metal' ? 'Metal?' : 'Non-metal?', { size: 56, bg: kind === 'metal' ? '#1d4ed8' : '#b45309', fg: '#ffffff', wide: true })
    sp.scale.set(0.15, 0.05, 1)
    sp.position.set(0, 0.17, 0)
    s.group.add(sp)
    s.badge = sp
  }

  revealLabel(i: number, text: string) {
    const s = this.samples[i]
    if (!s) return
    const sp = this.textSprite(text, { size: 60, bg: '#f4f1e8', fg: '#14161a', wide: true })
    sp.scale.set(0.2, 0.065, 1)
    sp.position.set(0, 0.24, 0)
    s.group.add(sp)
  }

  /* ---------------- tool stations ---------------- */
  private placeTools(tools: MetalsTool[]) {
    const riser = new THREE.Mesh(new THREE.BoxGeometry((tools.length - 1) * TOOL_SPACING + 0.5, RISER_H, 0.22), new THREE.MeshStandardMaterial({ color: 0x2a303b, roughness: 0.45, metalness: 0.2 }))
    riser.position.set(0, BENCH_Y + RISER_H / 2, TOOL_Z)
    riser.castShadow = true
    riser.receiveShadow = true
    this.scene.add(riser)

    const span = (tools.length - 1) * TOOL_SPACING
    tools.forEach((tool, i) => {
      const stationPos = V(-span / 2 + i * TOOL_SPACING, BENCH_Y + RISER_H, TOOL_Z)
      const station = new THREE.Group()
      station.position.copy(stationPos)
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.105, 0.01, 36), new THREE.MeshStandardMaterial({ color: 0x1b1f27, roughness: 0.4, metalness: 0.4 }))
      pad.position.y = 0.005
      const padRing = new THREE.Mesh(new THREE.RingGeometry(0.108, 0.125, 48), new THREE.MeshBasicMaterial({ color: 0x8ab4ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }))
      padRing.rotation.x = -Math.PI / 2
      padRing.position.y = 0.012
      padRing.name = 'padRing'
      const label = this.textSprite(tool.name, { size: 50, bg: '#f4f1e8', fg: '#14161a', wide: true })
      label.scale.set(0.2, 0.065, 1)
      label.position.set(0, 0.3, 0.02)
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 10), new THREE.MeshBasicMaterial({ visible: false }))
      hit.position.y = 0.15
      station.add(pad, padRing, label, hit)

      const obj: ToolObj = { id: tool.id, group: new THREE.Group(), station, pad, home: stationPos.clone().setY(stationPos.y + 0.01), homeRot: new THREE.Euler(), hover: 0, active: false }
      const prop = this.buildProp(tool.id, obj)
      prop.position.copy(obj.home)
      obj.group = prop
      for (const g of [station, prop]) {
        g.traverse((o) => {
          o.userData.toolId = tool.id
          if (o instanceof THREE.Mesh && o !== hit) o.castShadow = true
        })
        this.scene.add(g)
        this.pickables.push(g)
      }
      this.tools[tool.id] = obj
    })
  }

  private mat(color: number, metalness = 0.6, roughness = 0.4) {
    return new THREE.MeshStandardMaterial({ color, metalness, roughness })
  }

  private burner(obj: ToolObj, parent: THREE.Group) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.015, 24), this.mat(0x30343b))
    body.position.y = 0.008
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.085, 16), this.mat(0xb8bcc4, 0.9, 0.25))
    stem.position.y = 0.055
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.012, 0.014, 16), this.mat(0x30343b))
    collar.position.y = 0.105
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.05, 14), new THREE.MeshBasicMaterial({ color: 0x4fa6ff, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }))
    flame.position.y = 0.14
    flame.visible = false
    obj.flame = flame
    parent.add(body, stem, collar, flame)
  }

  private buildProp(id: string, obj: ToolObj): THREE.Group {
    const g = new THREE.Group()
    switch (id) {
      case 'hammer': {
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.15, 12), this.mat(0x7a4b25, 0, 0.7))
        handle.position.y = 0.075
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.03), this.mat(0x9aa0a8, 0.95, 0.25))
        head.position.y = 0.15
        g.add(handle, head)
        break
      }
      case 'wire': {
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.07), this.mat(0x3b4048))
        base.position.y = 0.01
        const die = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.07), this.mat(0xb8bcc4, 0.9, 0.3))
        die.position.set(0.02, 0.055, 0)
        const spool = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.012, 10, 24), this.mat(0xb87333, 0.9, 0.3))
        spool.position.set(-0.03, 0.05, 0)
        spool.rotation.y = Math.PI / 2
        g.add(base, die, spool)
        break
      }
      case 'tap': {
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.2, 10), this.mat(0xc9ced6, 1, 0.2))
        rod.position.y = 0.1
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.013, 14, 10), this.mat(0xc9ced6, 1, 0.2))
        ball.position.y = 0.0
        g.add(rod, ball)
        break
      }
      case 'circuit': {
        const battery = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.04), this.mat(0x1f6feb, 0.2, 0.5))
        battery.position.y = 0.02
        const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.06, 8), this.mat(0x9aa0a8))
        stalk.position.set(0, 0.07, 0)
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.022, 20, 14), new THREE.MeshStandardMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.55, roughness: 0.05, emissive: 0xffc933, emissiveIntensity: 0 }))
        bulb.position.set(0, 0.12, 0)
        obj.bulb = bulb
        g.add(battery, stalk, bulb)
        break
      }
      case 'heat':
      case 'oxygen': {
        this.burner(obj, g)
        break
      }
      case 'water': {
        const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.065, 0.13, 32, 1, true), new THREE.MeshPhysicalMaterial({ color: 0xe8f0ff, transparent: true, opacity: 0.22, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false }))
        glass.position.y = 0.065
        glass.renderOrder = 2
        const water = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.06, 0.09, 28), new THREE.MeshPhysicalMaterial({ color: 0x4aa8ff, transparent: true, opacity: 0.5, roughness: 0.08, depthWrite: false }))
        water.position.y = 0.047
        water.renderOrder = 1
        obj.water = water
        g.add(glass, water)
        break
      }
    }
    return g
  }

  setActiveTool(id: string | null) {
    for (const t of Object.values(this.tools)) t.active = t.id === id
  }

  /* ---------------- text sprites ---------------- */
  private textSprite(text: string, o: { size: number; bg: string; fg: string; round?: boolean; wide?: boolean }): THREE.Sprite {
    const w = o.wide ? 512 : 192
    const h = o.wide ? 168 : 192
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')!
    ctx.fillStyle = o.bg
    ctx.beginPath()
    if (o.round) ctx.arc(w / 2, h / 2, h / 2 - 4, 0, Math.PI * 2)
    else ctx.roundRect(4, 4, w - 8, h - 8, 28)
    ctx.fill()
    if (o.round) {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'
      ctx.lineWidth = 6
      ctx.stroke()
    }
    ctx.fillStyle = o.fg
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    let size = o.size
    ctx.font = `700 ${size}px Figtree, system-ui, sans-serif`
    while (ctx.measureText(text).width > w - 36 && size > 20) {
      size -= 4
      ctx.font = `700 ${size}px Figtree, system-ui, sans-serif`
    }
    ctx.fillText(text, w / 2, h / 2 + 3)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
    sprite.renderOrder = 5
    return sprite
  }

  /* ---------------- camera ---------------- */
  setInsets(i: { left: number; right: number; top: number; bottom: number }) {
    this.insetsTarget = { ...i }
    this.updateDefaultFraming()
    if (!this.focusCustom && !this.userMoved) this.focusing = true
  }

  private updateDefaultFraming() {
    const W = this.canvas.clientWidth || window.innerWidth
    const H = this.canvas.clientHeight || window.innerHeight
    const freeW = Math.max(240, W - this.insetsTarget.left - this.insetsTarget.right)
    const freeH = Math.max(200, H - this.insetsTarget.top - this.insetsTarget.bottom)
    const vfov = (this.camera.fov * Math.PI) / 180
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (freeW / freeH))
    const d = Math.min(4.6, Math.max(1.3, 1.55 / Math.tan(hfov / 2), 0.72 / Math.tan(vfov / 2)))
    const dir = V(0, 0.5, 1.5).normalize()
    this.defaultTarget.set(0, 1.08, -0.04)
    this.defaultPos.copy(this.defaultTarget).addScaledVector(dir, d)
  }

  private applyInsets(dt: number) {
    const k = 1 - Math.pow(0.001, dt)
    const a = this.insets
    const b = this.insetsTarget
    a.left += (b.left - a.left) * k
    a.right += (b.right - a.right) * k
    a.top += (b.top - a.top) * k
    a.bottom += (b.bottom - a.bottom) * k
    const W = this.canvas.clientWidth || window.innerWidth
    const H = this.canvas.clientHeight || window.innerHeight
    const cx = (a.left + (W - a.right)) / 2
    const cy = (a.top + (H - a.bottom)) / 2
    this.camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H)
  }

  focusSample(i: number | null) {
    this.focusCustom = i !== null
    if (i === null) {
      this.focusTarget.copy(this.defaultTarget)
      this.focusPos.copy(this.defaultPos)
    } else {
      const s = this.samples[i]
      this.focusTarget.set(s.group.position.x, BENCH_Y + 0.07, SAMPLE_Z)
      this.focusPos.set(s.group.position.x * 0.5, BENCH_Y + 0.4, SAMPLE_Z + 0.95)
    }
    this.focusing = true
    this.userMoved = i !== null
  }

  private focusArena() {
    this.focusCustom = true
    this.focusTarget.set(ARENA.x, BENCH_Y + 0.1, ARENA.z - 0.02)
    this.focusPos.set(0, BENCH_Y + 0.42, ARENA.z + 0.78)
    this.focusing = true
    this.userMoved = true
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

  private burst(at: THREE.Vector3, n: number, o: { color: number; size?: number; speed?: number; life?: number; gravity?: number; up?: number; spread?: number }) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(o.size ?? 0.004, 6, 5), new THREE.MeshBasicMaterial({ color: o.color, transparent: true, opacity: 0.9, depthWrite: false }))
      m.position.copy(at)
      const sp = o.speed ?? 0.5
      const a = Math.random() * Math.PI * 2
      const spread = o.spread ?? 1
      this.scene.add(m)
      this.particles.push({ mesh: m, vel: V(Math.cos(a) * sp * Math.random() * spread, (o.up ?? 0.6) * sp * (0.5 + Math.random()), Math.sin(a) * sp * Math.random() * spread), life: 0, max: (o.life ?? 0.8) * (0.7 + Math.random() * 0.6), gravity: o.gravity ?? 2, floor: BENCH_Y })
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

  private moveTool(t: ToolObj, to: THREE.Vector3, rot: THREE.Euler, ms = 520): Promise<void> {
    const from = t.group.position.clone()
    const r0 = t.group.rotation.clone()
    return this.animate(ms, (k) => {
      t.group.position.lerpVectors(from, to, k)
      t.group.rotation.set(r0.x + (rot.x - r0.x) * k, r0.y + (rot.y - r0.y) * k, r0.z + (rot.z - r0.z) * k)
    }, easeInOut)
  }
  private sendHome(t: ToolObj) {
    return this.moveTool(t, t.home, t.homeRot, 480)
  }

  /* ---------------- tests ---------------- */
  /** Runs the animation for one test on a fresh piece of sample i. Resolves when the result has been shown. */
  async play(toolId: string, sampleIndex: number, res: PlayResult): Promise<void> {
    const tool = this.tools[toolId]
    const s = this.samples[sampleIndex]
    if (!tool || !s || this.busy) return
    this.busy = true
    const { group: piece, mats } = makePiece(s.look)
    piece.position.copy(ARENA)
    piece.scale.setScalar(1.35)
    this.temp(piece)
    this.focusArena()
    sound.click()
    try {
      await this.wait(450)
      switch (toolId) {
        case 'hammer': await this.hammer(tool, piece, res.outcome); break
        case 'wire': await this.wire(piece, res.outcome); break
        case 'tap': await this.tap(tool, piece, res.outcome); break
        case 'circuit': await this.circuit(tool, piece, res.outcome); break
        case 'heat': await this.heat(tool, piece, res.outcome); break
        case 'oxygen': await this.oxygen(tool, piece, mats, res); break
        case 'water': await this.water(tool, piece, res.outcome); break
      }
      await this.wait(700)
    } finally {
      this.clearTemps()
      for (const t of Object.values(this.tools)) if (t.flame) t.flame.visible = false
      if (tool.bulb) (tool.bulb.material as THREE.MeshStandardMaterial).emissiveIntensity = 0
      tool.group.visible = true
      await this.sendHome(tool)
      this.focusSample(null)
      this.userMoved = false
      this.focusCustom = false
      this.focusing = true
      this.busy = false
    }
  }

  private async hammer(t: ToolObj, piece: THREE.Group, outcome: string) {
    const pivot = V(ARENA.x + 0.17, BENCH_Y + 0.03, ARENA.z)
    await this.moveTool(t, pivot, new THREE.Euler(0, 0, 0.55))
    const swing = async () => {
      await this.animate(240, (k) => (t.group.rotation.z = 0.55 + 1.0 * k), easeIn)
      sound.hit()
      this.burst(V(ARENA.x + 0.02, BENCH_Y + 0.05, ARENA.z), 6, { color: 0xdddddd, speed: 0.4, life: 0.4 })
      await this.animate(200, (k) => (t.group.rotation.z = 1.55 - 1.0 * k), easeOut)
    }
    if (outcome === 'flattens') {
      for (let n = 1; n <= 3; n++) {
        await swing()
        const s0 = piece.scale.clone()
        const to = V(1.35 + 0.2 * n, Math.max(0.22, 1.35 - 0.38 * n), 1.35 + 0.2 * n)
        await this.animate(140, (k) => piece.scale.lerpVectors(s0, to, k), easeOut)
      }
    } else if (outcome === 'shatters') {
      await swing()
      sound.crack()
      piece.visible = false
      this.burst(V(ARENA.x, BENCH_Y + 0.04, ARENA.z), 22, { color: 0xb9bcc2, size: 0.006, speed: 0.9, life: 1.1, gravity: 4, up: 1 })
      await this.wait(600)
    } else {
      await swing()
      sound.plop()
      this.burst(V(ARENA.x, BENCH_Y + 0.04, ARENA.z), 16, { color: 0xd4d8de, size: 0.005, speed: 0.6, life: 0.7, gravity: 3 })
      const s0 = piece.scale.clone()
      await this.animate(160, (k) => piece.scale.set(s0.x * (1 + 0.3 * k), s0.y * (1 - 0.4 * k), s0.z * (1 + 0.3 * k)))
      await this.animate(260, (k) => piece.scale.set(s0.x * (1.3 - 0.3 * k), s0.y * (0.6 + 0.4 * k), s0.z * (1.3 - 0.3 * k)))
    }
  }

  private grip(x: number) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.04), this.mat(0x30343b))
    m.position.set(x, BENCH_Y + 0.03, ARENA.z)
    m.castShadow = true
    return this.temp(m)
  }

  private async wire(piece: THREE.Group, outcome: string) {
    const g1 = this.grip(ARENA.x - 0.07)
    const g2 = this.grip(ARENA.x + 0.07)
    await this.wait(250)
    if (outcome === 'draws') {
      await this.animate(1500, (k) => {
        piece.scale.set(1.35 + 4.8 * k, 1.35 - 1.0 * k, 1.35 - 1.0 * k)
        g1.position.x = ARENA.x - 0.07 - 0.2 * k
        g2.position.x = ARENA.x + 0.07 + 0.2 * k
      }, easeInOut)
    } else if (outcome === 'snaps') {
      await this.animate(1000, (k) => {
        piece.scale.set(1.35 + 2.0 * k, 1.35 - 0.6 * k, 1.35 - 0.6 * k)
        g1.position.x = ARENA.x - 0.07 - 0.1 * k
        g2.position.x = ARENA.x + 0.07 + 0.1 * k
      }, easeIn)
      sound.crack()
      piece.visible = false
      const halves = [-1, 1].map((d) => {
        const h = piece.clone()
        h.visible = true
        h.scale.set(1.7, 0.9, 0.9)
        h.position.x = ARENA.x + d * 0.03
        return this.temp(h)
      })
      this.burst(V(ARENA.x, BENCH_Y + 0.04, ARENA.z), 10, { color: 0xffe08a, speed: 0.5, life: 0.4 })
      await this.animate(500, (k) => {
        halves[0].position.x = ARENA.x - 0.03 - 0.08 * k
        halves[1].position.x = ARENA.x + 0.03 + 0.08 * k
        g1.position.x -= 0.002
        g2.position.x += 0.002
      }, easeOut)
    } else {
      await this.animate(500, (k) => {
        g1.position.x = ARENA.x - 0.07 + 0.045 * k
        g2.position.x = ARENA.x + 0.07 - 0.045 * k
        piece.scale.set(1.35 * (1 + 0.3 * k), 1.35 * (1 - 0.5 * k), 1.35 * (1 + 0.3 * k))
      })
      sound.plop()
      this.burst(V(ARENA.x, BENCH_Y + 0.03, ARENA.z), 14, { color: 0xd4d8de, size: 0.005, speed: 0.5, life: 0.6, gravity: 3 })
      await this.wait(500)
    }
  }

  private ripple(at: THREE.Vector3, color: number, n = 3) {
    for (let i = 0; i < n; i++) {
      void this.wait(i * 220).then(() => {
        const ring = this.temp(new THREE.Mesh(new THREE.RingGeometry(0.01, 0.014, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })))
        ring.rotation.x = -Math.PI / 2
        ring.position.copy(at)
        void this.animate(1000, (k) => {
          ring.scale.setScalar(1 + k * 9)
          ;(ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k)
        })
      })
    }
  }

  private async tap(t: ToolObj, piece: THREE.Group, outcome: string) {
    const top = V(ARENA.x, BENCH_Y + 0.2, ARENA.z)
    await this.moveTool(t, top, new THREE.Euler(Math.PI, 0, 0))
    for (let n = 0; n < 2; n++) {
      await this.animate(170, (k) => (t.group.position.y = top.y - 0.15 * k), easeIn)
      if (outcome === 'rings') {
        sound.ring()
        this.ripple(V(ARENA.x, BENCH_Y + 0.07, ARENA.z), 0xbfd7ff)
      } else if (outcome === 'thud') {
        sound.thud()
        piece.scale.multiplyScalar(0.94)
      } else {
        sound.plop()
        this.ripple(V(ARENA.x, BENCH_Y + 0.04, ARENA.z), 0xd4d8de, 2)
      }
      await this.animate(200, (k) => (t.group.position.y = top.y - 0.15 + 0.15 * k), easeOut)
      if (n === 0) await this.wait(outcome === 'rings' ? 700 : 200)
    }
    await this.wait(outcome === 'rings' ? 900 : 250)
  }

  private async circuit(t: ToolObj, piece: THREE.Group, outcome: string) {
    await this.moveTool(t, V(ARENA.x - 0.2, BENCH_Y, ARENA.z), new THREE.Euler(0, 0, 0))
    const tips = [-0.045, 0.045].map((dx) => {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.006, 0.12, 8), this.mat(0xc9ced6, 1, 0.2))
      p.position.set(ARENA.x + dx, BENCH_Y + 0.25, ARENA.z)
      return this.temp(p)
    })
    await this.animate(600, (k) => tips.forEach((p) => (p.position.y = BENCH_Y + 0.25 - 0.17 * k)), easeIn)
    const wire = (a: THREE.Vector3, b: THREE.Vector3) => {
      const mid = a.clone().lerp(b, 0.5)
      mid.y += 0.05
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b)
      return this.temp(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(18)), new THREE.LineBasicMaterial({ color: 0xe5e7eb })))
    }
    wire(V(ARENA.x - 0.2, BENCH_Y + 0.04, ARENA.z), V(ARENA.x - 0.045, BENCH_Y + 0.25, ARENA.z))
    wire(V(ARENA.x + 0.045, BENCH_Y + 0.25, ARENA.z), V(ARENA.x - 0.2, BENCH_Y + 0.14, ARENA.z))
    await this.wait(300)
    if (outcome === 'glows' && t.bulb) {
      const light = this.temp(new THREE.PointLight(0xffd36b, 0, 1.2))
      light.position.set(ARENA.x - 0.2, BENCH_Y + 0.14, ARENA.z)
      sound.spark()
      await this.animate(500, (k) => {
        ;(t.bulb!.material as THREE.MeshStandardMaterial).emissiveIntensity = 3.2 * k
        light.intensity = 2.4 * k
      })
      await this.wait(900)
    } else {
      await this.wait(1100)
    }
  }

  private flame(t: ToolObj, color: number, scale: THREE.Vector3, light = 0) {
    if (!t.flame) return null
    t.flame.visible = true
    ;(t.flame.material as THREE.MeshBasicMaterial).color.setHex(color)
    t.flame.scale.copy(scale)
    if (!light) return null
    const l = this.temp(new THREE.PointLight(color, light, 1.4))
    return l
  }

  private async heat(t: ToolObj, piece: THREE.Group, outcome: string) {
    // The sample becomes a strip held over the flame, with a wax bead at the far end.
    await this.moveTool(t, V(ARENA.x - 0.1, BENCH_Y, ARENA.z), new THREE.Euler(0, 0, 0))
    piece.position.set(ARENA.x, BENCH_Y + 0.17, ARENA.z)
    piece.scale.set(3.4, 0.5, 0.8)
    const clamp = this.temp(new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.17, 0.012), this.mat(0x30343b)))
    clamp.position.set(ARENA.x + 0.2, BENCH_Y + 0.085, ARENA.z)
    const bead = this.temp(new THREE.Mesh(new THREE.SphereGeometry(0.012, 14, 10), new THREE.MeshStandardMaterial({ color: 0xfff4d6, roughness: 0.5 })))
    bead.position.set(ARENA.x + 0.15, BENCH_Y + 0.215, ARENA.z)
    this.flame(t, 0x4fa6ff, V(1.2, 1.6, 1.2))
    sound.whoosh(0.7)
    await this.wait(500)
    if (outcome === 'conducts_well') {
      await this.animate(1300, (k) => {
        bead.scale.set(1 + 0.25 * k, 1 - 0.4 * k, 1 + 0.25 * k)
        bead.position.y = BENCH_Y + 0.215 - 0.01 * k
        const mats = (piece.children[0] as THREE.Mesh | undefined)?.material
        if (mats && !Array.isArray(mats) && 'emissive' in mats) (mats as THREE.MeshStandardMaterial).emissive.setRGB(0.4 * k, 0.1 * k, 0)
      })
      sound.plop()
      const y0 = bead.position.y
      await this.animate(380, (k) => (bead.position.y = y0 - (y0 - (BENCH_Y + 0.012)) * k * k), easeIn)
      await this.wait(300)
    } else {
      await this.animate(1800, (k) => {
        bead.scale.set(1 + 0.04 * Math.sin(k * 20), 1, 1)
      })
    }
    if (t.flame) t.flame.visible = false
  }

  private async oxygen(t: ToolObj, piece: THREE.Group, mats: THREE.MeshStandardMaterial[], res: PlayResult) {
    await this.moveTool(t, V(ARENA.x, BENCH_Y, ARENA.z), new THREE.Euler(0, 0, 0))
    piece.position.set(ARENA.x, BENCH_Y + 0.15, ARENA.z)
    piece.scale.setScalar(0.9)
    const tongs = this.temp(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.006, 0.006), this.mat(0x30343b)))
    tongs.position.set(ARENA.x + 0.1, BENCH_Y + 0.15, ARENA.z)
    this.flame(t, 0x4fa6ff, V(1.1, 1.3, 1.1))
    sound.whoosh(0.8)
    await this.wait(600)
    const mat = mats[0]
    const o = res.outcome
    if (o === 'burns_bright') {
      const l = this.flame(t, 0xfff6d6, V(2.6, 3.6, 2.6), 8)
      sound.whoosh(1.2)
      sound.spark()
      this.burst(V(ARENA.x, BENCH_Y + 0.17, ARENA.z), 40, { color: 0xffffff, size: 0.003, speed: 0.9, life: 0.7, gravity: 1.2, up: 1.1 })
      await this.animate(1400, (k) => {
        if (l) l.intensity = 8 * (0.6 + 0.4 * Math.sin(k * 40))
        piece.scale.setScalar(0.9 * (1 - 0.7 * k))
      })
      if (l) l.intensity = 0
      const ash = this.temp(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.004, 20), new THREE.MeshStandardMaterial({ color: 0xf1f1ee, roughness: 0.9 })))
      ash.position.set(ARENA.x, BENCH_Y + 0.003, ARENA.z)
      piece.visible = false
    } else if (o === 'burns') {
      this.flame(t, 0xffb347, V(1.5, 2, 1.5), 2)
      sound.whoosh(1)
      await this.animate(1500, (k) => {
        piece.scale.setScalar(0.9 * (1 - 0.35 * k))
        mat.color.lerp(new THREE.Color(0x1a1a1a), k * 0.08)
      })
    } else if (o === 'tarnishes') {
      this.flame(t, 0x4fa6ff, V(1.2, 1.5, 1.2))
      await this.animate(1500, (k) => {
        mat.emissive.setRGB(0.9 * Math.sin(k * Math.PI), 0.25 * Math.sin(k * Math.PI), 0)
        mat.color.lerp(new THREE.Color(0x2a211c), k * 0.1)
        mat.metalness = 0.9 * (1 - k * 0.7)
      })
    } else {
      this.flame(t, 0x4fa6ff, V(1.1, 1.3, 1.1))
      await this.wait(1500)
    }
    if (t.flame) t.flame.visible = false

    // What did the oxide do to litmus? A purple strip shows it.
    const strip = this.temp(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.002, 0.016), new THREE.MeshStandardMaterial({ color: 0x9333ea, roughness: 0.8 })))
    strip.position.set(ARENA.x + 0.17, BENCH_Y + 0.004, ARENA.z + 0.05)
    await this.animate(600, (k) => (strip.position.x = ARENA.x + 0.17 - 0.12 * k), easeInOut)
    const lit = res.litmus
    if (lit === 'blue_basic' || lit === 'red_acidic') {
      const to = new THREE.Color(lit === 'blue_basic' ? 0x2563eb : 0xdc2626)
      const from = (strip.material as THREE.MeshStandardMaterial).color.clone()
      await this.animate(900, (k) => (strip.material as THREE.MeshStandardMaterial).color.copy(from).lerp(to, k))
    } else {
      await this.wait(700)
    }
  }

  private async water(t: ToolObj, piece: THREE.Group, outcome: string) {
    await this.moveTool(t, V(ARENA.x, BENCH_Y, ARENA.z), new THREE.Euler(0, 0, 0))
    piece.scale.setScalar(0.7)
    piece.position.set(ARENA.x, BENCH_Y + 0.26, ARENA.z)
    await this.animate(520, (k) => (piece.position.y = BENCH_Y + 0.26 - 0.2 * k * k), easeIn)
    sound.plop()
    this.burst(V(ARENA.x, BENCH_Y + 0.1, ARENA.z), 14, { color: 0xbfe0ff, size: 0.004, speed: 0.5, life: 0.5, gravity: 3 })
    const bubbles = (n: number, ms: number) => {
      for (let i = 0; i < n; i++) {
        void this.wait((ms / n) * i).then(() => {
          const a = Math.random() * Math.PI * 2
          const d = Math.random() * 0.045
          this.burst(V(ARENA.x + Math.cos(a) * d, BENCH_Y + 0.05, ARENA.z + Math.sin(a) * d), 1, { color: 0xe8f4ff, size: 0.004 + Math.random() * 0.004, speed: 0.12, life: 1.1, gravity: -0.4, up: 1, spread: 0.3 })
        })
      }
    }
    if (outcome === 'violent') {
      sound.fizz(1.8)
      bubbles(60, 1500)
      const l = this.temp(new THREE.PointLight(0xffa24a, 0, 1.5))
      l.position.set(ARENA.x, BENCH_Y + 0.14, ARENA.z)
      await this.animate(1700, (k) => {
        piece.position.set(ARENA.x + Math.sin(k * 30) * 0.02, BENCH_Y + 0.12 + Math.sin(k * 14) * 0.015, ARENA.z + Math.cos(k * 26) * 0.02)
        piece.scale.setScalar(0.7 * Math.max(0.05, 1 - k))
        l.intensity = k > 0.1 && k < 0.5 ? 5 : 0.4
      })
      l.intensity = 0
      piece.visible = false
    } else if (outcome === 'slow_bubbles') {
      sound.fizz(0.9)
      bubbles(9, 1800)
      await this.animate(1800, (k) => {
        piece.position.y = BENCH_Y + 0.06 - 0.02 * k
        piece.scale.setScalar(0.7 * (1 - 0.18 * k))
      })
    } else {
      await this.animate(900, (k) => (piece.position.y = BENCH_Y + 0.06 - 0.04 * k))
      await this.wait(500)
    }
  }

  /* ---------------- input ---------------- */
  private setPointer(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect()
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
  }

  private pick(): { sample: number | null; tool: string | null } {
    this.raycaster.setFromCamera(this.pointer, this.camera)
    for (const h of this.raycaster.intersectObjects(this.pickables, true)) {
      if (h.object instanceof THREE.Sprite) continue
      if (typeof h.object.userData.sampleIndex === 'number') return { sample: h.object.userData.sampleIndex, tool: null }
      if (typeof h.object.userData.toolId === 'string') return { sample: null, tool: h.object.userData.toolId }
    }
    return { sample: null, tool: null }
  }

  private onPointerMove = (e: PointerEvent) => {
    this.setPointer(e)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const p = new THREE.Vector3()
    if (this.raycaster.ray.intersectPlane(this.benchPlane, p)) this.handPoint.copy(p)
    const hit = this.busy ? { sample: null, tool: null } : this.pick()
    this.hoveredSample = hit.sample ?? -1
    this.hoveredTool = hit.tool ?? ''
    this.canvas.style.cursor = hit.sample !== null || hit.tool ? 'pointer' : e.buttons ? 'grabbing' : 'grab'
  }
  private onPointerLeave = () => {
    this.hoveredSample = -1
    this.hoveredTool = ''
    this.pointer.set(10, 10)
  }
  private onPointerDown = (e: PointerEvent) => {
    this.downAt = { x: e.clientX, y: e.clientY, t: performance.now() }
  }
  private onPointerUp = (e: PointerEvent) => {
    const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y)
    if (moved > 6 || performance.now() - this.downAt.t > 600 || this.busy) return
    this.setPointer(e)
    const hit = this.pick()
    if (hit.sample !== null) this.events.onSampleClick(hit.sample)
    else if (hit.tool) this.events.onToolClick(hit.tool)
  }

  /* ---------------- loop ---------------- */
  private resize() {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.fov = w / h < 1 ? 58 : 38
    this.camera.updateProjectionMatrix()
    this.updateDefaultFraming()
    if (!this.userMoved) this.camera.position.copy(this.defaultPos)
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

    if (this.focusing) {
      if (!this.focusCustom) {
        this.focusTarget.copy(this.defaultTarget)
        this.focusPos.copy(this.defaultPos)
      }
      const k = 1 - Math.pow(0.0015, dt)
      this.controls.target.lerp(this.focusTarget, k)
      this.camera.position.lerp(this.focusPos, k)
      if (this.focusCustom && this.controls.target.distanceTo(this.focusTarget) < 0.002) this.focusing = false
    }
    this.applyInsets(dt)
    this.controls.update()

    for (const s of this.samples) {
      const target = this.hoveredSample === s.index ? 1 : 0
      s.hover += (target - s.hover) * Math.min(1, dt * 12)
      ;(s.ring.material as THREE.MeshBasicMaterial).opacity = s.hover * 0.85
    }
    for (const t of Object.values(this.tools)) {
      const target = this.hoveredTool === t.id ? 1 : 0
      t.hover += (target - t.hover) * Math.min(1, dt * 12)
      const ring = t.station.getObjectByName('padRing') as THREE.Mesh | undefined
      if (ring) {
        const m = ring.material as THREE.MeshBasicMaterial
        m.opacity = Math.max(t.hover * 0.6, t.active ? 1 : 0)
        m.color.set(t.active ? 0xffd166 : 0x8ab4ff)
      }
      if (t.flame?.visible) {
        const f = 1 + Math.sin(time * 28 + t.id.length) * 0.08
        t.flame.scale.y *= f / (t.flame.userData.f ?? 1)
        t.flame.userData.f = f
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.life += dt
      p.vel.y -= p.gravity * dt
      p.mesh.position.addScaledVector(p.vel, dt)
      if (p.mesh.position.y < p.floor && p.gravity > 0) {
        p.mesh.position.y = p.floor
        p.vel.multiplyScalar(0.3)
        p.vel.y = Math.abs(p.vel.y) * 0.2
      }
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
        a[i + 1] += Math.sin(time * 0.4 + i) * 0.00008
        a[i] += Math.cos(time * 0.3 + i) * 0.00006
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
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave)
    this.controls.dispose()
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Line) {
        o.geometry.dispose()
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose()
      }
    })
    this.renderer.dispose()
  }
}
