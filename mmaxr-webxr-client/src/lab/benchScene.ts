import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/* Layout (metres), as in the other chemistry benches: the bench top is y = BENCH_Y and the lab faces +z. */
export const BENCH_Y = 0.9
const BENCH_W = 3.4
const BENCH_D = 0.95

/** A prop from mmaxr-assets/models placed on the bench for the look of a real workbench. */
export interface BenchProp {
  file: string
  height: number
  x: number
  z: number
  rotY?: number
}

/**
 * A plain XR chemistry bench: the lab-bench model, a few props, the shared lighting and a framed, gently orbiting
 * camera. Mission labs (Atom Builder, Ionic Bonding) put their models on it and react to clicks.
 */
export abstract class BenchScene {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.05, 40)
  readonly controls: OrbitControls
  protected readonly clock = new THREE.Clock()
  protected readonly raycaster = new THREE.Raycaster()
  protected readonly pointer = new THREE.Vector2(10, 10)
  protected readonly handPoint = new THREE.Vector3(0, BENCH_Y, 0.3)
  protected tweens = new Set<(dt: number) => boolean>()
  protected pickables: THREE.Object3D[] = []
  protected hovered: string | null = null
  private insets = { left: 0, right: 0, top: 0, bottom: 0 }
  private insetsTarget = { left: 0, right: 0, top: 0, bottom: 0 }
  private defaultPos = new THREE.Vector3(0, 1.4, 1.2)
  private userMoved = false
  private downAt = { x: 0, y: 0 }
  private disposed = false
  private running = false
  private readonly onResize = () => this.resize()

  constructor(
    protected readonly canvas: HTMLCanvasElement,
    /** Where the camera looks: the middle of what the lab shows, above the bench. */
    protected readonly focus = new THREE.Vector3(0, BENCH_Y + 0.25, 0.05),
    /** How wide (metres) the framing must show. */
    private readonly frameWidth = 0.9,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.95
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.target.copy(focus)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.enablePan = false
    this.controls.minDistance = 0.45
    this.controls.maxDistance = 3.2
    this.controls.minPolarAngle = Math.PI * 0.2
    this.controls.maxPolarAngle = Math.PI * 0.5
    this.controls.minAzimuthAngle = -Math.PI * 0.4
    this.controls.maxAzimuthAngle = Math.PI * 0.4
    this.controls.rotateSpeed = 0.55
    this.controls.addEventListener('start', () => (this.userMoved = true))
    this.buildEnvironment()
    this.resize()
    window.addEventListener('resize', this.onResize)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointerup', this.onPointerUp)
  }

  get head(): THREE.Vector3 {
    return this.camera.position
  }
  get hand(): THREE.Vector3 {
    return this.handPoint
  }

  /** The id under a click, from `userData.pick` on the hit object or a parent. */
  protected abstract onPick(id: string): void
  /** Per-frame animation of the lab's own models. */
  protected abstract tick(dt: number, time: number): void

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
  }

  /** Load the bench model and the props. A model that fails to load is skipped: the bench top still stands. */
  async loadBench(benchUrl: string | undefined, props: BenchProp[], onProgress?: (done: number, total: number) => void) {
    const loader = new GLTFLoader()
    const dir = benchUrl ? benchUrl.slice(0, benchUrl.lastIndexOf('/') + 1) : ''
    const total = (benchUrl ? 1 : 0) + (dir ? props.length : 0)
    let done = 0
    const one = (url: string) =>
      loader
        .loadAsync(url)
        .catch((err) => {
          console.warn('[bench] asset failed, skipping', url, err)
          return null
        })
        .finally(() => onProgress?.(++done, total))
    const [bench, ...loaded] = await Promise.all([benchUrl ? one(benchUrl) : Promise.resolve(null), ...(dir ? props.map((p) => one(dir + p.file)) : [])])
    if (bench) this.placeCabinet(bench.scene)
    loaded.forEach((g, i) => {
      if (!g) return
      const p = props[i]
      this.uprighten(g.scene)
      const wrap = this.fit(g.scene, p.height)
      wrap.position.set(p.x, BENCH_Y, p.z)
      wrap.rotation.y = p.rotY ?? 0
      this.shadows(wrap)
      this.scene.add(wrap)
    })
  }

  private fit(model: THREE.Object3D, height?: number, width?: number): THREE.Group {
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3())
    const k = height ? height / (size.y || 1) : (width ?? 1) / (size.x || 1)
    model.scale.multiplyScalar(k)
    const b = new THREE.Box3().setFromObject(model)
    const c = b.getCenter(new THREE.Vector3())
    model.position.x -= c.x
    model.position.z -= c.z
    model.position.y -= b.min.y
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
    const wrap = this.fit(model, undefined, BENCH_W)
    const size = new THREE.Box3().setFromObject(wrap).getSize(new THREE.Vector3())
    if (size.y > BENCH_Y - 0.05) wrap.scale.multiplyScalar((BENCH_Y - 0.05) / size.y)
    this.shadows(wrap)
    this.scene.add(wrap)
  }

  /** A round display stand on the bench with a soft glowing rim, for a model to float over. */
  protected stand(x: number, z: number, radius = 0.16): THREE.Group {
    const g = new THREE.Group()
    g.position.set(x, BENCH_Y, z)
    const base = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.08, 0.025, 48), new THREE.MeshStandardMaterial({ color: 0x2b313c, roughness: 0.4, metalness: 0.3 }))
    base.position.y = 0.0125
    base.receiveShadow = true
    base.castShadow = true
    const rim = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.02, 0.004, 8, 64), new THREE.MeshBasicMaterial({ color: 0x4f8cff, transparent: true, opacity: 0.6 }))
    rim.rotation.x = Math.PI / 2
    rim.position.y = 0.026
    g.add(base, rim)
    this.scene.add(g)
    return g
  }

  /** A text label that always faces the camera. */
  protected label(text: string, o: { size?: number; bg?: string; fg?: string; wide?: boolean } = {}): THREE.Sprite {
    const w = o.wide ? 512 : 256
    const h = 160
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')!
    ctx.fillStyle = o.bg ?? 'rgba(20,24,32,0.85)'
    ctx.beginPath()
    ctx.roundRect(4, 4, w - 8, h - 8, 36)
    ctx.fill()
    ctx.fillStyle = o.fg ?? '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    let size = o.size ?? 84
    ctx.font = `700 ${size}px Figtree, system-ui, sans-serif`
    while (ctx.measureText(text).width > w - 40 && size > 20) {
      size -= 4
      ctx.font = `700 ${size}px Figtree, system-ui, sans-serif`
    }
    ctx.fillText(text, w / 2, h / 2 + 3)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
    s.scale.set((w / h) * 0.05, 0.05, 1)
    return s
  }

  protected setLabel(sprite: THREE.Sprite, text: string, o: { bg?: string; fg?: string; wide?: boolean } = {}) {
    const next = this.label(text, o)
    const old = sprite.material.map
    sprite.material.map = next.material.map
    sprite.material.needsUpdate = true
    sprite.scale.copy(next.scale)
    old?.dispose()
    next.material.dispose()
  }

  /** Run `step(t)` over `seconds` with t from 0 to 1 (eased), then resolve. */
  protected animate(seconds: number, step: (t: number) => void): Promise<void> {
    return new Promise((resolve) => {
      let t = 0
      this.tweens.add((dt) => {
        t = Math.min(1, t + dt / seconds)
        const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
        step(e)
        if (t >= 1) resolve()
        return t < 1
      })
    })
  }

  setInsets(px: { left: number; right: number; top: number; bottom: number }) {
    this.insetsTarget = { ...px }
    this.frame()
  }

  private frame() {
    const W = this.canvas.clientWidth || window.innerWidth
    const H = this.canvas.clientHeight || window.innerHeight
    const freeW = Math.max(240, W - this.insetsTarget.left - this.insetsTarget.right)
    const freeH = Math.max(200, H - this.insetsTarget.top - this.insetsTarget.bottom)
    const vfov = (this.camera.fov * Math.PI) / 180
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (freeW / freeH))
    const d = Math.min(3, Math.max(0.6, this.frameWidth / 2 / Math.tan(hfov / 2), 0.5 / Math.tan(vfov / 2)))
    const dir = new THREE.Vector3(0, 0.42, 1.5).normalize()
    this.defaultPos.copy(this.focus).addScaledVector(dir, d)
    if (!this.userMoved) this.camera.position.copy(this.defaultPos)
  }

  private resize() {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.fov = w / h < 1 ? 58 : 38
    this.camera.updateProjectionMatrix()
    this.frame()
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

  /** Back to the starting view. */
  resetView() {
    this.userMoved = false
    this.controls.target.copy(this.focus)
    this.frame()
  }

  private pickAt(ev: PointerEvent): string | null {
    const r = this.canvas.getBoundingClientRect()
    this.pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hit = this.raycaster.intersectObjects(this.pickables, true)[0]
    let o: THREE.Object3D | null = hit?.object ?? null
    while (o && !o.userData.pick) o = o.parent
    if (hit) this.handPoint.copy(hit.point)
    return (o?.userData.pick as string | undefined) ?? null
  }
  private onPointerMove = (ev: PointerEvent) => {
    this.hovered = this.pickAt(ev)
    this.canvas.style.cursor = this.hovered ? 'pointer' : ''
  }
  private onPointerDown = (ev: PointerEvent) => {
    this.downAt = { x: ev.clientX, y: ev.clientY }
  }
  private onPointerUp = (ev: PointerEvent) => {
    // A drag orbits the camera; only a click picks.
    if (Math.hypot(ev.clientX - this.downAt.x, ev.clientY - this.downAt.y) > 6) return
    const id = this.pickAt(ev)
    if (id) this.onPick(id)
  }

  start() {
    if (this.running) return
    this.running = true
    this.renderer.setAnimationLoop(() => {
      if (this.disposed) return
      const dt = Math.min(this.clock.getDelta(), 0.05)
      for (const tw of [...this.tweens]) if (!tw(dt)) this.tweens.delete(tw)
      this.applyInsets(dt)
      this.controls.update()
      this.tick(dt, this.clock.elapsedTime)
      this.renderer.render(this.scene, this.camera)
    })
  }

  dispose() {
    this.disposed = true
    this.renderer.setAnimationLoop(null)
    window.removeEventListener('resize', this.onResize)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.controls.dispose()
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite || o instanceof THREE.Points) {
        o.geometry?.dispose()
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          ;(m as THREE.MeshBasicMaterial).map?.dispose()
          m.dispose()
        }
      }
    })
    this.renderer.dispose()
  }
}
