import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { SoundLessonContract, SoundTool } from '@mmaxr/schema'
import { acoustics } from './soundAudio'
import { sound } from './sound'

/*
 * The sound sandbox, three benches in one scene:
 *  - wave:  a ripple tank driven by a tuning fork (tuning-fork.glb), wired to an oscilloscope (oscilloscope.glb) whose
 *           screen is drawn live; a volume icon (dezyne_3d-volume-242.glb) swells with the amplitude.
 *  - echo:  an open field with a distant cliff, and a small hard room. Sound is shown as expanding rings.
 *  - sonar: a ship over the sea; the pulse goes down and its echo comes back, timed for real.
 * Everything runs in real time so what the student times with the stopwatch is what the lab says it is.
 */
const BENCH_Y = 0.9
const TANK_W = 1.0
const TANK_D = 0.7
const TANK_Z = 0
const TANK_X = -0.3
const SCOPE_X = 0.95
const SCOPE_SCALE = 1.5
const CLIFF_DIST = 38
const ROOM = { w: 6, h: 3.2, d: 8 }

export type Stage = SoundTool
export type Place = 'field' | 'room'

export interface WaveSettings {
  freq: number
  /** Millimetres. */
  amp: number
  /** m/s in the tank. */
  speed: number
}

interface Ring {
  mesh: THREE.Mesh
  t0: number
  dur: number
  r0: number
  r1: number
  op: number
  /** Called once when the ring has finished. */
  done?: () => void
}

type Ease = (t: number) => number
const easeInOut: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

const RIPPLE_VERT = /* glsl */ `
uniform float uTime; uniform float uK; uniform float uW; uniform float uAmp; uniform vec2 uSrc; uniform vec2 uHalf;
varying vec3 vN; varying float vH; varying vec2 vUv;
void main(){
  vec2 p = position.xy;
  vec2 d = p - uSrc;
  float r = length(d);
  float edge = smoothstep(0.0, 0.07, uHalf.x - abs(p.x)) * smoothstep(0.0, 0.07, uHalf.y - abs(p.y));
  float decay = edge / sqrt(1.0 + r * 9.0);
  float ph = uK * r - uW * uTime;
  float h = uAmp * decay * sin(ph);
  float slope = uAmp * decay * uK * cos(ph);
  vec2 dir = r > 1e-4 ? d / r : vec2(0.0);
  vN = normalize(vec3(-dir * slope * 0.9, 1.0));
  vH = h;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, h, 1.0);
}`
const RIPPLE_FRAG = /* glsl */ `
varying vec3 vN; varying float vH; varying vec2 vUv;
void main(){
  vec3 L = normalize(vec3(0.5, 0.35, 1.0));
  float lit = dot(normalize(vN), L);
  vec3 deep = vec3(0.05, 0.28, 0.42);
  vec3 crest = vec3(0.65, 0.92, 1.0);
  float k = clamp((lit - 0.82) * 6.5, 0.0, 1.0);
  vec3 col = mix(deep, crest, k);
  col += vec3(0.05, 0.1, 0.12) * (1.0 - vUv.y);
  gl_FragColor = vec4(col, 0.94);
}`

