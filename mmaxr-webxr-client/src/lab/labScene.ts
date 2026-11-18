import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { ChemistryLessonContract } from '@mmaxr/schema'
import { swatchFor } from '../services/colors'

/* ------------------------------------------------------------------ */
/* Layout (metres). Bench top is y = BENCH_Y; the lab faces +z.        */
/* ------------------------------------------------------------------ */
const BENCH_Y = 0.9
const BENCH_W = 3.2
const BENCH_D = 0.95
const TUBE_H = 0.3
const TUBE_SPACING = 0.17
const RACK_BASE = 0.022
const TUBE_RADIUS_GUESS = 0.0235
const TUBE_Z = 0.12
const BOTTLE_Z = -0.27
const RISER_H = 0.1
const BOTTLE_SPACING = 0.19

export interface LabSceneEvents {
  onTubeClick(index: number): void
  onBottleClick(indicatorId: string): void
  onDropperClick(): void
}

interface Tube {
  index: number
  group: THREE.Group
  liquid: THREE.Mesh
  liquidMat: THREE.MeshPhysicalMaterial
  ring: THREE.Mesh
  label: THREE.Sprite
  baseY: number
  topY: number
  radius: number
  liquidTop: number
  hover: number
  hoverTarget: number
  currentColor: THREE.Color
}

interface Bottle {
  id: string
  group: THREE.Group
  ring: THREE.Mesh
  selected: boolean
  active: boolean
  hover: number
  hoverTarget: number
  baseZ: number
}

type Ease = (t: number) => number
const easeInOut: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const easeOut: Ease = (t) => 1 - Math.pow(1 - t, 3)

export class LabScene {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  private readonly clock = new THREE.Clock()
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2(10, 10)
  private readonly handPoint = new THREE.Vector3(0, BENCH_Y, 0.2)
  private readonly benchPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BENCH_Y)
  private tubes: Tube[] = []
  private bottles: Bottle[] = []
  private pickables: THREE.Object3D[] = []
  private tweens = new Set<(dt: number) => boolean>()
  private dropper: THREE.Group | null = null
  private dropperBulb: THREE.Mesh | null = null
  private dropperTip: THREE.Mesh | null = null
  private dropperVisible = false
  private dropperClickable = false
  private dust: THREE.Points | null = null
  private bubbles: { mesh: THREE.Mesh; vy: number; life: number }[] = []
  private focusTarget = new THREE.Vector3(0, 1.0, 0.0)
  private focusPos = new THREE.Vector3()
  private focusing = false
  private defaultPos = new THREE.Vector3(0, 1.52, 1.5)
  private defaultTarget = new THREE.Vector3(0, 1.1, -0.05)
  private insets = { left: 0, right: 0, top: 0, bottom: 0 }
  private insetsTarget = { left: 0, right: 0, top: 0, bottom: 0 }
  private hoveredTube = -1
  private hoveredBottle = ''
  private downAt = { x: 0, y: 0, t: 0 }
  private disposed = false
  private userMoved = false
  private focusIndex: number | null = null
  private running = false
  private readonly onResize = () => this.resize()

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly events: LabSceneEvents,
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
    this.controls.minDistance = 0.55
    this.controls.maxDistance = 4.2
    this.controls.minPolarAngle = Math.PI * 0.2
    this.controls.maxPolarAngle = Math.PI * 0.5
    this.controls.minAzimuthAngle = -Math.PI * 0.3
    this.controls.maxAzimuthAngle = Math.PI * 0.3
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

  /* ---------------- public: head / hand for the sensor log ---------------- */
  get head(): THREE.Vector3 {
    return this.camera.position
  }
  get hand(): THREE.Vector3 {
    return this.handPoint
  }

  /* ---------------- build ---------------- */
  private buildEnvironment() {
    const scene = this.scene
    scene.background = new THREE.Color(0x0b0d12)
    scene.fog = new THREE.Fog(0x0b0d12, 4, 9)

    const pmrem = new THREE.PMREMGenerator(this.renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.35

    scene.add(new THREE.HemisphereLight(0x9bb4ff, 0x1a1410, 0.28))

    const key = new THREE.SpotLight(0xfff3e0, 34, 8, Math.PI / 5.2, 0.7, 1.6)
    key.position.set(0.9, 2.6, 1.6)
    key.target.position.set(0, BENCH_Y, 0)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.bias = -0.0004
    key.shadow.radius = 4
    scene.add(key, key.target)

    const rimA = new THREE.PointLight(0x7c5cff, 6, 5)
    rimA.position.set(-1.8, 1.7, -0.8)
    const rimB = new THREE.PointLight(0x22d3ee, 4, 5)
    rimB.position.set(1.9, 1.5, -0.9)
    scene.add(rimA, rimB)

    // Floor
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 14),
      new THREE.MeshStandardMaterial({ color: 0x14171d, roughness: 0.55, metalness: 0.1 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    scene.add(floor)

    // Back wall with a soft tile feel
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 5),
      new THREE.MeshStandardMaterial({ color: 0x1b2029, roughness: 0.85 }),
    )
    wall.position.set(0, 2.5, -1.35)
    wall.receiveShadow = true
    scene.add(wall)

    // Worktop: dark epoxy slab so the bench reads correctly whatever the cabinet model looks like
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(BENCH_W, 0.05, BENCH_D),
      new THREE.MeshStandardMaterial({ color: 0x20252e, roughness: 0.32, metalness: 0.15 }),
    )
    top.position.set(0, BENCH_Y - 0.025, 0)
    top.receiveShadow = true
    top.castShadow = true
    scene.add(top)

    // Dust motes catch the light and make the room feel inhabited
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

  /** Loads the lesson's models and assembles the bench. Resolves once everything is placed. */
  async load(lesson: ChemistryLessonContract, onProgress?: (done: number, total: number) => void): Promise<void> {
    const loader = new GLTFLoader()
    const dir = lesson.modelUrl.slice(0, lesson.modelUrl.lastIndexOf('/') + 1)
    const urls = {
      bench: lesson.modelUrl,
      tube: lesson.assets?.testTube ?? `${dir}test_tube.glb`,
      rack: lesson.assets?.testTubeRack ?? `${dir}test_tube_rack.glb`,
      flask: lesson.assets?.flask ?? `${dir}erlenmeyer_flask.glb`,
      dropper: lesson.assets?.dropper ?? `${dir}pipette_set.glb`,
    }
    let done = 0
    const total = Object.keys(urls).length
    const fetchOne = (url: string) =>
      loader
        .loadAsync(url)
        .catch((err) => {
          console.warn('[lab] asset failed, using a stand-in', url, err)
          return null
        })
        .finally(() => onProgress?.(++done, total))

    const [bench, tube, rack, flask, pipettes] = await Promise.all([
      fetchOne(urls.bench),
      fetchOne(urls.tube),
      fetchOne(urls.rack),
      fetchOne(urls.flask),
      fetchOne(urls.dropper),
    ])

    this.placeCabinet(bench?.scene ?? null)
    this.placeTubes(lesson, tube?.scene ?? null, rack?.scene ?? null)
    this.placeBottles(lesson)
    this.buildDropper()
    if (flask) this.placeProp(flask.scene, { height: 0.2, x: -1.2, z: 0.15, rotY: 0.5 })
    if (pipettes) this.placeProp(pipettes.scene, { height: 0.22, x: 1.25, z: 0.2, rotY: -0.4 })
  }

  /** Scale a model uniformly to a target height and stand it on y=0 centred on x,z. */
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

  /** Make the longest axis vertical (some exports are Z-up). */
  private uprighten(model: THREE.Object3D) {
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3())
    if (size.z > size.y && size.z >= size.x) model.rotateX(-Math.PI / 2)
    else if (size.x > size.y && size.x > size.z) model.rotateZ(Math.PI / 2)
    model.updateMatrixWorld(true)
  }

  private enableShadows(root: THREE.Object3D) {
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true
        o.receiveShadow = true
      }
    })
  }

  private placeCabinet(model: THREE.Object3D | null) {
    if (!model) return
    this.uprighten(model)
    const wrap = this.fit(model, { width: BENCH_W })
    const size = new THREE.Box3().setFromObject(wrap).getSize(new THREE.Vector3())
    // Keep the cabinet under the worktop, never above it.
    if (size.y > BENCH_Y - 0.05) wrap.scale.multiplyScalar((BENCH_Y - 0.05) / size.y)
    wrap.position.set(0, 0, 0.0)
    this.enableShadows(wrap)
    this.scene.add(wrap)
  }

  private placeProp(model: THREE.Object3D, o: { height?: number; width?: number; x: number; z: number; rotY: number }) {
    this.uprighten(model)
    const wrap = this.fit(model, { height: o.height, width: o.width })
    wrap.position.set(o.x, BENCH_Y, o.z)
    wrap.rotation.y = o.rotY
    this.enableShadows(wrap)
    this.scene.add(wrap)
  }

  private placeTubes(lesson: ChemistryLessonContract, tubeModel: THREE.Object3D | null, rackModel: THREE.Object3D | null) {
    const count = lesson.assignedSolutions.length
    const span = (count - 1) * TUBE_SPACING

    this.buildRack(span, TUBE_RADIUS_GUESS)
    // The supplied rack model is a small prop at the side of the bench, to the same scale as the tubes.
    if (rackModel) this.placeProp(rackModel, { width: 0.5, x: 1.18, z: 0.16, rotY: -0.25 })

    for (let i = 0; i < count; i++) {
      const x = -span / 2 + i * TUBE_SPACING
      const group = new THREE.Group()
      group.position.set(x, BENCH_Y + RACK_BASE, TUBE_Z)
      group.userData.tubeIndex = i

      let radius = 0.02
      let glass: THREE.Object3D
      if (tubeModel) {
        const m = tubeModel.clone(true)
        this.uprighten(m)
        const wrap = this.fit(m, { height: TUBE_H })
        const size = new THREE.Box3().setFromObject(wrap).getSize(new THREE.Vector3())
        radius = Math.min(size.x, size.z) / 2
        wrap.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.material = (Array.isArray(o.material) ? o.material : [o.material]).map((mat: THREE.Material) => {
              const c = mat.clone() as THREE.MeshStandardMaterial
              c.transparent = true
              c.opacity = Math.min(c.opacity ?? 1, 0.42)
              c.depthWrite = false
              c.envMapIntensity = 1.4
              return c
            })[0]
            o.renderOrder = 2
            o.castShadow = false
          }
        })
        glass = wrap
      } else {
        glass = new THREE.Mesh(
          new THREE.CylinderGeometry(radius, radius, TUBE_H, 28, 1, true),
          new THREE.MeshPhysicalMaterial({ color: 0xdfe8f5, transparent: true, opacity: 0.25, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false }),
        )
        glass.position.y = TUBE_H / 2
        glass.renderOrder = 2
      }
      group.add(glass)

      // Liquid: round-bottomed column that fills ~55% of the glass.
      const r = radius * 0.84
      const level = TUBE_H * 0.5
      const liquidGeo = this.liquidGeometry(r, level)
      const liquidMat = new THREE.MeshPhysicalMaterial({
        color: 0xcfe0ff,
        transparent: true,
        opacity: 0.3,
        roughness: 0.08,
        clearcoat: 1,
        clearcoatRoughness: 0.1,
        depthWrite: false,
        emissive: 0x000000,
      })
      const liquid = new THREE.Mesh(liquidGeo, liquidMat)
      liquid.position.y = radius * 0.55
      liquid.renderOrder = 1
      group.add(liquid)

      // Hover/selection ring on the bench
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius * 1.5, radius * 1.9, 48),
        new THREE.MeshBasicMaterial({ color: 0x8ab4ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
      )
      ring.rotation.x = -Math.PI / 2
      ring.position.y = 0.004
      group.add(ring)

      const label = this.textSprite(String(i + 1), { size: 96, bg: '#1f242e', fg: '#ffffff', round: true })
      label.scale.setScalar(0.06)
      label.position.set(0, 0.0, 0.105)
      group.add(label)

      // Generous invisible hit area: the glass itself is a thin target on a trackpad or a phone.
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(TUBE_SPACING * 0.42, TUBE_SPACING * 0.42, TUBE_H + 0.06, 12), new THREE.MeshBasicMaterial({ visible: false }))
      hit.position.y = TUBE_H / 2
      group.add(hit)

      group.traverse((o) => {
        o.userData.tubeIndex = i
      })
      this.scene.add(group)
      this.pickables.push(group)
      this.tubes.push({
        index: i,
        group,
        liquid,
        liquidMat,
        ring,
        label,
        baseY: BENCH_Y + RACK_BASE,
        topY: BENCH_Y + RACK_BASE + TUBE_H,
        radius,
        liquidTop: BENCH_Y + RACK_BASE + radius * 0.55 + level,
        hover: 0,
        hoverTarget: 0,
        currentColor: new THREE.Color(0xffffff),
      })
    }
  }

  /** A wooden stand: base board, two end posts and a top plate drilled for each tube. */
  private buildRack(span: number, tubeRadius: number) {
    const wood = new THREE.MeshStandardMaterial({ color: 0xb28a58, roughness: 0.62, metalness: 0 })
    const w = span + 0.34
    const depth = 0.15
    const rack = new THREE.Group()
    rack.position.set(0, BENCH_Y, TUBE_Z)

    const base = new THREE.Mesh(new THREE.BoxGeometry(w, RACK_BASE, depth), wood)
    base.position.y = RACK_BASE / 2
    rack.add(base)

    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.15, depth), wood)
      post.position.set((sx * (w - 0.02)) / 2, RACK_BASE + 0.075, 0)
      rack.add(post)
    }

    const shape = new THREE.Shape()
    shape.moveTo(-w / 2, -depth / 2)
    shape.lineTo(w / 2, -depth / 2)
    shape.lineTo(w / 2, depth / 2)
    shape.lineTo(-w / 2, depth / 2)
    shape.closePath()
    const count = Math.round(span / TUBE_SPACING) + 1
    for (let i = 0; i < count; i++) {
      const hole = new THREE.Path()
      hole.absarc(-span / 2 + i * TUBE_SPACING, 0, tubeRadius * 1.25, 0, Math.PI * 2, true)
      shape.holes.push(hole)
    }
    const plate = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.016, bevelEnabled: false, curveSegments: 24 }), wood)
    plate.rotation.x = Math.PI / 2
    plate.position.y = RACK_BASE + 0.16
    rack.add(plate)

    rack.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true
        o.receiveShadow = true
      }
    })
    this.scene.add(rack)
  }

  private liquidGeometry(r: number, h: number): THREE.LatheGeometry {
    const pts: THREE.Vector2[] = []
    const cap = r // hemispherical bottom
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * (Math.PI / 2)
      pts.push(new THREE.Vector2(Math.sin(a) * r, cap - Math.cos(a) * cap))
    }
    pts.push(new THREE.Vector2(r, h))
    pts.push(new THREE.Vector2(0.0001, h))
    return new THREE.LatheGeometry(pts, 32)
  }

  private placeBottles(lesson: ChemistryLessonContract) {
    const inds = lesson.indicators.filter((i) => !i.isPhTest)
    const span = (inds.length - 1) * BOTTLE_SPACING
    const riser = new THREE.Mesh(
      new THREE.BoxGeometry(span + 0.3, RISER_H, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x2a303b, roughness: 0.45, metalness: 0.2 }),
    )
    riser.position.set(0, BENCH_Y + RISER_H / 2, BOTTLE_Z)
    riser.castShadow = true
    riser.receiveShadow = true
    this.scene.add(riser)
    inds.forEach((ind, i) => {
      const x = -span / 2 + i * BOTTLE_SPACING
      const group = new THREE.Group()
      group.position.set(x, BENCH_Y + RISER_H, BOTTLE_Z)
      group.userData.bottleId = ind.id

      const liquidColor = swatchFor(ind.colors.neutral)
      const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xe8f0ff, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0, clearcoat: 1, depthWrite: false })
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.04, 0.12, 28), glassMat)
      body.position.y = 0.06
      body.renderOrder = 2
      const fill = new THREE.Mesh(
        new THREE.CylinderGeometry(0.033, 0.037, 0.085, 28),
        new THREE.MeshPhysicalMaterial({ color: liquidColor.hex, transparent: true, opacity: Math.max(0.55, liquidColor.opacity), roughness: 0.15, depthWrite: false }),
      )
      fill.position.y = 0.047
      fill.renderOrder = 1
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.026, 20), glassMat)
      neck.position.y = 0.133
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.026, 20), new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.5 }))
      cap.position.y = 0.158
      const labelPlane = this.textSprite(ind.name, { size: 52, bg: '#f4f1e8', fg: '#14161a', wide: true })
      labelPlane.scale.set(0.17, 0.055, 1)
      labelPlane.position.set(0, 0.215, 0)

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.052, 0.064, 40),
        new THREE.MeshBasicMaterial({ color: 0x8ab4ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
      )
      ring.rotation.x = -Math.PI / 2
      ring.position.y = 0.004

      group.add(body, fill, neck, cap, labelPlane, ring)
      group.traverse((o) => {
        o.userData.bottleId = ind.id
        if (o instanceof THREE.Mesh) o.castShadow = o !== body
      })
      this.scene.add(group)
      this.pickables.push(group)
      this.bottles.push({ id: ind.id, group, ring, selected: false, active: false, hover: 0, hoverTarget: 0, baseZ: BOTTLE_Z })
    })
  }

  private buildDropper() {
    const g = new THREE.Group()
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xeaf2ff, transparent: true, opacity: 0.35, roughness: 0.05, clearcoat: 1, depthWrite: false })
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.0045, 0.1, 16), glass)
    barrel.position.y = 0.05
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0012, 0.018, 12), glass)
    tip.position.y = -0.007
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0095, 0.012, 16), new THREE.MeshStandardMaterial({ color: 0x20242b, roughness: 0.5 }))
    collar.position.y = 0.105
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.0145, 20, 16), new THREE.MeshStandardMaterial({ color: 0xc2332f, roughness: 0.45 }))
    bulb.scale.set(1, 1.7, 1)
    bulb.position.y = 0.13
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), new THREE.MeshBasicMaterial({ visible: false }))
    hit.position.y = 0.08
    g.add(barrel, tip, collar, bulb, hit)
    g.traverse((o) => {
      o.userData.dropper = true
      if (o instanceof THREE.Mesh) o.castShadow = true
    })
    // Tip marker used for drops & glow
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.0028, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }))
    marker.position.y = -0.014
    g.add(marker)
    g.visible = false
    this.scene.add(g)
    this.dropper = g
    this.dropperBulb = bulb
    this.dropperTip = marker
  }

  private textSprite(
    text: string,
    o: { size: number; bg: string; fg: string; round?: boolean; wide?: boolean },
  ): THREE.Sprite {
    const w = o.wide ? 512 : 192
    const h = o.wide ? 168 : 192
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')!
    ctx.fillStyle = o.bg
    if (o.round) {
      ctx.beginPath()
      ctx.arc(w / 2, h / 2, h / 2 - 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'
      ctx.lineWidth = 6
      ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.roundRect(4, 4, w - 8, h - 8, 28)
      ctx.fill()
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
    tex.anisotropy = 4
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
    sprite.renderOrder = 5
    return sprite
  }

  /** Tell the scene which part of the canvas the HUD covers so the bench stays centred in what is left. */
  setInsets(i: { left: number; right: number; top: number; bottom: number }) {
    this.insetsTarget = { ...i }
    this.updateDefaultFraming()
    if (this.focusIndex === null && !this.userMoved) this.focusing = true
  }

  /** Pull the default camera back until the whole bench fits the free area. */
  private updateDefaultFraming() {
    const W = this.canvas.clientWidth || window.innerWidth
    const H = this.canvas.clientHeight || window.innerHeight
    const freeW = Math.max(240, W - this.insetsTarget.left - this.insetsTarget.right)
    const freeH = Math.max(200, H - this.insetsTarget.top - this.insetsTarget.bottom)
    const vfov = (this.camera.fov * Math.PI) / 180
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (freeW / freeH))
    const needHalfWidth = 0.95
    const needHalfHeight = 0.42
    const dW = needHalfWidth / Math.tan(hfov / 2)
    const dH = needHalfHeight / Math.tan(vfov / 2)
    const d = Math.min(3.8, Math.max(1.25, dW, dH))
    const dir = new THREE.Vector3(0, 0.52, 1.5).normalize()
    this.defaultTarget.set(0, 1.1, -0.05)
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

  /* ---------------- state setters used by the controller ---------------- */
  setBottleSelected(ids: string[], activeId: string | null) {
    for (const b of this.bottles) {
      b.selected = ids.includes(b.id)
      b.active = b.id === activeId
    }
  }

  setLiquidColor(tubeIndex: number, colorName: string, animate = true): Promise<void> {
    const t = this.tubes[tubeIndex]
    if (!t) return Promise.resolve()
    const sw = swatchFor(colorName)
    const from = t.currentColor.clone()
    const to = new THREE.Color(sw.hex)
    const fromOpacity = t.liquidMat.opacity
    t.currentColor.copy(to)
    if (!animate) {
      t.liquidMat.color.copy(to)
      t.liquidMat.opacity = sw.opacity
      return Promise.resolve()
    }
    return this.animate(1400, (k) => {
      t.liquidMat.color.copy(from).lerp(to, k)
      t.liquidMat.opacity = fromOpacity + (sw.opacity - fromOpacity) * k
      t.liquidMat.emissive.copy(to).multiplyScalar(0.35 * Math.sin(k * Math.PI))
    }, easeInOut)
  }

  revealLabel(tubeIndex: number, text: string) {
    const t = this.tubes[tubeIndex]
    if (!t) return
    const sprite = this.textSprite(text, { size: 60, bg: '#f4f1e8', fg: '#14161a', wide: true })
    sprite.scale.set(0.16, 0.052, 1)
    sprite.position.set(0, 0.0, 0.105)
    t.group.add(sprite)
    t.group.remove(t.label)
  }

  focusTube(tubeIndex: number | null) {
    this.focusIndex = tubeIndex
    if (tubeIndex === null) {
      this.focusTarget.copy(this.defaultTarget)
      this.focusPos.copy(this.defaultPos)
    } else {
      const t = this.tubes[tubeIndex]
      this.focusTarget.set(t.group.position.x, BENCH_Y + 0.3, TUBE_Z)
      this.focusPos.set(t.group.position.x * 0.6, BENCH_Y + 0.55, TUBE_Z + 1.0)
    }
    this.focusing = true
    this.userMoved = tubeIndex !== null
  }

  /* ---------------- dropper & paper choreography ---------------- */
  showDropperAt(tubeIndex: number, color: string) {
    const t = this.tubes[tubeIndex]
    if (!this.dropper || !t) return
    this.dropper.visible = true
    this.dropperVisible = true
    this.dropperClickable = true
    ;(this.dropperTip!.material as THREE.MeshBasicMaterial).color.set(swatchFor(color).hex)
    const target = new THREE.Vector3(t.group.position.x, t.topY + 0.1, TUBE_Z)
    const from = this.dropper.position.lengthSq() === 0 ? new THREE.Vector3(target.x, target.y + 0.25, target.z + 0.2) : this.dropper.position.clone()
    this.dropper.rotation.set(0, 0, 0)
    void this.animate(600, (k) => this.dropper!.position.lerpVectors(from, target, k), easeOut)
  }

  hideDropper() {
    if (!this.dropper) return
    this.dropper.visible = false
    this.dropperVisible = false
    this.dropperClickable = false
    this.dropper.position.set(0, 0, 0)
  }

  async playAddIndicator(tubeIndex: number, indicatorColor: string, resultColor: string): Promise<void> {
    const t = this.tubes[tubeIndex]
    if (!t || !this.dropper || !this.dropperBulb || !this.dropperTip) return
    this.dropperClickable = false
    const tipWorld = new THREE.Vector3()
    const dropColor = swatchFor(indicatorColor).hex
    for (let n = 0; n < 3; n++) {
      // squeeze
      await this.animate(160, (k) => this.dropperBulb!.scale.set(1 + 0.15 * Math.sin(k * Math.PI), 1.7 - 0.55 * Math.sin(k * Math.PI), 1 + 0.15 * Math.sin(k * Math.PI)))
      this.dropperTip.getWorldPosition(tipWorld)
      await this.fallDrop(tipWorld, t.liquidTop, dropColor)
      this.ripple(new THREE.Vector3(t.group.position.x, t.liquidTop + 0.001, TUBE_Z), dropColor)
      if (n === 0) this.bubble(t, 14)
    }
    await this.setLiquidColor(tubeIndex, resultColor, true)
    this.bubble(t, 10)
    // withdraw
    const from = this.dropper.position.clone()
    await this.animate(500, (k) => this.dropper!.position.set(from.x, from.y + 0.18 * k, from.z + 0.12 * k), easeInOut)
    this.hideDropper()
  }

  async playPhDip(tubeIndex: number, resultColor: string): Promise<void> {
    const t = this.tubes[tubeIndex]
    if (!t) return
    const sw = swatchFor(resultColor)
    const strip = new THREE.Group()
    const paper = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.11, 0.0015), new THREE.MeshStandardMaterial({ color: 0xe7dcc2, roughness: 0.9 }))
    paper.position.y = -0.055
    const tipPaper = new THREE.Mesh(new THREE.BoxGeometry(0.0145, 0.04, 0.0016), new THREE.MeshStandardMaterial({ color: 0xe7dcc2, roughness: 0.9 }))
    tipPaper.position.y = -0.09
    strip.add(paper, tipPaper)
    strip.traverse((o) => {
      o.userData.tubeIndex = tubeIndex
      if (o instanceof THREE.Mesh) o.castShadow = true
    })
    const x = t.group.position.x
    strip.position.set(x, t.topY + 0.18, TUBE_Z + 0.004)
    this.scene.add(strip)
    const startY = strip.position.y
    const dipY = t.liquidTop + 0.035
    await this.animate(700, (k) => (strip.position.y = startY + (dipY - startY) * k), easeInOut)
    const mat = tipPaper.material as THREE.MeshStandardMaterial
    const base = new THREE.Color(0xe7dcc2)
    const to = new THREE.Color(sw.hex)
    await this.animate(900, (k) => mat.color.copy(base).lerp(to, k), easeInOut)
    await this.animate(600, (k) => (strip.position.y = dipY + (startY + 0.04 - dipY) * k), easeInOut)

    // The used strip rests on the bench in front of the tube so the colour can be read against the key.
    const rest = new THREE.Vector3(x, BENCH_Y + 0.0015, TUBE_Z + 0.16)
    const from = strip.position.clone()
    const rot0 = strip.rotation.x
    await this.animate(700, (k) => {
      strip.position.lerpVectors(from, rest, k)
      strip.rotation.x = rot0 + (-Math.PI / 2 - rot0) * k
    }, easeInOut)
    strip.rotation.x = -Math.PI / 2
    strip.position.y = BENCH_Y + 0.0015
    strip.position.z = TUBE_Z + 0.16 + 0.04
  }

  private fallDrop(from: THREE.Vector3, endY: number, color: number): Promise<void> {
    const drop = new THREE.Mesh(new THREE.SphereGeometry(0.0034, 12, 10), new THREE.MeshPhysicalMaterial({ color, roughness: 0.1, transparent: true, opacity: 0.95 }))
    drop.scale.y = 1.35
    drop.position.copy(from)
    this.scene.add(drop)
    const dist = from.y - endY
    return this.animate(Math.max(160, Math.sqrt(dist / 4.9) * 1000), (k) => (drop.position.y = from.y - dist * k * k)).then(() => {
      this.scene.remove(drop)
      drop.geometry.dispose()
    })
  }

  private ripple(at: THREE.Vector3, color: number) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.004, 0.0065, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }))
    ring.rotation.x = -Math.PI / 2
    ring.position.copy(at)
    ring.renderOrder = 4
    this.scene.add(ring)
    void this.animate(700, (k) => {
      ring.scale.setScalar(1 + k * 3.2)
      ;(ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k)
    }).then(() => {
      this.scene.remove(ring)
      ring.geometry.dispose()
    })
  }

  private bubble(t: Tube, count: number) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.0016 + Math.random() * 0.0016, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }))
      const a = Math.random() * Math.PI * 2
      const rr = Math.random() * t.radius * 0.55
      m.position.set(t.group.position.x + Math.cos(a) * rr, t.baseY + t.radius * 0.7, TUBE_Z + Math.sin(a) * rr)
      m.userData.max = t.liquidTop
      m.renderOrder = 3
      this.scene.add(m)
      this.bubbles.push({ mesh: m, vy: 0.05 + Math.random() * 0.06, life: 0 })
    }
  }

  /* ---------------- tweens ---------------- */
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

  /* ---------------- input ---------------- */
  private setPointer(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect()
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
  }

  private pick(): { tube: number | null; bottle: string | null; dropper: boolean } {
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const targets: THREE.Object3D[] = [...this.pickables]
    if (this.dropperVisible && this.dropperClickable && this.dropper) targets.push(this.dropper)
    const hits = this.raycaster.intersectObjects(targets, true).filter((h) => !(h.object instanceof THREE.Sprite && h.object.userData.tubeIndex === undefined && h.object.userData.bottleId === undefined))
    for (const h of hits) {
      if (h.object.userData.dropper) return { tube: null, bottle: null, dropper: true }
      if (typeof h.object.userData.tubeIndex === 'number') return { tube: h.object.userData.tubeIndex, bottle: null, dropper: false }
      if (typeof h.object.userData.bottleId === 'string') return { tube: null, bottle: h.object.userData.bottleId, dropper: false }
    }
    return { tube: null, bottle: null, dropper: false }
  }

  private onPointerMove = (e: PointerEvent) => {
    this.setPointer(e)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const p = new THREE.Vector3()
    if (this.raycaster.ray.intersectPlane(this.benchPlane, p)) this.handPoint.copy(p)
    const hit = this.pick()
    this.hoveredTube = hit.tube ?? -1
    this.hoveredBottle = hit.bottle ?? ''
    this.canvas.style.cursor = hit.tube !== null || hit.bottle || hit.dropper ? 'pointer' : e.buttons ? 'grabbing' : 'grab'
  }
  private onPointerLeave = () => {
    this.hoveredTube = -1
    this.hoveredBottle = ''
    this.pointer.set(10, 10)
  }
  private onPointerDown = (e: PointerEvent) => {
    this.downAt = { x: e.clientX, y: e.clientY, t: performance.now() }
  }
  private onPointerUp = (e: PointerEvent) => {
    const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y)
    if (moved > 6 || performance.now() - this.downAt.t > 600) return
    this.setPointer(e)
    const hit = this.pick()
    if (hit.dropper) this.events.onDropperClick()
    else if (hit.tube !== null) this.events.onTubeClick(hit.tube)
    else if (hit.bottle) this.events.onBottleClick(hit.bottle)
  }

  /* ---------------- loop ---------------- */
  private resize() {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    // Narrow screens: pull back so the whole bench stays in frame.
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
      if (this.focusIndex === null) {
        // Keep tracking the default framing: it changes while panels slide in and out.
        this.focusTarget.copy(this.defaultTarget)
        this.focusPos.copy(this.defaultPos)
      }
      const k = 1 - Math.pow(0.0015, dt)
      this.controls.target.lerp(this.focusTarget, k)
      this.camera.position.lerp(this.focusPos, k)
      if (this.focusIndex !== null && this.controls.target.distanceTo(this.focusTarget) < 0.002) this.focusing = false
    }
    this.applyInsets(dt)
    this.controls.update()

    for (const t of this.tubes) {
      t.hoverTarget = this.hoveredTube === t.index ? 1 : 0
      t.hover += (t.hoverTarget - t.hover) * Math.min(1, dt * 12)
      ;(t.ring.material as THREE.MeshBasicMaterial).opacity = t.hover * 0.85
      t.ring.scale.setScalar(1 + t.hover * 0.12 + Math.sin(time * 4) * 0.02 * t.hover)
      t.label.scale.setScalar(0.06 * (1 + t.hover * 0.25))
      t.liquidMat.emissive.multiplyScalar(Math.pow(0.2, dt))
    }
    for (const b of this.bottles) {
      b.hoverTarget = this.hoveredBottle === b.id ? 1 : 0
      b.hover += (b.hoverTarget - b.hover) * Math.min(1, dt * 12)
      const lift = b.selected ? 0.1 : 0
      const targetZ = b.baseZ + lift + b.hover * 0.025
      b.group.position.z += (targetZ - b.group.position.z) * Math.min(1, dt * 10)
      b.group.position.y = BENCH_Y + RISER_H + (b.active ? 0.012 + Math.sin(time * 3) * 0.006 : 0) + b.hover * 0.004
      ;(b.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(b.hover * 0.6, b.selected ? 0.85 : 0, b.active ? 1 : 0)
      ;(b.ring.material as THREE.MeshBasicMaterial).color.set(b.active ? 0xffd166 : 0x8ab4ff)
    }

    if (this.dropper && this.dropperVisible && this.dropperClickable) {
      this.dropper.position.y += Math.sin(time * 3.2) * 0.00045
      const k = 1 + Math.sin(time * 5) * 0.06
      this.dropperBulb!.scale.set(1, 1.7 * k, 1)
    }

    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i]
      b.life += dt
      b.mesh.position.y += b.vy * dt
      ;(b.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 * Math.max(0, 1 - b.life / 1.3)
      if (b.life > 1.3 || b.mesh.position.y > (b.mesh.userData.max as number)) {
        this.scene.remove(b.mesh)
        b.mesh.geometry.dispose()
        this.bubbles.splice(i, 1)
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
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
        o.geometry.dispose()
        const m = o.material
        for (const mat of Array.isArray(m) ? m : [m]) mat.dispose()
      }
    })
    this.renderer.dispose()
  }
}