export class SoundScene {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  private readonly clock = new THREE.Clock()
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2(10, 10)
  private readonly handPoint = new THREE.Vector3(0, BENCH_Y, 0.2)
  private readonly benchPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BENCH_Y)
  private tweens = new Set<(dt: number) => boolean>()
  private viewTween: ((dt: number) => boolean) | null = null
  private insets = { left: 0, right: 0, top: 0, bottom: 0 }
  private stage: Stage = 'wave'
  private place: Place = 'field'
  private disposed = false
  private busy = false

  private waveGroup = new THREE.Group()
  private echoGroup = new THREE.Group()
  private fieldGroup = new THREE.Group()
  private roomGroup = new THREE.Group()
  private sonarGroup = new THREE.Group()
  private rings: Ring[] = []

  /* wave */
  private rippleMat!: THREE.ShaderMaterial
  private fork: THREE.Object3D | null = null
  private forkBase = new THREE.Vector3()
  private speaker: THREE.Object3D | null = null
  private scope: THREE.Object3D | null = null
  private scopeCanvas = document.createElement('canvas')
  private scopeTex: THREE.CanvasTexture
  private history: { t: number; g: number; w: number }[] = []
  private phase = 0
  private settings: WaveSettings = { freq: 3, amp: 3, speed: 0.24 }
  private running = true

  /* echo */
  private avatar = new THREE.Group()
  private cliff!: THREE.Mesh
  private emitUntil = 0
  private emitScale = 1
  private echoSpeaker: THREE.Object3D | null = null

  /* sonar */
  private ship = new THREE.Group()
  private seabed!: THREE.Mesh
  private wreck = new THREE.Group()
  private murk!: THREE.Mesh
  private sonarSpeaker: THREE.Object3D | null = null
  private depthVis = 1.6
  private target: 'floor' | 'wreck' = 'floor'
  private readonly onResize = () => this.resize()

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.95
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.xr.enabled = true

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 400)
    this.camera.position.set(0, 1.9, 2.2)
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.enablePan = false
    this.controls.rotateSpeed = 0.55
    this.controls.addEventListener('start', () => (this.viewTween = null))

    this.scopeCanvas.width = 512
    this.scopeCanvas.height = 320
    this.scopeTex = new THREE.CanvasTexture(this.scopeCanvas)
    this.scopeTex.colorSpace = THREE.SRGBColorSpace

    this.buildEnvironment()
    this.buildWave()
    this.buildEcho()
    this.buildSonar()
    this.scene.add(this.waveGroup, this.echoGroup, this.sonarGroup)
    this.setStage('wave', false)
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

  /* ================= shared ================= */
  private buildEnvironment() {
    const scene = this.scene
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.5
    scene.add(new THREE.HemisphereLight(0xcfe1ff, 0x1c1812, 0.6))
    const key = new THREE.DirectionalLight(0xfff4e0, 1.6)
    key.position.set(2.5, 6, 3)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.left = -4
    key.shadow.camera.right = 4
    key.shadow.camera.top = 4
    key.shadow.camera.bottom = -4
    key.shadow.bias = -0.0005
    scene.add(key)
  }

  /* ================= wave stage ================= */
  private buildWave() {
    const g = this.waveGroup
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.7 }))
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(14, 5), new THREE.MeshStandardMaterial({ color: 0x232833, roughness: 0.9 }))
    wall.position.set(0, 2.5, -1.4)
    wall.receiveShadow = true
    const top = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.05, 1.1), new THREE.MeshStandardMaterial({ color: 0x2b303b, roughness: 0.4, metalness: 0.15 }))
    top.position.set(0, BENCH_Y - 0.025, 0)
    top.castShadow = true
    top.receiveShadow = true
    g.add(floor, wall, top)
    // legs and a lower shelf, so the bench stands on the floor
    const leg = new THREE.MeshStandardMaterial({ color: 0x3a404d, metalness: 0.5, roughness: 0.5 })
    for (const [x, z] of [[-1.5, -0.5], [1.5, -0.5], [-1.5, 0.5], [1.5, 0.5]] as const) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.07, BENCH_Y - 0.05, 0.07), leg)
      l.position.set(x, (BENCH_Y - 0.05) / 2, z)
      l.castShadow = true
      g.add(l)
    }
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.03, 0.9), leg)
    shelf.position.set(0, 0.25, 0)
    g.add(shelf)

    // The ripple tank: a white tray, a light water surface driven by the shader.
    const tray = new THREE.Mesh(new THREE.BoxGeometry(TANK_W + 0.08, 0.05, TANK_D + 0.08), new THREE.MeshStandardMaterial({ color: 0xe8edf2, roughness: 0.35 }))
    tray.position.set(TANK_X, BENCH_Y + 0.025, TANK_Z)
    tray.castShadow = true
    tray.receiveShadow = true
    this.rippleMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uK: { value: 100 }, uW: { value: 20 }, uAmp: { value: 0.003 }, uSrc: { value: new THREE.Vector2(-0.18, 0) }, uHalf: { value: new THREE.Vector2(TANK_W / 2, TANK_D / 2) } },
      vertexShader: RIPPLE_VERT,
      fragmentShader: RIPPLE_FRAG,
      transparent: true,
    })
    const water = new THREE.Mesh(new THREE.PlaneGeometry(TANK_W, TANK_D, 220, 154), this.rippleMat)
    water.rotation.x = -Math.PI / 2
    water.position.set(TANK_X, BENCH_Y + 0.052, TANK_Z)
    // A ruler along the front edge of the tank, so wavelengths can be read.
    const rulerMat = new THREE.MeshBasicMaterial({ color: 0x1a2330 })
    const ruler = new THREE.Mesh(new THREE.BoxGeometry(TANK_W, 0.002, 0.02), new THREE.MeshStandardMaterial({ color: 0xf2f4f6 }))
    ruler.position.set(TANK_X, BENCH_Y + 0.052, TANK_D / 2 + 0.002)
    g.add(ruler)
    for (let i = 0; i <= 100; i += 1) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.003, i % 10 === 0 ? 0.018 : i % 5 === 0 ? 0.013 : 0.008), rulerMat)
      t.position.set(TANK_X - TANK_W / 2 + i * 0.01, BENCH_Y + 0.054, TANK_D / 2 + 0.002)
      g.add(t)
    }
    g.add(tray, water)
    const hint = this.makeLabel('Ripple tank (ruler: 1 cm per tick)', 0.36)
    hint.position.set(TANK_X, BENCH_Y + 0.0, TANK_D / 2 + 0.1)
    g.add(hint)
  }

  private makeLabel(text: string, width: number): THREE.Sprite {
    const c = document.createElement('canvas')
    c.width = 640
    c.height = 96
    const ctx = c.getContext('2d')!
    ctx.font = '600 44px Inter, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const w = ctx.measureText(text).width + 40
    ctx.fillStyle = 'rgba(8,10,16,0.55)'
    ctx.beginPath()
    ctx.roundRect((c.width - w) / 2, 10, w, 76, 20)
    ctx.fill()
    ctx.fillStyle = '#e6ebf5'
    ctx.fillText(text, c.width / 2, 49)
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false, depthWrite: false }))
    s.scale.set(width * 2, width * 0.3, 1)
    s.renderOrder = 20
    return s
  }

  /* ================= echo stage ================= */
  private buildEcho() {
    // Open field: a big ground, a far cliff, an avatar.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x3f5a35, roughness: 0.95 }))
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    this.cliff = new THREE.Mesh(new THREE.BoxGeometry(60, 12, 3), new THREE.MeshStandardMaterial({ color: 0x77695a, roughness: 0.95, flatShading: true }))
    this.cliff.position.set(0, 6, -CLIFF_DIST)
    this.cliff.castShadow = true
    this.fieldGroup.add(ground, this.cliff)
    for (let i = 0; i < 18; i++) {
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6 + Math.random() * 1.4, 0), new THREE.MeshStandardMaterial({ color: 0x6d6254, roughness: 1, flatShading: true }))
      rock.position.set(-30 + Math.random() * 60, 0.3 + Math.random() * 0.6, -CLIFF_DIST + 2.2 + Math.random() * 3)
      rock.castShadow = true
      this.fieldGroup.add(rock)
    }
    // Small room: hard tiled walls all round.
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: 0.25, metalness: 0.05, side: THREE.BackSide })
    const box = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w, ROOM.h, ROOM.d), wallMat)
    box.position.set(0, ROOM.h / 2, -ROOM.d / 2 + 1)
    box.receiveShadow = true
    this.roomGroup.add(box)
    const lamp = new THREE.PointLight(0xfff0d8, 8, 12)
    lamp.position.set(0, ROOM.h - 0.3, -2)
    this.roomGroup.add(lamp)
    // avatar
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.9, 6, 14), new THREE.MeshStandardMaterial({ color: 0x3b6fd0, roughness: 0.6 }))
    body.position.y = 0.75
    body.castShadow = true
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 16), new THREE.MeshStandardMaterial({ color: 0xe3b78f, roughness: 0.6 }))
    head.position.y = 1.5
    head.castShadow = true
    this.avatar.add(body, head)
    this.echoGroup.add(this.fieldGroup, this.roomGroup, this.avatar)
  }

  /* ================= sonar stage ================= */
  private buildSonar() {
    const g = this.sonarGroup
    // the sea in cross-section
    const sea = new THREE.Mesh(new THREE.BoxGeometry(14, 6, 2.4), new THREE.MeshStandardMaterial({ color: 0x1a6ea8, transparent: true, opacity: 0.45, roughness: 0.2, depthWrite: false }))
    sea.position.set(0, -3, 0)
    const surface = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.4), new THREE.MeshStandardMaterial({ color: 0x4aa3d8, transparent: true, opacity: 0.6, roughness: 0.15, metalness: 0.2 }))
    surface.rotation.x = -Math.PI / 2
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), new THREE.MeshBasicMaterial({ color: 0x9cc7ea }))
    sky.position.set(0, 6, -3)
    // ship
    const hull = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 0.9), new THREE.MeshStandardMaterial({ color: 0x8a2f2f, roughness: 0.6 }))
    hull.position.y = 0.05
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.7), new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.5 }))
    cabin.position.set(-0.4, 0.55, 0)
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 8), new THREE.MeshStandardMaterial({ color: 0xcfd4da }))
    mast.position.set(0.5, 0.7, 0)
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffc83d, metalness: 0.3, roughness: 0.3 }))
    dome.position.set(0, -0.2, 0)
    this.ship.add(hull, cabin, mast, dome)
    this.ship.position.set(0, 0.05, 0)
    // sea floor: lumpy, hidden in murk until the pulse has been sent
    const geo = new THREE.PlaneGeometry(14, 2.4, 56, 10)
    const pos = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 1.3) * 0.12 + Math.sin(pos.getX(i) * 3.7 + 1) * 0.05 + (Math.random() - 0.5) * 0.04)
    geo.computeVertexNormals()
    this.seabed = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x8f7e5e, roughness: 1, flatShading: true }))
    this.seabed.rotation.x = -Math.PI / 2
    this.seabed.receiveShadow = true
    // wreck: a broken hull and mast
    const wh = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.28, 0.5), new THREE.MeshStandardMaterial({ color: 0x4a3f36, roughness: 1, flatShading: true }))
    wh.rotation.z = 0.25
    wh.position.y = 0.15
    const wm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 6), new THREE.MeshStandardMaterial({ color: 0x5b5148 }))
    wm.position.set(0.25, 0.45, 0)
    wm.rotation.z = -0.4
    this.wreck.add(wh, wm)
    this.murk = new THREE.Mesh(new THREE.PlaneGeometry(14, 5), new THREE.MeshBasicMaterial({ color: 0x041626, transparent: true, opacity: 0.93, depthWrite: false }))
    this.murk.position.set(0, -3.5, 1.3)
    this.murk.renderOrder = 5
    g.add(sky, sea, surface, this.ship, this.seabed, this.wreck, this.murk)
    const label = this.makeLabel('Ship sonar', 0.3)
    label.position.set(0, 1.25, 0)
    g.add(label)
    this.placeSeabed(1.6)
  }

  private placeSeabed(depth: number) {
    this.depthVis = depth
    this.seabed.position.set(0, -depth, 0)
    this.wreck.position.set(0.7, -depth + 0.1, 0)
    this.wreck.visible = this.target === 'wreck'
  }

  /* ================= loading ================= */
  async load(lesson: SoundLessonContract, onProgress?: (done: number, total: number) => void): Promise<void> {
    const loader = new GLTFLoader()
    const urls = { fork: lesson.assets.tuningFork, scope: lesson.assets.oscilloscope, vol: lesson.assets.volumeIcon }
    let done = 0
    const one = (url: string) =>
      loader
        .loadAsync(url)
        .catch((err) => {
          console.warn('sound model failed to load, using a built-in stand-in:', url, err)
          return null
        })
        .then((g) => {
          onProgress?.(++done, Object.keys(urls).length)
          return g
        })
    const [fork, scope, vol] = await Promise.all([one(urls.fork), one(urls.scope), one(urls.vol)])
    if (this.disposed) return
    this.mountFork(fork?.scene ?? null)
    this.mountScope(scope?.scene ?? null)
    this.speaker = this.makeSpeaker(vol?.scene ?? null, 0.34)
    this.speaker.position.set(TANK_X + 0.5, BENCH_Y + 0.42, -0.1)
    this.waveGroup.add(this.speaker)
    this.echoSpeaker = this.makeSpeaker(vol?.scene ?? null, 0.4)
    this.echoSpeaker.position.set(0.45, 2.1, 0)
    this.echoSpeaker.visible = false
    this.echoGroup.add(this.echoSpeaker)
    this.sonarSpeaker = this.makeSpeaker(vol?.scene ?? null, 0.3)
    this.sonarSpeaker.position.set(0, -0.55, 0.45)
    this.sonarSpeaker.rotation.z = -Math.PI / 2
    this.sonarSpeaker.visible = false
    this.sonarGroup.add(this.sonarSpeaker)
    this.setStage(this.stage, false)
  }

  /** The tuning fork hangs tines-down over the tank with its tips in the water, and shivers at the generator's frequency. */
  private mountFork(src: THREE.Object3D | null) {
    const holder = new THREE.Group()
    let model: THREE.Object3D
    if (src) {
      model = src.clone(true)
      model.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.isMesh) {
          m.castShadow = true
          const mat = m.material as THREE.MeshStandardMaterial
          mat.metalness = 1
          mat.roughness = 0.2
          mat.envMapIntensity = 1.6
        }
      })
    } else {
      model = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.4, 10), new THREE.MeshStandardMaterial({ color: 0xc5ceba, metalness: 1, roughness: 0.2 }))
      model.position.y = 0.2
    }
    // The model stands on its handle with the prongs up (0.4 m tall). Scale to 0.34 m and flip it over the water.
    const S = 0.85
    model.scale.setScalar(S)
    holder.add(model)
    holder.rotation.x = Math.PI
    holder.position.set(TANK_X - 0.18, BENCH_Y + 0.055 + 0.4 * S, 0)
    this.fork = holder
    this.forkBase.copy(holder.position)
    // stand holding it
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 10), new THREE.MeshStandardMaterial({ color: 0x8993a3, metalness: 0.8, roughness: 0.3 }))
    stand.position.set(TANK_X - 0.18, BENCH_Y + 0.3, -TANK_D / 2 - 0.12)
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, TANK_D / 2 + 0.12), new THREE.MeshStandardMaterial({ color: 0x8993a3, metalness: 0.8, roughness: 0.3 }))
    arm.position.set(TANK_X - 0.18, BENCH_Y + 0.55, -TANK_D / 4 - 0.06)
    this.waveGroup.add(holder, stand, arm)
  }

  private mountScope(src: THREE.Object3D | null) {
    if (!src) return
    const m = src.clone(true)
    m.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = true
        // The model's own static traces are replaced by the live ones drawn below.
        if (o.name === 'oscilloscope_traces_rgb') mesh.visible = false
      }
    })
    const g = new THREE.Group()
    g.add(m)
    // Screen: centre (-0.058, 0.1005) on the front panel, 0.16 x 0.099 in the model's own units.
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.099), new THREE.MeshBasicMaterial({ map: this.scopeTex, toneMapped: false }))
    screen.position.set(-0.058, 0.1005, -0.0128)
    g.add(screen)
    g.scale.setScalar(SCOPE_SCALE)
    g.position.set(SCOPE_X, BENCH_Y, -0.05)
    g.rotation.y = -0.35
    this.scope = g
    this.waveGroup.add(g)
    const l = this.makeLabel('Oscilloscope', 0.22)
    l.position.set(SCOPE_X, BENCH_Y + 0.33, -0.05)
    this.waveGroup.add(l)
  }

  /** The volume icon: a flat sign that is turned to face the camera and swells with the loudness it stands for. */
  private makeSpeaker(src: THREE.Object3D | null, size: number): THREE.Object3D {
    const g = new THREE.Group()
    let m: THREE.Object3D
    if (src) {
      m = src.clone(true)
      const box = new THREE.Box3().setFromObject(m)
      const sz = box.getSize(new THREE.Vector3())
      const k = size / Math.max(sz.x, sz.y)
      m.scale.multiplyScalar(k)
      const b2 = new THREE.Box3().setFromObject(m)
      const c = b2.getCenter(new THREE.Vector3())
      m.position.sub(c)
      m.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.isMesh) {
          const mat = mesh.material as THREE.MeshStandardMaterial
          mat.emissive = new THREE.Color(0xffc83d)
          mat.emissiveIntensity = 0.35
        }
      })
    } else {
      m = new THREE.Mesh(new THREE.ConeGeometry(size / 3, size / 2, 16), new THREE.MeshStandardMaterial({ color: 0xffc83d }))
      m.rotation.z = Math.PI / 2
    }
    g.add(m)
    g.userData.base = 1
    return g
  }

  /* ================= stages ================= */
  setStage(stage: Stage, animate = true) {
    this.stage = stage
    this.clearRings()
    this.waveGroup.visible = stage === 'wave'
    this.echoGroup.visible = stage === 'echo'
    this.sonarGroup.visible = stage === 'sonar'
    const bg = stage === 'wave' ? 0x07090e : stage === 'echo' ? 0x9ec5e8 : 0x9cc7ea
    this.scene.background = new THREE.Color(bg)
    this.scene.fog = stage === 'echo' ? new THREE.Fog(bg, 30, 160) : stage === 'wave' ? new THREE.Fog(bg, 6, 14) : null
    const c = this.controls
    c.minPolarAngle = 0.1 * Math.PI
    c.maxPolarAngle = 0.52 * Math.PI
    c.minAzimuthAngle = -0.4 * Math.PI
    c.maxAzimuthAngle = 0.4 * Math.PI
    if (stage === 'wave') {
      c.minDistance = 0.9
      c.maxDistance = 4.5
      this.flyTo(new THREE.Vector3(0.3, BENCH_Y + 1.15, 2.5), new THREE.Vector3(0.3, BENCH_Y + 0.12, 0), animate)
    } else if (stage === 'echo') {
      c.minDistance = 2
      c.maxDistance = 30
      this.setPlace(this.place, animate)
    } else {
      c.minDistance = 2
      c.maxDistance = 14
      c.minAzimuthAngle = -0.25 * Math.PI
      c.maxAzimuthAngle = 0.25 * Math.PI
      this.flyTo(new THREE.Vector3(0, -0.4, 7.4), new THREE.Vector3(0, -0.9, 0), animate)
    }
    if (this.echoSpeaker) this.echoSpeaker.visible = false
    if (this.sonarSpeaker) this.sonarSpeaker.visible = false
    this.resize()
  }

  setPlace(place: Place, animate = true) {
    this.place = place
    this.clearRings()
    this.fieldGroup.visible = place === 'field'
    this.roomGroup.visible = place === 'room'
    if (place === 'field') {
      this.scene.background = new THREE.Color(0x9ec5e8)
      this.scene.fog = new THREE.Fog(0x9ec5e8, 30, 160)
      this.avatar.position.set(0, 0, 0)
      this.controls.minAzimuthAngle = -0.5 * Math.PI
      this.controls.maxAzimuthAngle = 0.5 * Math.PI
      this.flyTo(new THREE.Vector3(2.4, 2.4, 6.5), new THREE.Vector3(0, 1.2, -4), animate)
    } else {
      this.scene.background = new THREE.Color(0x2a2824)
      this.scene.fog = null
      this.avatar.position.set(0, 0, 0)
      this.flyTo(new THREE.Vector3(1.9, 1.9, 2.9), new THREE.Vector3(0, 1.2, -2), animate)
    }
  }

  /* ================= wave controls ================= */
  setWave(s: Partial<WaveSettings>) {
    this.settings = { ...this.settings, ...s }
  }
  setRunning(on: boolean) {
    this.running = on
  }

  /* ================= echo / sonar play ================= */
  private addRing(r0: number, r1: number, dur: number, opts: { y?: number; vertical?: boolean; color?: number; op?: number; at?: THREE.Vector3; done?: () => void; group?: THREE.Group } = {}): Ring {
    const geo = opts.vertical ? new THREE.RingGeometry(0.97, 1, 72, 1, 0, Math.PI * 2) : new THREE.RingGeometry(0.97, 1, 72)
    const mat = new THREE.MeshBasicMaterial({ color: opts.color ?? 0xffffff, transparent: true, opacity: opts.op ?? 0.8, side: THREE.DoubleSide, depthWrite: false })
    const mesh = new THREE.Mesh(geo, mat)
    if (!opts.vertical) mesh.rotation.x = -Math.PI / 2
    if (opts.at) mesh.position.copy(opts.at)
    else mesh.position.y = opts.y ?? 0.06
    mesh.renderOrder = 8
    ;(opts.group ?? this.scene).add(mesh)
    const ring: Ring = { mesh, t0: performance.now() / 1000, dur, r0, r1, op: opts.op ?? 0.8, done: opts.done }
    this.rings.push(ring)
    return ring
  }
  /**
   * Removes every ring at once. A ring that is cut short still reports `done`, because clap/shout/ping await it and
   * keep the bench busy until it does: without this, switching place mid-clap left `busy` stuck and every later
   * clap, shout and ping was ignored.
   */
  private clearRings() {
    const cut = this.rings
    this.rings = []
    for (const r of cut) r.mesh.parent?.remove(r.mesh)
    for (const r of cut) r.done?.()
  }
  private emit(seconds: number, scale = 1) {
    this.emitUntil = performance.now() / 1000 + seconds
    this.emitScale = scale
  }

  async clap(place: Place, rt: number): Promise<void> {
    if (this.busy) return
    this.busy = true
    this.clearRings()
    try {
      this.emit(0.8)
      if (this.echoSpeaker) {
        this.echoSpeaker.visible = true
        this.echoSpeaker.position.set(0.45, 2.1, 0)
      }
      if (place === 'field') {
        acoustics.clapField()
        // one ring, out into the open, and nothing comes back
        await new Promise<void>((resolve) => this.addRing(0.2, 18, 2.2, { y: 0.1, op: 0.85, done: resolve }))
      } else {
        acoustics.clapRoom(rt)
        // the same ring hits the walls and bounces again and again, getting weaker, for about `rt` seconds
        const bounces = Math.max(3, Math.round(rt / 0.11))
        let finished = 0
        await new Promise<void>((resolve) => {
          for (let i = 0; i < bounces; i++) {
            const at = (i * rt) / bounces
            window.setTimeout(() => {
              this.addRing(i % 2 ? 3.2 : 0.4, i % 2 ? 0.4 : 3.2, 0.32, { y: 0.12 + (i % 3) * 0.35, color: 0xffe9b0, op: 0.7 * Math.pow(1 - i / (bounces + 1), 1.6), done: () => ++finished >= bounces && resolve() })
            }, at * 1000)
          }
        })
      }
    } finally {
      if (this.echoSpeaker) this.echoSpeaker.visible = false
      this.busy = false
    }
  }

  /** A shout towards the cliff: the ring reaches it after t/2 and the echo ring is back after t, in real time. */
  async shout(t: number, onShout: () => void, onEcho: () => void): Promise<void> {
    if (this.busy) return
    this.busy = true
    this.clearRings()
    try {
      acoustics.shoutWithEcho(t)
      this.emit(0.6, 1.3)
      if (this.echoSpeaker) {
        this.echoSpeaker.visible = true
        this.echoSpeaker.position.set(0.45, 2.1, 0)
      }
      onShout()
      await new Promise<void>((resolve) => this.addRing(0.3, CLIFF_DIST, t / 2, { y: 0.1, op: 0.85, done: resolve }))
      this.cliff.userData.flash = performance.now() / 1000
      await new Promise<void>((resolve) => this.addRing(CLIFF_DIST, 0.3, t / 2, { y: 0.1, color: 0xffd479, op: 0.9, done: resolve }))
      onEcho()
    } finally {
      if (this.echoSpeaker) this.echoSpeaker.visible = false
      this.busy = false
    }
  }

  /** A sonar pulse: down to the sea floor in t/2 and back in t/2. `speed` sizes the depth shown. */
  async ping(t: number, speed: number, target: 'floor' | 'wreck', onPing: () => void, onEcho: () => void): Promise<void> {
    if (this.busy) return
    this.busy = true
    this.clearRings()
    try {
      this.target = target
      this.placeSeabed(Math.min(3.4, Math.max(0.9, (speed * t) / 2 / 330)))
      this.murk.visible = false
      acoustics.sonar(t)
      this.emit(0.5)
      if (this.sonarSpeaker) this.sonarSpeaker.visible = true
      onPing()
      const origin = new THREE.Vector3(0, -0.2, 0.2)
      const down = Math.max(0.5, this.depthVis - (target === 'wreck' ? 0.2 : 0))
      await new Promise<void>((resolve) => this.addRing(0.1, down, t / 2, { vertical: true, color: 0xb8f2ff, at: origin, op: 0.9, group: this.sonarGroup, done: resolve }))
      await new Promise<void>((resolve) => this.addRing(down, 0.1, t / 2, { vertical: true, color: 0xffd479, at: origin, op: 0.9, group: this.sonarGroup, done: resolve }))
      onEcho()
    } finally {
      if (this.sonarSpeaker) this.sonarSpeaker.visible = false
      this.busy = false
    }
  }

  resetSonar(target: 'floor' | 'wreck') {
    this.target = target
    this.murk.visible = true
    this.wreck.visible = false
  }

  get isBusy(): boolean {
    return this.busy
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
    this.viewTween = (dt) => {
      el += dt
      const k = easeInOut(Math.min(1, el / D))
      this.camera.position.lerpVectors(p0, pos, k)
      this.controls.target.lerpVectors(t0, target, k)
      return el < D
    }
  }

  setInsets(insets: { left: number; right: number; top: number; bottom: number }) {
    this.insets = insets
    this.resize()
  }

  private onPointerMove = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect()
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    this.raycaster.ray.intersectPlane(this.benchPlane, this.handPoint)
  }

  private resize() {
    const w = this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || 800
    const h = this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || 600
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    const freeW = Math.max(300, w - this.insets.left - this.insets.right)
    const freeH = Math.max(240, h - this.insets.top - this.insets.bottom)
    this.camera.setViewOffset(w, h, -(this.insets.left - this.insets.right) / 2, -(this.insets.top - this.insets.bottom) / 2, w, h)
    this.camera.fov = Math.min(72, 38 * Math.max(1, Math.max(w / freeW, h / freeH)))
    this.camera.updateProjectionMatrix()
  }

  start() {
    this.renderer.setAnimationLoop(() => this.frame())
  }

  /* ================= frame ================= */
  private drawScope(now: number) {
    const c = this.scopeCanvas
    const g = c.getContext('2d')!
    const W = c.width
    const H = c.height
    g.fillStyle = '#04100f'
    g.fillRect(0, 0, W, H)
    g.strokeStyle = 'rgba(120,190,170,0.22)'
    g.lineWidth = 1
    for (let i = 0; i <= 10; i++) {
      g.beginPath()
      g.moveTo((i * W) / 10, 0)
      g.lineTo((i * W) / 10, H)
      g.stroke()
    }
    for (let j = 0; j <= 8; j++) {
      g.beginPath()
      g.moveTo(0, (j * H) / 8)
      g.lineTo(W, (j * H) / 8)
      g.stroke()
    }
    g.strokeStyle = 'rgba(120,190,170,0.5)'
    g.beginPath()
    g.moveTo(0, H / 2)
    g.lineTo(W, H / 2)
    g.stroke()
    const span = 0.5
    const amax = 10
    const draw = (key: 'g' | 'w', color: string, glow: string) => {
      g.strokeStyle = color
      g.shadowColor = glow
      g.shadowBlur = 8
      g.lineWidth = 2.4
      g.beginPath()
      let first = true
      for (const p of this.history) {
        const x = ((p.t - (now - span)) / span) * W
        if (x < 0) continue
        const y = H / 2 - (p[key] / amax) * (H * 0.42)
        if (first) {
          g.moveTo(x, y)
          first = false
        } else g.lineTo(x, y)
      }
      g.stroke()
      g.shadowBlur = 0
    }
    draw('w', '#43e0ff', '#43e0ff')
    draw('g', '#ffb347', '#ffb347')
    this.scopeTex.needsUpdate = true
  }

  private frame() {
    if (this.disposed) return
    const dt = Math.min(0.05, this.clock.getDelta())
    const now = performance.now() / 1000
    for (const t of [...this.tweens]) if (!t(dt)) this.tweens.delete(t)
    if (this.viewTween && !this.viewTween(dt)) this.viewTween = null

    if (this.stage === 'wave') {
      const { freq, amp, speed } = this.settings
      if (this.running) this.phase += 2 * Math.PI * freq * dt
      const lambda = speed / freq
      const u = this.rippleMat.uniforms
      u.uTime.value = this.phase / (2 * Math.PI * Math.max(freq, 0.01))
      u.uK.value = (2 * Math.PI) / lambda
      u.uW.value = 2 * Math.PI * freq
      u.uAmp.value = (amp / 1000) * 0.55
      const g = amp * Math.sin(this.phase)
      // A probe 25 cm from the source: the same wave, a little later.
      const w = amp * Math.sin(this.phase - ((2 * Math.PI * freq) / speed) * 0.25) * 0.8
      this.history.push({ t: now, g, w })
      while (this.history.length && this.history[0].t < now - 0.6) this.history.shift()
      if (this.scope) this.drawScope(now)
      if (this.fork) {
        this.fork.position.y = this.forkBase.y + (this.running ? Math.sin(this.phase) * 0.0025 * (amp / 5) : 0)
      }
      if (this.speaker) {
        const s = 0.55 + amp * 0.1
        this.speaker.scale.setScalar(s * (1 + 0.05 * Math.sin(this.phase)))
        this.speaker.lookAt(this.camera.position.x, this.speaker.position.y, this.camera.position.z)
      }
    }
    // sources that are sounding swell a little; the cliff glints when the shout arrives
    const emitting = now < this.emitUntil
    for (const sp of [this.echoSpeaker, this.sonarSpeaker]) {
      if (!sp || !sp.visible) continue
      const k = emitting ? 1 + 0.15 * Math.sin(now * 30) : 1
      sp.scale.setScalar(k * this.emitScale)
      if (sp !== this.sonarSpeaker) sp.lookAt(this.camera.position)
    }
    const flash = this.cliff.userData.flash as number | undefined
    ;(this.cliff.material as THREE.MeshStandardMaterial).emissive.setRGB(flash && now - flash < 0.35 ? 0.5 : 0, flash && now - flash < 0.35 ? 0.4 : 0, 0)

    for (const r of [...this.rings]) {
      const k = Math.min(1, (now - r.t0) / r.dur)
      const rad = r.r0 + (r.r1 - r.r0) * k
      r.mesh.scale.set(rad, rad, rad)
      ;(r.mesh.material as THREE.MeshBasicMaterial).opacity = r.op * (1 - 0.6 * k) * (k < 0.04 ? k / 0.04 : 1)
      if (k >= 1) {
        r.mesh.parent?.remove(r.mesh)
        this.rings = this.rings.filter((x) => x !== r)
        r.done?.()
      }
    }

    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.disposed = true
    this.renderer.setAnimationLoop(null)
    window.removeEventListener('resize', this.onResize)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
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

/** The tone made when something is sent: kept here so the page does not reach into the audio helpers. */
export const chirp = () => sound.click()
