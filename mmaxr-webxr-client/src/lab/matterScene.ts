import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { MotionLessonContract } from '@mmaxr/schema'
import { sound } from './sound'
import { stageSet } from './stage'
import type { MotionSceneEvents } from './motionScene'
import { SceneBase, V, easeInOut, f1, f2, num, smooth } from './sceneBase'
import { apparentWeightN, boatFloats, bowlDepth, buoyantN, displacedCm3, weightN, floats, heatDuration, heatState, layerOrder, massOf, scaleMass, submergedFraction } from './matterPhysics'

/*
 * Three small labs in one scene: a hot plate on a scale (states of matter), a bench of tools and samples (physical
 * and chemical change) and a density bench with a scale and a measuring cylinder. The scene only simulates and
 * draws. It never names an answer: what a result means comes from the server, after the student has watched it.
 */

/** The bench's dishes stand on a tripod this high, so the burner can sit under them. */
const RAISE = 3.1
// where the Archimedes equipment stands along the density bench, and the spring scale's ruler
const CAN_X = 18
const SPRING_X = 27
const TANK_X = 33.5
const RULER_TOP = 9.2
const RULER_PER_N = 0.27
const IDS = ['states_changes', 'properties_changes', 'density_measurement']
const X = { states_changes: 0, properties_changes: 300, density_measurement: 600 } as Record<string, number>

const glassMat = () => new THREE.MeshPhysicalMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0, side: THREE.DoubleSide, depthWrite: false })
const std = (color: number, rough = 0.6, metal = 0.1) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal })

/** A hollow glass cylinder with an open top, standing on y = 0. */
function glassBeaker(r: number, h: number): THREE.Group {
  const g = new THREE.Group()
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.98, h, 40, 1, true), glassMat())
  wall.position.y = h / 2
  wall.renderOrder = 5
  const base = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.98, r * 0.98, 0.06, 40), glassMat())
  base.position.y = 0.03
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.025, 8, 40), new THREE.MeshStandardMaterial({ color: 0xdff1ff, transparent: true, opacity: 0.5 }))
  rim.rotation.x = Math.PI / 2
  rim.position.y = h
  g.add(wall, base, rim)
  return g
}

/** A solid coloured cylinder (a liquid) sitting on y = 0 that can be set to any height. */
class Liquid extends THREE.Mesh {
  constructor(
    private readonly r: number,
    color: number,
    opacity = 0.85,
  ) {
    super(new THREE.CylinderGeometry(r, r, 1, 40), new THREE.MeshStandardMaterial({ color, transparent: true, opacity, roughness: 0.15, metalness: 0, depthWrite: false }))
    this.renderOrder = 3
    this.setLevel(0, 0)
  }
  /** Fills from `bottom` to `top`. */
  setLevel(bottom: number, top: number) {
    const h = Math.max(0.0001, top - bottom)
    this.scale.set(1, h, 1)
    this.position.y = bottom + h / 2
    this.visible = top - bottom > 0.003
  }
  get radius() {
    return this.r
  }
}

interface Puff {
  p: THREE.Vector3
  v: THREE.Vector3
  life: number
}

export class MatterScene extends SceneBase {
  private models: Record<string, THREE.Object3D | null> = {}
  private liquids: Record<string, { name: string; density: number; color: number }>
  private pans: { anchor: THREE.Group; massLabel: THREE.Sprite; top: number; radius: number }[] = []

  // ---- tab 1: the hot plate ----
  private plate = new THREE.Group()
  private plateGlow!: THREE.Mesh
  private beaker!: THREE.Group
  private water!: Liquid
  private iceCubes: THREE.Mesh[] = []
  private bubbles: THREE.Mesh[] = []
  private steamCloud!: THREE.Mesh
  private lid!: THREE.Group
  private steam!: THREE.Points
  private puffs: Puff[] = []
  private tempLabel!: THREE.Sprite
  private heatLight!: THREE.PointLight
  private thermo = new THREE.Group()
  private chambers: THREE.Group[] = []
  private chamberParticles: { mesh: THREE.Mesh; home: THREE.Vector3; kind: string; ph: number; dir: THREE.Vector3 }[][] = []
  private pistons: THREE.Mesh[] = []
  private statesStage = new THREE.Group()

  // ---- tab 2: the test bench ----
  private bench = new THREE.Group()
  private dishGroups: THREE.Group[] = []
  private samples: THREE.Group[] = []
  private burner = new THREE.Group()
  private flame!: THREE.Mesh
  private flameLight!: THREE.PointLight
  private hammer = new THREE.Group()
  private magnetTool = new THREE.Group()
  private circuit = new THREE.Group()
  private bulb!: THREE.Mesh
  private bulbLight!: THREE.PointLight
  private tube = new THREE.Group()
  private beaker2 = new THREE.Group()
  private water2!: Liquid
  private flash!: THREE.PointLight
  private vapor!: THREE.Mesh
  private sampleLabel!: THREE.Sprite

  // ---- tab 3: the density bench ----
  private cyl = new THREE.Group()
  private cylLiquid!: Liquid
  private cylInfo = { radius: 0.3, bottom: 0.4, top: 4.0 }
  private bottles: THREE.Group[] = []
  private stream!: THREE.Mesh
  private jar = new THREE.Group()
  private layers: Liquid[] = []
  private jarInfo = { r: 1.0, h: 5 }
  private layerLabels: THREE.Sprite[] = []
  private dropper = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>(new THREE.SphereGeometry(0.4, 24, 16), std(0xcccccc))
  private objLabel!: THREE.Sprite
  private stationLabel!: THREE.Sprite

  // ---- tab 3, part two: Archimedes' principle ----
  private archi = new THREE.Group()
  private can = new THREE.Group()
  private canWater!: Liquid
  private catchTube = new THREE.Group()
  private catchLiquid!: Liquid
  private cube!: THREE.Mesh
  private springGroup = new THREE.Group()
  private spring!: THREE.Mesh
  private block!: THREE.Mesh
  private ruler = new THREE.Group()
  private needleMark!: THREE.Mesh
  private beakerA = new THREE.Group()
  private beakerWater!: Liquid
  private arrowUp = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 14), new THREE.MeshBasicMaterial({ color: 0x4ade80 }))
  private arrowDown = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 14), new THREE.MeshBasicMaterial({ color: 0xff5470 }))
  private shaftUp = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 10), new THREE.MeshBasicMaterial({ color: 0x4ade80 }))
  private shaftDown = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 10), new THREE.MeshBasicMaterial({ color: 0xff5470 }))
  private tank = new THREE.Group()
  private tankWater!: Liquid
  private clay = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), std(0x9a6b3f, 0.85))
  private boat = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9a6b3f, roughness: 0.85, side: THREE.DoubleSide }))
  private archiLabel!: THREE.Sprite

  constructor(canvas: HTMLCanvasElement, private readonly lesson: MotionLessonContract, events: MotionSceneEvents = {}) {
    super(canvas, events)
    this.liquids = lesson.liquids ?? {}
    this.makeGroups(IDS)
    this.buildStates()
    this.buildBench()
    this.buildDensity()
    this.buildArchimedes()
    this.sizeNow()
  }

  /* =============================== loading =============================== */
  async load(): Promise<void> {
    const loader = new GLTFLoader()
    const a = this.lesson.assets
    const keys = ['cylinder', 'thermometer', 'scale', 'burner', 'hammer', 'magnet']
    let done = 0
    const get = async (url: string | undefined) => {
      if (!url) return null
      const r = await loader.loadAsync(url).then((x) => x.scene).catch((err) => {
        console.warn('[matter] model failed to load, using a stand-in', url, err)
        return null
      })
      this.events.onProgress?.(++done, keys.length)
      return r
    }
    const loaded = await Promise.all(keys.map((k) => get(a[k])))
    if (this.disposed) return
    keys.forEach((k, i) => (this.models[k] = loaded[i]))
    this.dressScales()
    this.dressThermometer()
    this.dressTools()
    this.dressCylinder()
  }

  private fitTo(model: THREE.Object3D, size: number, axis: 'x' | 'y' | 'z' = 'y'): THREE.Group {
    const m = model.clone(true)
    const holder = new THREE.Group()
    holder.add(m)
    holder.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(holder)
    const s = box.getSize(new THREE.Vector3())
    holder.scale.setScalar(size / (s[axis] || 1))
    holder.updateMatrixWorld(true)
    const b2 = new THREE.Box3().setFromObject(holder)
    const c = b2.getCenter(new THREE.Vector3())
    m.position.x -= c.x / holder.scale.x
    m.position.z -= c.z / holder.scale.z
    m.position.y -= b2.min.y / holder.scale.y
    m.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true
        o.receiveShadow = true
      }
    })
    return holder
  }

  /* =============================== the scale =============================== */
  /**
   * A hanging balance with a pan, from the model if it loaded. `anchor` is where things sit: the middle of the
   * pan. A gantry holds the balance up. The label above it shows the mass.
   */
  private buildScale(parent: THREE.Group, x: number, radius: number): { anchor: THREE.Group; massLabel: THREE.Sprite } {
    const g = new THREE.Group()
    g.position.x = x
    parent.add(g)
    const anchor = new THREE.Group()
    anchor.position.y = 2.1
    g.add(anchor)
    // the pan: a shallow dish hanging on three chains from a ring (stand-in until the model is dressed on)
    const pan = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.85, 0.28, 48), new THREE.MeshStandardMaterial({ color: 0xb8892f, metalness: 0.95, roughness: 0.3 }))
    pan.name = 'pan-fallback'
    pan.position.y = 1.95
    pan.castShadow = true
    g.add(pan)
    const beam = new THREE.Mesh(new THREE.BoxGeometry(radius * 2.4, 0.18, 0.4), std(0x2a2f39, 0.5, 0.7))
    beam.position.y = 7.6
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 7.6, 16), std(0x2a2f39, 0.5, 0.7))
    post.position.set(-radius * 1.3, 3.8, -0.4)
    const post2 = post.clone()
    post2.position.x = radius * 1.3
    for (const o of [beam, post, post2]) o.name = 'gantry'
    g.add(beam, post, post2)
    const massLabel = this.label('Scale: 0.0 g', '#9fe6b0', 1.1)
    massLabel.position.set(0, 8.6, 0)
    g.add(massLabel)
    this.pans.push({ anchor, massLabel, top: 2.1, radius })
    g.userData.scaleHolder = new THREE.Group()
    g.add(g.userData.scaleHolder as THREE.Group)
    return { anchor, massLabel }
  }

  /**
   * Swaps the stand-in for the balance model. The model is a beam balance with two brass pans; the load rides on its
   * right-hand pan, so the model is scaled until that pan is as wide as we need, and placed so the middle of the pan
   * is the station's origin.
   */
  private dressScales() {
    const model = this.models.scale
    if (!model) return
    for (const p of this.pans) {
      const g = p.anchor.parent as THREE.Group
      const m = model.clone(true)
      const holder = new THREE.Group()
      holder.add(m)
      holder.updateMatrixWorld(true)
      // the vertices of the right-hand brass pan, in the model's own units
      const brass = m.getObjectByName('panbrass') ?? m
      const pts: THREE.Vector3[] = []
      const whole = new THREE.Box3().setFromObject(m)
      const midX = (whole.min.x + whole.max.x) / 2
      brass.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        const pos = o.geometry.attributes.position
        for (let i = 0; i < pos.count; i++) {
          const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld)
          if (v.x > midX) pts.push(v)
        }
      })
      const pan = new THREE.Box3().setFromPoints(pts.length ? pts : [whole.min, whole.max])
      const k = (p.radius * 2.1) / Math.max(0.001, pan.max.x - pan.min.x)
      holder.scale.setScalar(k)
      holder.position.set(-((pan.min.x + pan.max.x) / 2) * k, p.top - pan.max.y * k + 0.12, -((pan.min.z + pan.max.z) / 2) * k)
      m.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = true
          o.receiveShadow = true
        }
      })
      g.add(holder)
      g.children.filter((c) => c.name === 'gantry' || c.name === 'pan-fallback').forEach((c) => (c.visible = false))
      holder.updateMatrixWorld(true)
      const total = new THREE.Box3().setFromObject(holder)
      void total
      p.massLabel.position.set(0.3, p.top + 4.3, 2.2)
    }
  }

  private setMass(i: number, grams: number, text?: string) {
    this.relabel(this.pans[i].massLabel, text ?? `Scale: ${f1(grams)} g`)
  }

  /* =============================== tab 1 =============================== */
  private buildStates() {
    const g = this.groups.states_changes
    stageSet(g, { cx: 1, cz: 0, w: 26, d: 14, wall: { z: -7.4, h: 12 }, key: [3, 15, 10], aim: [0, 3, 0], keyI: 1000, rimI: 170, rimAt: [14, 8, -3], dust: { n: 140, h: 8 } })
    g.add(this.statesStage)
    const { anchor } = this.buildScale(g, 0, 2.0)
    // hot plate and beaker, riding on the pan
    const plateBody = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.34, 40), std(0x2a2f39, 0.45, 0.6))
    plateBody.position.y = 0.17
    plateBody.castShadow = true
    this.plateGlow = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.04, 40), new THREE.MeshStandardMaterial({ color: 0x331000, emissive: 0xff3300, emissiveIntensity: 0 }))
    this.plateGlow.position.y = 0.355
    this.plate.add(plateBody, this.plateGlow)
    this.plate.position.y = 0
    anchor.add(this.plate)
    this.heatLight = new THREE.PointLight(0xff5a1f, 0, 6)
    this.heatLight.position.set(0, 0.8, 0)
    this.plate.add(this.heatLight)
    this.beaker = glassBeaker(0.95, 2.2)
    this.beaker.position.y = 0.38
    anchor.add(this.beaker)
    this.water = new Liquid(0.9, 0x5aa9ff, 0.55)
    this.beaker.add(this.water)
    // ice: a pile of pale cubes
    const iceMat = new THREE.MeshStandardMaterial({ color: 0xdff4ff, transparent: true, opacity: 0.8, roughness: 0.1 })
    for (let i = 0; i < 9; i++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), iceMat)
      const a = (i / 9) * Math.PI * 2
      c.userData.home = V(Math.cos(a) * 0.38 * (i % 2 ? 1 : 0.5), 0, Math.sin(a) * 0.38 * (i % 2 ? 1 : 0.5))
      c.rotation.set(i * 0.7, i * 1.3, i * 0.4)
      this.beaker.add(c)
      this.iceCubes.push(c)
    }
    // bubbles
    const bm = new THREE.MeshBasicMaterial({ color: 0xe8f6ff, transparent: true, opacity: 0.6 })
    for (let i = 0; i < 16; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.06 + (i % 3) * 0.02, 10, 8), bm)
      b.userData.ph = i * 0.37
      b.visible = false
      this.beaker.add(b)
      this.bubbles.push(b)
    }
    // steam: a puff system above the beaker, and a cloud that fills a sealed flask
    const pos = new Float32Array(90 * 3)
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.steam = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xf2f8ff, size: 0.22, transparent: true, opacity: 0.55, depthWrite: false }))
    this.steam.frustumCulled = false
    this.beaker.add(this.steam)
    for (let i = 0; i < 90; i++) this.puffs.push({ p: V(0, -10, 0), v: V(), life: -1 })
    this.steamCloud = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.88, 1, 32), new THREE.MeshBasicMaterial({ color: 0xf4f9ff, transparent: true, opacity: 0, depthWrite: false }))
    this.beaker.add(this.steamCloud)
    // a stopper for the sealed runs
    this.lid = new THREE.Group()
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.7, 0.5, 28), std(0xc86b3c, 0.8))
    cap.position.y = 2.45
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.07, 8, 32), std(0x8f9aa8, 0.4, 0.8))
    ring.rotation.x = Math.PI / 2
    ring.position.y = 2.2
    this.lid.add(cap, ring)
    this.lid.visible = false
    this.beaker.add(this.lid)
    this.tempLabel = this.label('Temperature: –', '#ffb3a0', 1.1)
    this.tempLabel.position.set(5.4, 3.6, 1.6)
    g.add(this.tempLabel)
    this.thermo.position.set(5.4, 0.05, 2.4)
    g.add(this.thermo)
    // the particle chambers for the states of matter question
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Group()
      c.position.set(-6 + i * 6, 0, 0)
      const box = new THREE.Mesh(new THREE.BoxGeometry(3.4, 4.4, 1.6), glassMat())
      box.position.y = 2.4
      box.renderOrder = 5
      const piston = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.25, 1.5), std(0x8f9aa8, 0.4, 0.8))
      piston.position.y = 4.55
      this.pistons.push(piston)
      const name = this.label(['Solid', 'Liquid', 'Gas'][i], '#e6edf7', 0.8)
      name.position.set(0, 5.6, 0)
      c.add(box, piston, name)
      c.visible = false
      g.add(c)
      this.chambers.push(c)
      const list: (typeof this.chamberParticles)[number] = []
      const kind = ['solid', 'liquid', 'gas'][i]
      const mat = new THREE.MeshStandardMaterial({ color: [0x7fb0ff, 0x6fd0a8, 0xffb36b][i], roughness: 0.3, metalness: 0.2 })
      const n = kind === 'gas' ? 14 : 30
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), mat)
        let home: THREE.Vector3
        if (kind === 'solid') home = V(-1.3 + (k % 6) * 0.52, 0.4 + Math.floor(k / 6) * 0.52, -0.5 + ((k + Math.floor(k / 6)) % 2) * 0.5)
        else if (kind === 'liquid') home = V(-1.4 + (k % 7) * 0.46 + (Math.random() - 0.5) * 0.12, 0.35 + Math.floor(k / 7) * 0.42, -0.5 + (k % 3) * 0.45)
        else home = V((Math.random() - 0.5) * 2.8, 0.5 + Math.random() * 3.4, (Math.random() - 0.5) * 1.1)
        m.position.copy(home)
        c.add(m)
        list.push({ mesh: m, home, kind, ph: Math.random() * 6.28, dir: V(Math.random() - 0.5, Math.random() - 0.5, (Math.random() - 0.5) * 0.4).normalize() })
      }
      this.chamberParticles.push(list)
    }
  }

  private dressThermometer() {
    const m = this.models.thermometer
    this.thermo.clear()
    if (m) {
      const t = this.fitTo(m, 3.2, 'x')
      t.rotation.y = -0.5
      this.thermo.add(t)
    } else {
      const body = new THREE.Mesh(new THREE.BoxGeometry(3, 0.25, 0.5), std(0xf2f2f2, 0.4))
      body.position.y = 0.15
      this.thermo.add(body)
    }
  }

  /** Puts the beaker, ice and water in order for one run. */
  private setupHeat(p: { mode: string; sub: number; beaker: number; lid: boolean; show: string }) {
    const open = p.mode === 'boil_open'
    void open
    this.lid.visible = p.lid
    this.statesStage.visible = true
    for (const c of this.chambers) c.visible = false
    this.beaker.visible = true
    this.plate.visible = true
    this.thermo.visible = true
    this.tempLabel.visible = true
    this.pans[0].anchor.parent!.visible = true
    const full = Math.max(0.7, Math.min(1.7, 0.45 + (p.sub / 300) * 1.4))
    this.beaker.userData.full = full
    const st = heatState(p.mode, 0, p.show)
    this.applyHeat(p, st, 0)
    return full
  }

  private applyHeat(p: { mode: string; sub: number; beaker: number; lid: boolean; show: string }, st: ReturnType<typeof heatState>, t: number) {
    const full = (this.beaker.userData.full as number) ?? 1.2
    const sealed = p.lid
    const waterLevel = Math.max(0.04, full * st.melted * (1 - st.boiled) + 0.04)
    const startsFrozen = p.mode === 'melt' || (p.mode === 'curve' && p.show !== 'boil' && p.show !== 'volume')
    const startsWater = p.mode === 'freeze' || p.mode === 'boil_sealed' || p.mode === 'boil_open' || p.show === 'boil' || p.show === 'volume'
    // the amount of liquid (or ice) in the beaker
    let liquid = startsWater && p.mode !== 'freeze' ? full * (1 - st.boiled) : waterLevel
    if (p.mode === 'freeze') liquid = full * st.melted + 0.04
    if (startsFrozen) liquid = full * st.melted + 0.04
    this.water.setLevel(0.1, 0.1 + liquid)
    const wm = this.water.material as THREE.MeshStandardMaterial
    wm.color.setHex(st.T > 99.5 ? 0x8cc6ff : 0x5aa9ff)
    const iceFrac = p.mode === 'freeze' ? 1 - st.melted : startsFrozen ? 1 - st.melted : 0
    this.iceCubes.forEach((c, i) => {
      const home = c.userData.home as THREE.Vector3
      c.visible = iceFrac > 0.02 && i < Math.ceil(9 * Math.min(1, p.sub / 200 + 0.4))
      c.scale.setScalar(Math.max(0.05, iceFrac))
      c.position.set(home.x, 0.1 + Math.max(0.2, liquid) + 0.12 * iceFrac * (1 + (i % 2)), home.z)
    })
    const boiling = st.phase === 'boiling'
    this.bubbles.forEach((b) => {
      b.visible = boiling
      if (boiling) {
        const ph = (t * 1.4 + (b.userData.ph as number)) % 1
        b.position.set(Math.cos(b.userData.ph * 5) * 0.6, 0.15 + ph * Math.max(0.4, liquid), Math.sin(b.userData.ph * 7) * 0.6)
      }
    })
    this.steamCloud.visible = sealed
    const cloud = sealed ? st.boiled : 0
    ;(this.steamCloud.material as THREE.MeshBasicMaterial).opacity = cloud * 0.5
    this.steamCloud.scale.set(1, Math.max(0.01, 2.0 - liquid), 1)
    this.steamCloud.position.y = 0.1 + liquid + (2.0 - liquid) / 2
    const glow = p.mode === 'freeze' ? 0 : st.phase === 'ice' && p.mode === 'melt' ? 0.5 : 1
    const em = this.plateGlow.material as THREE.MeshStandardMaterial
    if (p.mode === 'freeze') {
      em.emissive.setHex(0x2288ff)
      em.emissiveIntensity = 1.2
      this.heatLight.color.setHex(0x4aa8ff)
      this.heatLight.intensity = 6
    } else {
      em.emissive.setHex(0xff3300)
      em.emissiveIntensity = glow * 1.6
      this.heatLight.color.setHex(0xff5a1f)
      this.heatLight.intensity = glow * 8
    }
  }

  private puffSteam(dt: number, rate: number, open: boolean) {
    const pos = this.steam.geometry.attributes.position as THREE.BufferAttribute
    for (const q of this.puffs) {
      if (q.life < 0) {
        if (rate > 0 && Math.random() < rate * dt * 40 / this.puffs.length) {
          q.life = 1
          q.p.set((Math.random() - 0.5) * 1.2, 1.6, (Math.random() - 0.5) * 1.2)
          q.v.set((Math.random() - 0.5) * 0.3, 1.2 + Math.random() * 0.8, (Math.random() - 0.5) * 0.3)
        }
        continue
      }
      q.life -= dt * (open ? 0.35 : 0.8)
      q.p.addScaledVector(q.v, dt)
      if (!open && q.p.y > 2.3) q.v.y = -Math.abs(q.v.y) * 0.5
      if (q.life <= 0) q.p.set(0, -10, 0)
    }
    this.puffs.forEach((q, i) => pos.setXYZ(i, q.p.x, q.life < 0 ? -10 : q.p.y, q.p.z))
    pos.needsUpdate = true
  }

  private async runHeat(p: { mode: string; sub: number; beaker: number; lid: boolean; show: string }): Promise<void> {
    this.abort()
    const open = p.mode === 'boil_open'
    this.setupHeat(p)
    const v = this.view('states')
    await this.flyTo(v.pos, v.target, 1200)
    if (this.disposed) return
    const total = heatDuration(p.mode, p.show)
    const st = { t: 0 }
    const phaseName: Record<string, string> = { ice: 'Ice', melting: p.mode === 'freeze' ? 'Freezing' : 'Melting', water: 'Water', boiling: 'Boiling', steam: 'Steam' }
    return this.begin({
      update: (dt) => {
        st.t += dt
        const s = heatState(p.mode, st.t, p.show)
        this.applyHeat(p, s, st.t)
        this.puffSteam(dt, s.phase === 'boiling' ? 1 : s.T > 80 ? 0.15 : 0, open || !p.lid)
        const mass = scaleMass(p.beaker, p.sub, s.boiled, open)
        this.setMass(0, mass)
        this.relabel(this.tempLabel, `Temperature: ${f1(s.T)} °C`, s.T > 50 ? '#ffb3a0' : s.T < 1 ? '#a8d8ff' : '#ffe0b3')
        this.emitGauges(dt, () => [
          { label: 'Temperature', value: `${f1(s.T)} °C`, tone: 'warn' },
          { label: 'State', value: phaseName[s.phase], tone: 'info' },
          { label: 'Scale', value: `${f1(mass)} g`, tone: 'ok' },
          { label: 'Time', value: `${f1(st.t)} s` },
        ])
        if (st.t > total + 0.2) {
          this.events.onNote?.(p.mode === 'boil_open' ? 'The scale fell: the missing mass is the steam that escaped into the air.' : p.show === 'melt' || p.show === 'boil' ? 'The temperature stayed put while the state was changing.' : 'The scale reads exactly what it did at the start.')
          return 800
        }
        return null
      },
      done: () => this.puffs.forEach((q) => (q.life = -1)),
    })
  }

  private async runParticles(focus: string): Promise<void> {
    this.abort()
    this.statesStage.visible = true
    this.pans[0].anchor.parent!.visible = false
    this.thermo.visible = false
    this.tempLabel.visible = false
    this.chambers.forEach((c) => (c.visible = true))
    const v = this.view('chambers')
    await this.flyTo(v.pos, v.target, 1200)
    if (this.disposed) return
    const st = { t: 0 }
    const names = ['solid', 'liquid', 'gas']
    return this.begin({
      update: (dt) => {
        st.t += dt
        const press = smooth(4, 6.5, st.t)
        // pistons squash each chamber: the solid will not, the liquid barely, the gas easily
        const squash = [0.02, 0.05, 0.62]
        this.pistons.forEach((pi, i) => (pi.position.y = 4.55 - press * squash[i] * 3.8))
        this.chamberParticles.forEach((list, ci) => {
          const kind = names[ci]
          for (const q of list) {
            const m = q.mesh
            q.ph += dt
            if (kind === 'solid') m.position.set(q.home.x + Math.sin(q.ph * 18) * 0.04, q.home.y + Math.sin(q.ph * 15 + 1) * 0.04, q.home.z)
            else if (kind === 'liquid') {
              m.position.set(q.home.x + Math.sin(q.ph * 3 + q.home.y * 4) * 0.22, q.home.y + Math.sin(q.ph * 2.3 + q.home.x * 3) * 0.1 - press * 0.1, q.home.z + Math.cos(q.ph * 2) * 0.12)
            } else {
              const room = 4.4 * (1 - press * 0.62)
              q.home.addScaledVector(q.dir, dt * 3.2)
              if (Math.abs(q.home.x) > 1.4) q.dir.x *= -1
              if (q.home.y < 0.3 || q.home.y > room) q.dir.y *= -1
              if (Math.abs(q.home.z) > 0.55) q.dir.z *= -1
              q.home.x = Math.max(-1.4, Math.min(1.4, q.home.x))
              q.home.y = Math.max(0.3, Math.min(room, q.home.y))
              m.position.copy(q.home)
            }
          }
        })
        const idx = names.indexOf(focus)
        this.chambers.forEach((c, i) => (c.scale.setScalar(i === idx ? 1 + 0.04 * Math.sin(st.t * 3) : 1)))
        this.emitGauges(dt, () => [
          { label: 'Solid: volume left', value: `${Math.round((1 - press * squash[0]) * 100)}%` },
          { label: 'Liquid: volume left', value: `${Math.round((1 - press * squash[1]) * 100)}%` },
          { label: 'Gas: volume left', value: `${Math.round((1 - press * squash[2]) * 100)}%`, tone: 'warn' },
        ])
        if (st.t > 8.5) {
          this.events.onNote?.('Solid: particles locked in place. Liquid: close but sliding. Gas: far apart and free.')
          return 600
        }
        return null
      },
      done: () => {
        this.chambers.forEach((c) => c.scale.setScalar(1))
      },
    })
  }

  /* =============================== tab 2 =============================== */
  private buildBench() {
    const g = this.groups.properties_changes
    stageSet(g, { cx: 0, cz: 0, w: 28, d: 14, wall: { z: -7.4, h: 12 }, key: [3, 14, 10], aim: [0, 1, 0], keyI: 950, rimI: 160, rimAt: [14, 7, -3], dust: { n: 140, h: 7 } })
    g.add(this.bench)
    // the dish: a shallow white ceramic dish the sample sits in
    const mkDish = (x: number) => {
      const d = new THREE.Group()
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.2, 0.3, 36), std(0xf1ece0, 0.4, 0.05))
      bowl.position.y = 0.15
      bowl.castShadow = bowl.receiveShadow = true
      d.add(bowl)
      // a tripod with a gauze holds the dish up, so the burner can stand under it
      const gauze = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.05, 32), std(0x6f7886, 0.5, 0.8))
      gauze.position.y = -0.04
      d.add(gauze)
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + 0.5
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, RAISE, 8), std(0x39404c, 0.5, 0.8))
        leg.position.set(Math.cos(a) * 1.35, -RAISE / 2, Math.sin(a) * 1.35)
        d.add(leg)
      }
      d.position.set(x, RAISE, 0)
      this.bench.add(d)
      this.dishGroups.push(d)
      const holder = new THREE.Group()
      holder.position.set(x, RAISE + 0.32, 0)
      this.bench.add(holder)
      this.samples.push(holder)
      return d
    }
    mkDish(-3.6)
    mkDish(0)
    mkDish(3.6)
    this.sampleLabel = this.label('', '#ffd9a0', 0.9)
    this.sampleLabel.position.set(0, RAISE + 3.4, 0)
    g.add(this.sampleLabel)
    // flame: ours, so it can flicker and move; the model supplies the burner itself
    this.burner.visible = false
    this.flame = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.95, 20), new THREE.MeshBasicMaterial({ color: 0x66b3ff, transparent: true, opacity: 0.9, depthWrite: false }))
    this.flame.position.y = RAISE - 0.15 + 0.47
    this.flameLight = new THREE.PointLight(0xffa24a, 0, 8)
    this.flameLight.position.y = RAISE
    this.burner.add(this.flame, this.flameLight)
    this.flash = new THREE.PointLight(0xffffff, 0, 14)
    this.flash.position.set(0, RAISE + 1.5, 0.5)
    this.bench.add(this.flash)
    this.bench.add(this.burner)
    // hammer and magnet
    this.hammer.visible = false
    this.magnetTool.visible = false
    this.bench.add(this.hammer, this.magnetTool)
    // a circuit: battery, bulb and two probes
    this.circuit.visible = false
    const bat = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.6, 24), std(0x1f6f5c, 0.35, 0.6))
    bat.rotation.z = Math.PI / 2
    bat.position.set(4.6, 0.6, -2.2)
    this.bulb = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 16), new THREE.MeshStandardMaterial({ color: 0xfff6d0, emissive: 0xffd34a, emissiveIntensity: 0, transparent: true, opacity: 0.9 }))
    this.bulb.position.set(-4.6, 1.2, -2.2)
    this.bulbLight = new THREE.PointLight(0xffd34a, 0, 9)
    this.bulbLight.position.copy(this.bulb.position)
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 0.5, 16), std(0x8f9aa8, 0.4, 0.8))
    base.position.set(-4.6, 0.55, -2.2)
    this.circuit.add(bat, this.bulb, this.bulbLight, base)
    const wire = (pts: THREE.Vector3[]) => {
      const t = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.05, 6, false), std(0xc97a3d, 0.3, 0.9))
      this.circuit.add(t)
    }
    wire([V(-4.6, 0.8, -2.2), V(-4.6, 0.4, 0.4), V(-1.0, 0.45, 0.5)])
    wire([V(4.6, 0.6, -2.2), V(4.6, 0.4, 0.4), V(1.0, 0.45, 0.5)])
    wire([V(-4.0, 0.6, -2.2), V(0, 0.6, -2.6), V(4.0, 0.6, -2.2)])
    for (const x of [-1, 1]) {
      const probe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.9, 0.2), std(0xb9c2d0, 0.2, 1))
      probe.position.set(x, 0.75, 0.5)
      this.circuit.add(probe)
    }
    this.circuit.position.y = RAISE
    this.bench.add(this.circuit)
    // a closed tube for the iodine, and a glass beaker for dissolving
    this.tube.visible = false
    const tubeGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 3.2, 28, 1, true), glassMat())
    tubeGlass.position.y = 2.0
    const tubeCap = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), glassMat())
    tubeCap.position.y = 0.4
    const stopper = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.42, 0.4, 20), std(0x8a4b2a, 0.8))
    stopper.position.y = 3.7
    this.tube.add(tubeGlass, tubeCap, stopper)
    this.vapor = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 2.8, 20), new THREE.MeshBasicMaterial({ color: 0x8b2fc9, transparent: true, opacity: 0, depthWrite: false }))
    this.vapor.position.y = 1.9
    this.tube.add(this.vapor)
    this.tube.position.y = RAISE
    this.bench.add(this.tube)
    this.beaker2 = glassBeaker(1.5, 3.2)
    this.water2 = new Liquid(1.45, 0x7ab8ff, 0.4)
    this.beaker2.add(this.water2)
    this.beaker2.visible = false
    this.beaker2.position.y = RAISE + 0.5
    const gz = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.05, 32), std(0x6f7886, 0.5, 0.8))
    gz.position.y = -0.03
    this.beaker2.add(gz)
    this.bench.add(this.beaker2)
  }

  private dressTools() {
    const burner = this.models.burner
    // the model's own flame is a painted-on mesh: leave it out and use ours. The tube's top is where the flame starts.
    if (burner) {
      const clone = burner.clone(true)
      const flames: THREE.Object3D[] = []
      clone.traverse((o) => {
        if (/flame/i.test(o.name)) flames.push(o)
      })
      flames.forEach((f) => f.removeFromParent())
      const b = this.fitTo(clone, RAISE - 0.15, 'y')
      b.updateMatrixWorld(true)
      // centre the burner on its tube (the gas hose lies off to one side and would pull a plain bounding-box centre)
      const all = new THREE.Box3().setFromObject(b)
      const top: THREE.Vector3[] = []
      b.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        const pos = o.geometry.attributes.position
        for (let i = 0; i < pos.count; i++) {
          const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld)
          if (v.y > all.max.y - 0.25 * (all.max.y - all.min.y)) top.push(v)
        }
      })
      const tb = new THREE.Box3().setFromPoints(top.length ? top : [all.min, all.max])
      const c = tb.getCenter(new THREE.Vector3())
      b.position.x -= c.x
      b.position.z -= c.z
      this.burner.add(b)
    } else {
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 0.4, 24), std(0x6b5aa8, 0.5, 0.4))
      stand.position.y = 0.2
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 2.6, 18), std(0x8f9aa8, 0.3, 0.9))
      tube.position.y = 1.5
      this.burner.add(stand, tube)
    }
    const h = this.models.hammer
    this.hammer.clear()
    const hm = h ? this.fitTo(h, 4.2, 'x') : null
    if (hm) {
      hm.position.set(-2.1, -0.15, 0) // the handle end is the pivot
      hm.rotation.y = 0
      const pivot = new THREE.Group()
      pivot.add(hm)
      this.hammer.add(pivot)
    } else {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.2, 12), std(0xa47c4b, 0.7))
      handle.rotation.z = Math.PI / 2
      handle.position.x = 0.6
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 0.7), std(0x8f9aa8, 0.3, 0.9))
      head.position.x = 2.3
      this.hammer.add(handle, head)
    }
    const m = this.models.magnet
    this.magnetTool.clear()
    if (m) {
      const mm = this.fitTo(m, 2.4, 'x')
      mm.rotation.x = 0
      this.magnetTool.add(mm)
    } else {
      const arc = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.22, 14, 30, Math.PI), std(0xd7263d, 0.4, 0.5))
      arc.rotation.z = Math.PI
      arc.position.y = 0.9
      this.magnetTool.add(arc)
    }
  }

  /** The look of one substance in its dish. */
  private makeSample(key: string): THREE.Group {
    const g = new THREE.Group()
    const cubes = (n: number, size: number, color: number, spread: number, rough = 0.5, metal = 0.1) => {
      const mat = std(color, rough, metal)
      for (let i = 0; i < n; i++) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), mat)
        const a = i * 2.4
        c.position.set(Math.cos(a) * spread * ((i % 5) / 5 + 0.2), size / 2 + Math.floor(i / 9) * size * 0.8, Math.sin(a) * spread * ((i % 4) / 4 + 0.2))
        c.rotation.y = i
        c.castShadow = true
        g.add(c)
      }
    }
    switch (key) {
      case 'magnesium':
      case 'magnesium_acid': {
        const curve = new THREE.CatmullRomCurve3([V(-0.9, 0.05, 0.2), V(-0.4, 0.14, -0.2), V(0.2, 0.05, 0.2), V(0.9, 0.12, -0.1)])
        const ribbon = new THREE.Mesh(new THREE.TubeGeometry(curve, 30, 0.07, 6, false), new THREE.MeshStandardMaterial({ color: 0xd6dbe3, metalness: 1, roughness: 0.18, emissive: 0xffffff, emissiveIntensity: 0 }))
        ribbon.name = 'main'
        g.add(ribbon)
        break
      }
      case 'iron': {
        cubes(26, 0.12, 0x3a3d44, 0.9, 0.7, 0.8)
        break
      }
      case 'copper': {
        const rod = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.14, 0.5), new THREE.MeshStandardMaterial({ color: 0xd2742f, metalness: 1, roughness: 0.25 }))
        rod.position.y = 0.1
        rod.name = 'main'
        g.add(rod)
        break
      }
      case 'salt':
        cubes(22, 0.16, 0xf5f5f0, 0.85, 0.25)
        break
      case 'sugar':
        cubes(26, 0.12, 0xfbfaf6, 0.9, 0.35)
        break
      case 'copper_sulfate':
        cubes(18, 0.2, 0x2f76d8, 0.8, 0.15)
        break
      case 'wax': {
        const block = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 1), std(0xf3e6c4, 0.8))
        block.position.y = 0.4
        block.name = 'main'
        g.add(block)
        break
      }
      case 'sulfur': {
        const mat = std(0xe8d62b, 0.8)
        for (let i = 0; i < 6; i++) {
          const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28 + (i % 3) * 0.06, 0), mat)
          m.position.set(-0.6 + (i % 3) * 0.6, 0.25, -0.3 + Math.floor(i / 3) * 0.6)
          g.add(m)
        }
        break
      }
      case 'graphite': {
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.9, 14), std(0x2c2f36, 0.3, 0.6))
        rod.rotation.z = Math.PI / 2
        rod.position.y = 0.15
        rod.name = 'main'
        g.add(rod)
        break
      }
      case 'tablet': {
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.2, 24), std(0xf0f0ec, 0.5))
        t.position.y = 0.1
        t.name = 'main'
        g.add(t)
        break
      }
      case 'iodine':
        cubes(10, 0.16, 0x3b2a52, 0.4, 0.3, 0.6)
        break
      default:
        cubes(8, 0.2, 0xcccccc, 0.6)
    }
    return g
  }

  private setSample(slot: number, key: string | null) {
    const holder = this.samples[slot]
    holder.clear()
    holder.visible = key !== null
    holder.scale.set(1, 1, 1)
    if (key) holder.add(this.makeSample(key))
  }

  private substanceLabel(key: string): string {
    return { magnesium: 'Magnesium ribbon', magnesium_acid: 'Magnesium ribbon', iron: 'Iron filings', copper: 'Copper strip', salt: 'Salt', sugar: 'Sugar', copper_sulfate: 'Copper sulfate', wax: 'Wax', sulfur: 'Sulfur', graphite: 'Graphite rod', tablet: 'Fizzing tablet', iodine: 'Iodine crystals' }[key] ?? key
  }

  private hideBench() {
    this.burner.visible = false
    this.hammer.visible = false
    this.magnetTool.visible = false
    this.circuit.visible = false
    this.tube.visible = false
    this.beaker2.visible = false
    this.flame.visible = false
    this.flameLight.intensity = 0
    this.flash.intensity = 0
    this.bulbLight.intensity = 0
    ;(this.bulb.material as THREE.MeshStandardMaterial).emissiveIntensity = 0
    ;(this.vapor.material as THREE.MeshBasicMaterial).opacity = 0
  }

  private dishes(show: boolean[]) {
    this.dishGroups.forEach((d, i) => (d.visible = show[i] ?? false))
  }

  /** Sets the table for a burn, a test or a dissolve, before it is run. */
  private setupBench(action: string, p: Record<string, unknown>) {
    this.hideBench()
    this.statesStage.visible = false
    const sub = String(p.substance ?? 'salt')
    const tool = String(p.tool ?? '')
    const dishes = [false, true, false]
    for (let i = 0; i < 3; i++) this.setSample(i, null)
    if (action === 'dissolve') {
      this.beaker2.visible = true
      this.water2.setLevel(0.1, 2.3)
      ;(this.water2.material as THREE.MeshStandardMaterial).color.setHex(0x7ab8ff)
      this.beaker2.children.filter((c) => c.name === 'solid').forEach((c) => this.beaker2.remove(c))
      this.dishes([false, false, false])
      this.relabel(this.sampleLabel, `${this.substanceLabel(sub)} in water`)
    } else if (action === 'burn' && String(p.process) === 'sublime') {
      this.tube.visible = true
      this.dishes([false, false, false])
      const cr = this.makeSample('iodine')
      cr.name = 'crystals'
      this.tube.children.filter((c) => c.name === 'crystals').forEach((c) => this.tube.remove(c))
      cr.position.set(0, 0.3, 0)
      this.tube.add(cr)
      this.relabel(this.sampleLabel, 'Iodine crystals in a closed tube')
    } else if (action === 'test_tool' && tool === 'magnet') {
      this.dishes([true, true, true])
      this.setSample(0, 'copper')
      this.setSample(1, 'iron')
      this.setSample(2, 'salt')
      this.relabel(this.sampleLabel, 'Copper · iron filings · salt')
    } else if (action === 'test_tool' && tool === 'circuit') {
      this.circuit.visible = true
      this.dishes([false, true, false])
      this.setSample(1, sub)
      this.relabel(this.sampleLabel, `${this.substanceLabel(sub)} in the circuit`)
    } else {
      this.dishes(dishes)
      this.setSample(1, sub)
      this.relabel(this.sampleLabel, this.substanceLabel(sub))
      if (action === 'test_tool' && tool === 'hammer') this.hammer.visible = true
    }
    const v = this.view('bench')
    void this.flyTo(v.pos, v.target, 900)
  }

  private async runBurn(p: { substance: string; process: string }): Promise<void> {
    this.abort()
    this.setupBench('burn', p)
    const v = this.view('bench')
    await this.flyTo(v.pos, v.target, 1100)
    if (this.disposed) return
    const key = p.substance
    const sublime = p.process === 'sublime'
    const sample = this.samples[1]
    const main = () => sample.getObjectByName('main') as THREE.Mesh | undefined
    this.burner.visible = true
    this.flame.visible = true
    this.burner.position.set(sublime ? 0 : 0, 0, sublime ? 0 : 0)
    const st = { t: 0, powder: false, puffed: false }
    const info = { text: 'Heating', result: '' }
    // the powder that replaces burnt magnesium
    const powder = new THREE.Group()
    for (let i = 0; i < 16; i++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), std(0xf6f6f2, 0.9))
      c.position.set(Math.cos(i * 2.4) * 0.5 * ((i % 5) / 5 + 0.2), 0.08, Math.sin(i * 2.4) * 0.5 * ((i % 4) / 4 + 0.2))
      powder.add(c)
    }
    powder.visible = false
    sample.add(powder)
    const burnTime = key === 'magnesium' ? 4.5 : key === 'wax' ? 7 : sublime ? 9 : 6
    sound.whoosh(0.8)
    return this.begin({
      update: (dt) => {
        st.t += dt
        const t = st.t
        const flicker = 1 + Math.sin(t * 22) * 0.08
        this.flame.scale.set(flicker, 1 + Math.sin(t * 17) * 0.1, flicker)
        const offAt = key === 'wax' ? 4.2 : sublime ? 5.2 : 99
        const lit = t < offAt
        this.flame.visible = lit
        this.flameLight.intensity = lit ? 6 : 0
        ;(this.flame.material as THREE.MeshBasicMaterial).color.setHex(key === 'magnesium' && t > 1.2 ? 0xffffff : 0x66b3ff)
        if (key === 'magnesium') {
          const m = main()
          if (t > 1.2 && t < 3.4) {
            this.flash.intensity = 40 * (0.6 + Math.random() * 0.4)
            this.flame.scale.set(2.2, 1.6, 2.2)
            if (m) (m.material as THREE.MeshStandardMaterial).emissiveIntensity = 3
            info.text = 'Burning with a dazzling white light'
          } else if (t >= 3.4) {
            this.flash.intensity = Math.max(0, this.flash.intensity - 80 * dt)
            if (m) m.visible = false
            powder.visible = true
            info.text = 'White powder'
            info.result = 'new substance'
          }
        } else if (key === 'wax') {
          const m = main()
          const melt = smooth(1.2, 3.6, t) - smooth(offAt + 0.4, offAt + 2.4, t) * 0.6
          if (m) {
            m.scale.set(1 + melt * 0.7, 1 - melt * 0.85, 1 + melt * 0.7)
            m.position.y = 0.4 * m.scale.y
            ;(m.material as THREE.MeshStandardMaterial).color.setHex(melt > 0.5 ? 0xf8f0d4 : 0xf3e6c4)
          }
          info.text = t < 1.2 ? 'Warming' : t < offAt ? 'Melting into a puddle' : 'Flame off: it sets again'
          info.result = 'same wax'
        } else if (key === 'sugar') {
          const dark = smooth(1.2, 4.8, t)
          sample.children.forEach((c) => {
            if (c instanceof THREE.Mesh) {
              const col = new THREE.Color(0xfbfaf6).lerp(new THREE.Color(0x7a4a1c), Math.min(1, dark * 2)).lerp(new THREE.Color(0x141210), Math.max(0, dark * 2 - 1))
              ;(c.material as THREE.MeshStandardMaterial).color.copy(col)
            }
          })
          if (t > 1.5) this.puffSteamBench(dt, sample)
          info.text = dark < 0.4 ? 'Melting' : dark < 0.8 ? 'Turning brown' : 'Black'
          info.result = 'new substance'
        } else if (key === 'copper') {
          const m = main()
          const dark = smooth(1.2, 4.6, t)
          if (m) {
            const col = new THREE.Color(0xd2742f).lerp(new THREE.Color(0x1d1a18), dark)
            ;(m.material as THREE.MeshStandardMaterial).color.copy(col)
            ;(m.material as THREE.MeshStandardMaterial).metalness = 1 - dark * 0.7
          }
          info.text = dark < 0.5 ? 'Heating' : 'Surface turns black'
          info.result = 'new substance'
        } else if (sublime) {
          const up = smooth(1.2, 4.2, t)
          const back = smooth(offAt + 0.2, offAt + 3.5, t)
          const cloud = up * (1 - back)
          ;(this.vapor.material as THREE.MeshBasicMaterial).opacity = 0.55 * cloud
          const crystals = this.tube.getObjectByName('crystals')
          if (crystals) crystals.scale.setScalar(Math.max(0.05, 1 - up * 0.9 + back * 0.9 * (up > 0.5 ? 1 : 0)))
          info.text = t < 1.2 ? 'Heating' : t < offAt ? 'Purple vapour forms' : 'Cooling: crystals form again'
          info.result = 'same iodine'
        }
        this.emitGauges(dt, () => [
          { label: 'Sample', value: this.substanceLabel(key) },
          { label: 'What happens', value: info.text, tone: 'info' },
          { label: 'Is a new substance made?', value: t > burnTime - 0.5 ? (info.result === 'new substance' ? 'yes' : 'no') : '…', tone: 'warn' },
        ])
        if (t > burnTime) return 700
        return null
      },
      done: () => {
        this.flame.visible = false
        this.flameLight.intensity = 0
        this.flash.intensity = 0
        this.burner.visible = false
        this.setSample(1, p.substance === 'magnesium' || p.process === 'sublime' ? null : p.substance)
        if (!sublime) this.setSample(1, p.substance)
      },
    })
  }

  private puffSteamBench(dt: number, at: THREE.Object3D) {
    if (Math.random() > dt * 14) return
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.5, depthWrite: false }))
    s.position.set((Math.random() - 0.5) * 1.0, 0.6, (Math.random() - 0.5) * 0.6)
    at.add(s)
    let life = 0
    const step = (d: number) => {
      life += d
      s.position.y += d * 1.2
      ;(s.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - life / 1.2)
      if (life >= 1.2) {
        at.remove(s)
        s.geometry.dispose()
        return false
      }
      return true
    }
    this.tweens.add(step)
  }

  private async runDissolve(p: { substance: string; recover: boolean }): Promise<void> {
    this.abort()
    this.setupBench('dissolve', p)
    const v = this.view('bench')
    await this.flyTo(v.pos, v.target, 1100)
    if (this.disposed) return
    const key = p.substance
    const tint = key === 'copper_sulfate' ? 0x2f7de0 : 0x7ab8ff
    const lumps: THREE.Mesh[] = []
    for (let i = 0; i < 10; i++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), std(key === 'copper_sulfate' ? 0x2f76d8 : key === 'tablet' ? 0xf0f0ec : key === 'magnesium_acid' ? 0xd6dbe3 : 0xf5f5f0, 0.3))
      c.position.set((Math.random() - 0.5) * 0.9, 4.2 + i * 0.25, (Math.random() - 0.5) * 0.9)
      c.name = 'solid'
      this.beaker2.add(c)
      lumps.push(c)
    }
    const residue = new THREE.Group()
    residue.visible = false
    this.beaker2.add(residue)
    const white = key === 'salt' || key === 'sugar'
    for (let i = 0; i < 14; i++) {
      const color = p.recover ? (key === 'copper_sulfate' ? 0x2f76d8 : 0xf5f5f0) : 0xb8bfa8
      const c = new THREE.Mesh(new THREE.BoxGeometry(p.recover ? 0.2 : 0.1, p.recover ? 0.2 : 0.05, p.recover ? 0.2 : 0.1), std(color, 0.35))
      c.position.set(Math.cos(i * 2.4) * 0.8 * ((i % 5) / 5 + 0.2), 0.16, Math.sin(i * 2.4) * 0.8 * ((i % 4) / 4 + 0.2))
      residue.add(c)
    }
    void white
    const bubbly = !p.recover
    const bubbles: THREE.Mesh[] = []
    for (let i = 0; i < 18; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }))
      b.visible = false
      b.userData.ph = i * 0.31
      this.beaker2.add(b)
      bubbles.push(b)
    }
    this.burner.position.set(0, 0, 0)
    const st = { t: 0 }
    const stir = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.6, 8), std(0xcfd8e3, 0.2, 0.2))
    stir.position.set(0.5, 2.2, 0)
    stir.name = 'solid'
    this.beaker2.add(stir)
    const label = { text: 'Dropping it in' }
    return this.begin({
      update: (dt) => {
        st.t += dt
        const t = st.t
        // 0-1: drop; 1-4.5: stir while it disappears; 4.5-5: the water is clear (or tinted); 5-9.5: boil the water away
        lumps.forEach((l, i) => {
          const fall = smooth(0.2 + i * 0.05, 1.2 + i * 0.05, t)
          l.position.y = 4.2 + i * 0.25 - fall * (3.4 + i * 0.25) + 0.12
          const gone = smooth(1.6 + i * 0.12, 3.8 + i * 0.12, t)
          l.scale.setScalar(Math.max(0.001, 1 - gone))
          l.visible = true
        })
        stir.position.x = Math.cos(t * 4) * 0.5 * smooth(1, 1.6, t)
        stir.position.z = Math.sin(t * 4) * 0.5 * smooth(1, 1.6, t)
        const mixed = smooth(1.8, 4.5, t)
        ;(this.water2.material as THREE.MeshStandardMaterial).color.copy(new THREE.Color(0x7ab8ff).lerp(new THREE.Color(tint), key === 'copper_sulfate' ? mixed : 0))
        bubbles.forEach((b) => {
          b.visible = bubbly && t > 1.2 && t < 5
          if (b.visible) {
            const ph = (t * 1.1 + (b.userData.ph as number)) % 1
            b.position.set(Math.cos(b.userData.ph * 9) * 1.0, 0.2 + ph * 2.2, Math.sin(b.userData.ph * 7) * 1.0)
          }
        })
        const evap = smooth(5.2, 9.2, t)
        this.water2.setLevel(0.1, 0.1 + 2.2 * (1 - evap) + 0.001)
        this.burner.visible = t > 5
        this.flame.visible = t > 5 && t < 9.4
        this.flameLight.intensity = t > 5 && t < 9.4 ? 6 : 0
        if (t > 5) this.puffSteamBench(dt, this.beaker2)
        residue.visible = evap > 0.7
        const rs = smooth(8.0, 9.4, t)
        residue.scale.setScalar(Math.max(0.01, rs))
        label.text = t < 1 ? 'Dropping it in' : t < 4.5 ? (bubbly ? 'Fizzing and stirring' : 'Stirring: it seems to disappear') : t < 5.2 ? 'It has gone from sight' : t < 9.2 ? 'Boiling the water away' : 'What is left in the beaker?'
        this.emitGauges(dt, () => [
          { label: 'Step', value: label.text, tone: 'info' },
          { label: 'Water level', value: `${Math.round(100 * (1 - evap))}%` },
          { label: 'Left behind', value: t > 9.2 ? (p.recover ? 'the original substance' : 'something different') : '…', tone: 'warn' },
        ])
        if (t > 10.6) return 800
        return null
      },
      done: () => {
        this.burner.visible = false
        this.flame.visible = false
        this.flameLight.intensity = 0
        for (const o of [...lumps, stir, ...bubbles, residue]) this.beaker2.remove(o)
        this.water2.setLevel(0.1, 2.3)
      },
    })
  }

  private async runTool(p: { tool: string; substance: string }): Promise<void> {
    this.abort()
    this.setupBench('test_tool', p)
    const v = this.view('bench')
    await this.flyTo(v.pos, v.target, 1100)
    if (this.disposed) return
    const st = { t: 0, hit: false }
    if (p.tool === 'hammer') {
      const holder = this.samples[1]
      const main = holder.getObjectByName('main') as THREE.Mesh | undefined
      const shatter = p.substance === 'sulfur'
      const frags: THREE.Mesh[] = []
      this.hammer.visible = true
      this.hammer.position.set(2.0, RAISE + 3.6, 0.2)
      const pivot = this.hammer.children[0] as THREE.Object3D
      return this.begin({
        update: (dt) => {
          st.t += dt
          const swing = smooth(0.6, 1.3, st.t)
          pivot.rotation.z = 0.9 - swing * 1.55 + (st.t > 1.3 ? smooth(1.4, 2.4, st.t) * 0.9 : 0)
          this.hammer.position.set(1.2, RAISE + 2.6 - swing * 0.2, 0.2)
          if (!st.hit && st.t > 1.3) {
            st.hit = true
            sound.thud()
            if (shatter) {
              holder.clear()
              for (let i = 0; i < 12; i++) {
                const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14 + Math.random() * 0.1, 0), std(0xe8d62b, 0.8))
                f.position.set((Math.random() - 0.5) * 0.4, 0.3, (Math.random() - 0.5) * 0.4)
                f.userData.v = V((Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3)
                holder.add(f)
                frags.push(f)
              }
            }
          }
          if (st.hit && shatter) {
            for (const f of frags) {
              const vel = f.userData.v as THREE.Vector3
              vel.y -= 9 * dt
              f.position.addScaledVector(vel, dt)
              if (f.position.y < 0.1) {
                f.position.y = 0.1
                vel.set(0, 0, 0)
              }
            }
          } else if (st.hit && main) {
            const sq = smooth(1.3, 1.7, st.t)
            main.scale.set(1 + sq * 0.7, 1 - sq * 0.6, 1 + sq * 0.4)
            main.position.y = 0.1 * main.scale.y
          }
          this.emitGauges(dt, () => [
            { label: 'Sample', value: this.substanceLabel(p.substance) },
            { label: 'Tool', value: 'Hammer' },
            { label: 'Result', value: st.hit ? (shatter ? 'shatters into pieces' : 'flattens, does not break') : '…', tone: 'warn' },
          ])
          if (st.t > 4) return 600
          return null
        },
        done: () => {
          this.hammer.visible = false
        },
      })
    }
    if (p.tool === 'magnet') {
      this.magnetTool.visible = true
      const holders = [this.samples[0], this.samples[1], this.samples[2]]
      const iron = holders[1]
      const filings = [...iron.children[0]?.children ?? []] as THREE.Mesh[]
      const home = filings.map((f) => f.position.clone())
      const names = ['Copper', 'Iron filings', 'Salt']
      return this.begin({
        update: (dt) => {
          st.t += dt
          // the magnet visits each sample in turn: copper, iron, salt
          const stop = (i: number) => smooth(0.5 + i * 2.2, 1.4 + i * 2.2, st.t) * (1 - smooth(1.8 + i * 2.2, 2.5 + i * 2.2, st.t))
          const at = [-3.6, 0, 3.6]
          const k = [stop(0), stop(1), stop(2)]
          const x = k[0] > 0.01 ? at[0] : k[1] > 0.01 ? at[1] : k[2] > 0.01 ? at[2] : (st.t < 0.5 ? -3.6 : st.t < 2.7 ? at[1] : at[2])
          const lift = Math.max(...k)
          this.magnetTool.position.set(x, RAISE + 3.2 - lift * 1.4, 0)
          filings.forEach((f, i) => {
            const pull = k[1]
            f.position.set(home[i].x * (1 - pull * 0.8), home[i].y + pull * (1.2 + (i % 4) * 0.15), home[i].z * (1 - pull * 0.8))
          })
          this.emitGauges(dt, () => [
            { label: 'Copper', value: k[0] > 0.5 || st.t > 2 ? 'not attracted' : '…' },
            { label: 'Iron filings', value: st.t > 2.7 ? 'jump to the magnet' : k[1] > 0.2 ? 'jump to the magnet' : '…', tone: 'warn' },
            { label: 'Salt', value: st.t > 6 ? 'not attracted' : '…' },
          ])
          void names
          if (st.t > 7.8) return 700
          return null
        },
        done: () => {
          this.magnetTool.visible = false
          this.setSample(1, 'iron')
        },
      })
    }
    // the circuit
    const conducts = p.substance === 'graphite' || p.substance === 'copper' || p.substance === 'iron'
    this.circuit.visible = true
    return this.begin({
      update: (dt) => {
        st.t += dt
        const on = conducts && st.t > 1.6
        ;(this.bulb.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 3 : 0
        this.bulbLight.intensity = on ? 18 : 0
        if (on && !st.hit) {
          st.hit = true
          sound.click()
        }
        this.emitGauges(dt, () => [
          { label: 'Sample', value: this.substanceLabel(p.substance) },
          { label: 'Bulb', value: st.t > 1.6 ? (conducts ? 'lit' : 'off') : '…', tone: 'warn' },
          { label: 'Current flows', value: st.t > 1.6 ? (conducts ? 'yes' : 'no') : '…' },
        ])
        if (st.t > 4.6) return 600
        return null
      },
      done: () => {
        this.circuit.visible = false
        this.bulbLight.intensity = 0
      },
    })
  }

  /* =============================== tab 3 =============================== */
  private buildDensity() {
    const g = this.groups.density_measurement
    stageSet(g, { cx: 11, cz: 0, w: 50, d: 14, wall: { z: -7.4, h: 12 }, key: [8, 15, 10], aim: [8, 3, 0], keyI: 1500, rimI: 200, rimAt: [24, 8, -3], dust: { n: 200, h: 8 } })
    const { anchor } = this.buildScale(g, 3, 1.9)
    // the measuring cylinder rides on the pan; a procedural cylinder until the model is dressed on
    this.cyl.position.y = 0.3
    anchor.add(this.cyl)
    this.cylLiquid = new Liquid(0.27, 0x5aa9ff, 0.8)
    this.cyl.add(this.cylLiquid)
    const shell = glassBeaker(0.3, 4.2)
    shell.name = 'cyl-fallback'
    this.cyl.add(shell)
    // the bottles in a row, a stream between bottle and cylinder, and a tall jar for layers and floating
    this.stream = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 10), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }))
    this.stream.visible = false
    g.add(this.stream)
    this.jar = glassBeaker(1.1, 5.4)
    this.jar.position.set(11, 0, 0)
    g.add(this.jar)
    for (let i = 0; i < 4; i++) {
      const l = new Liquid(1.05, 0xffffff, 0.9)
      this.jar.add(l)
      this.layers.push(l)
      const lab = this.label('', '#ffffff', 0.55)
      lab.position.set(2.4, 1, 0)
      lab.visible = false
      this.jar.add(lab)
      this.layerLabels.push(lab)
    }
    this.dropper.visible = false
    this.jar.add(this.dropper)
    this.objLabel = this.label('', '#ffe0b3', 0.7)
    this.objLabel.visible = false
    this.jar.add(this.objLabel)
    this.stationLabel = this.label('', '#cfe6ff', 0.9)
    this.stationLabel.position.set(6, 9.6, 0)
    g.add(this.stationLabel)
  }

  private dressCylinder() {
    const m = this.models.cylinder
    const old = this.cyl.getObjectByName('cyl-fallback')
    if (!m || !old) return
    const holder = this.fitTo(m, 4.6, 'y')
    // find the real glass and liquid inside the model so our liquid sits exactly in its tube
    holder.updateMatrixWorld(true)
    let glass: THREE.Object3D | null = null
    let fluid: THREE.Object3D | null = null
    holder.traverse((o) => {
      if (/glass/i.test(o.name)) glass = o
      if (/fluid|liquid/i.test(o.name)) fluid = o
    })
    old.visible = false
    this.cyl.add(holder)
    if (fluid) {
      const fb = new THREE.Box3().setFromObject(fluid)
      ;(fluid as THREE.Object3D).visible = false
      const size = fb.getSize(new THREE.Vector3())
      this.cylInfo.radius = Math.max(0.18, Math.min(size.x, size.z) / 2) * 0.95
      this.cylInfo.bottom = fb.min.y - holder.parent!.position.y
    }
    if (glass) {
      const gb = new THREE.Box3().setFromObject(glass)
      this.cylInfo.top = gb.max.y - 0.5
    }
    this.cylInfo.bottom = Math.max(0.2, this.cylInfo.bottom)
    this.cyl.remove(this.cylLiquid)
    this.cylLiquid = new Liquid(this.cylInfo.radius, 0x5aa9ff, 0.8)
    this.cyl.add(this.cylLiquid)
  }

  private liquidInfo(k: string) {
    return this.liquids[k] ?? { name: k, density: 1, color: 0xcccccc }
  }
  private rho(): Record<string, number> {
    return Object.fromEntries(Object.entries(this.liquids).map(([k, v]) => [k, v.density]))
  }

  /** Level in the cylinder for a volume in mL (100 mL is the top of the scale). */
  private levelFor(ml: number) {
    return this.cylInfo.bottom + ((this.cylInfo.top - this.cylInfo.bottom) * Math.min(100, ml)) / 100
  }

  private setupDensity(action: string, p: Record<string, unknown>) {
    this.statesStage.visible = false
    const liquids = (p.liquids as string[]) ?? []
    this.bottles.forEach((b) => b.parent?.remove(b))
    this.bottles = []
    const g = this.groups.density_measurement
    // a row of small bottles on the left of the jar, one per liquid
    liquids.forEach((k, i) => {
      const info = this.liquidInfo(k)
      const b = new THREE.Group()
      const body = glassBeaker(0.55, 1.5)
      const fill = new Liquid(0.52, info.color, 0.9)
      fill.setLevel(0.08, 1.2)
      const name = this.label(info.name, '#ffffff', 0.6)
      name.position.y = 2.3
      b.add(body, fill, name)
      b.position.set(5.6 + i * 1.5, 0, 3.4)
      b.userData.home = b.position.clone()
      g.add(b)
      this.bottles.push(b)
    })
    this.archi.visible = false
    this.stationLabel.visible = true
    this.bottles.forEach((b) => (b.visible = true))
    this.jar.visible = action === 'layer' || action === 'drop'
    this.cyl.visible = action === 'weigh_liquids' || action === 'measure'
    this.pans[1].anchor.parent!.visible = action === 'weigh_liquids' || action === 'measure'
    this.layers.forEach((l, i) => {
      l.visible = false
      this.layerLabels[i].visible = false
    })
    this.dropper.visible = false
    this.objLabel.visible = false
    this.cylLiquid.setLevel(0, 0)
    this.setMass(1, 0, 'Scale: 0.0 g')
    this.relabel(this.stationLabel, action === 'layer' ? 'Pouring into one jar' : action === 'drop' ? 'Float or sink?' : 'Weigh equal volumes')
    const v = this.view(action === 'layer' || action === 'drop' ? 'jar' : 'weigh')
    void this.flyTo(v.pos, v.target, 900)
  }

  private async runWeigh(p: { liquids: string[]; volume: number; mode?: string }): Promise<void> {
    this.abort()
    this.setupDensity('weigh_liquids', p)
    const v = this.view('weigh')
    await this.flyTo(v.pos, v.target, 1100)
    if (this.disposed) return
    const rho = this.rho()
    const per = 4.4
    const readings: { name: string; mass: number }[] = []
    const st = { t: 0 }
    const sc = this.cylInfo
    void sc
    return this.begin({
      update: (dt) => {
        st.t += dt
        const i = Math.min(p.liquids.length - 1, Math.floor(st.t / per))
        const k = p.liquids[i]
        const info = this.liquidInfo(k)
        const local = st.t - i * per
        const fill = smooth(0.8, 2.4, local)
        const drain = smooth(3.4, 4.2, local)
        const vol = p.volume * fill * (1 - drain)
        const mass = massOf(rho[k], vol)
        ;(this.cylLiquid.material as THREE.MeshStandardMaterial).color.setHex(info.color)
        this.cylLiquid.setLevel(this.cylInfo.bottom, this.levelFor(vol))
        // the bottle tips over the cylinder while it fills
        this.bottles.forEach((b, bi) => {
          const home = b.userData.home as THREE.Vector3
          const act = bi === i ? smooth(0.3, 0.9, local) * (1 - smooth(2.4, 3, local)) : 0
          b.position.set(home.x - act * (home.x - 3.6), home.y + act * 4.6, home.z - act * 2.4)
          b.rotation.z = act * 1.0
        })
        const act = smooth(0.3, 0.9, local) * (1 - smooth(2.4, 3, local))
        const streaming = act > 0.9 && fill < 0.999 && fill > 0
        this.stream.visible = streaming
        if (streaming) {
          const top = V(3.2, 8.5, 0)
          const bot = V(3, this.levelFor(vol) + 2.4, 0)
          this.stream.position.copy(top.clone().add(bot).multiplyScalar(0.5))
          this.stream.scale.set(1, top.distanceTo(bot), 1)
          ;(this.stream.material as THREE.MeshStandardMaterial).color.setHex(info.color)
        }
        this.setMass(1, mass, `Scale: ${f1(mass)} g`)
        if (local > 2.6 && local < 3.4 && !readings[i]) readings[i] = { name: info.name, mass: massOf(rho[k], p.volume) }
        this.emitGauges(dt, () => [
          { label: 'Liquid', value: info.name, tone: 'info' },
          { label: 'Volume', value: `${f1(vol)} mL` },
          { label: 'Scale', value: `${f1(mass)} g`, tone: 'ok' },
          ...readings.filter(Boolean).map((r) => ({ label: `${r.name}, ${p.volume} mL`, value: `${f1(r.mass)} g`, tone: 'warn' as const })),
        ])
        if (st.t > per * p.liquids.length - 0.1) {
          if (p.liquids.length === 1) this.events.onNote?.(`Density = mass ÷ volume = ${f1(massOf(rho[p.liquids[0]], p.volume))} g ÷ ${p.volume} mL = ${f2(rho[p.liquids[0]])} g/mL`)
          return 700
        }
        return null
      },
      done: () => {
        this.stream.visible = false
        this.cylLiquid.setLevel(0, 0)
        this.bottles.forEach((b) => {
          b.position.copy(b.userData.home as THREE.Vector3)
          b.rotation.z = 0
        })
      },
    })
  }

  private async runLayer(p: { liquids: string[] }): Promise<void> {
    this.abort()
    this.setupDensity('layer', p)
    const v = this.view('jar')
    await this.flyTo(v.pos, v.target, 1100)
    if (this.disposed) return
    const rho = this.rho()
    const order = layerOrder(p.liquids, rho) // bottom first
    const n = p.liquids.length
    const slot = (this.jarInfo.h - 0.9) / 4 // the height of one layer
    const st = { t: 0 }
    const poured = () => Math.min(n, Math.floor(st.t / 1.5))
    // layers start in the order they are poured, then slide into order of density
    const sortK = smooth(n * 1.5 + 0.3, n * 1.5 + 2.6, 0) // placeholder to keep the type
    void sortK
    return this.begin({
      update: (dt) => {
        st.t += dt
        const sorted = smooth(n * 1.5 + 0.3, n * 1.5 + 2.8, st.t)
        for (let i = 0; i < 4; i++) {
          const layer = this.layers[i]
          if (i >= n) {
            layer.visible = false
            this.layerLabels[i].visible = false
            continue
          }
          const k = p.liquids[i]
          const info = this.liquidInfo(k)
          ;(layer.material as THREE.MeshStandardMaterial).color.setHex(info.color)
          const pouredAt = i * 1.5
          const fill = smooth(pouredAt + 0.2, pouredAt + 1.3, st.t)
          // pour order position vs final (density) position
          const rankFinal = order.indexOf(k)
          const slotNow = i + (rankFinal - i) * sorted
          const bottom = 0.1 + slotNow * slot
          layer.setLevel(bottom, bottom + slot * fill)
          layer.visible = fill > 0.01
          const lab = this.layerLabels[i]
          lab.visible = fill > 0.5
          lab.position.set(2.3, bottom + slot / 2, 0)
          this.relabel(lab, `${info.name} ${f2(info.density)}`, '#ffffff')
        }
        this.bottles.forEach((b, bi) => {
          const home = b.userData.home as THREE.Vector3
          const act = poured() === bi && st.t < n * 1.5 ? smooth(0, 0.3, st.t - bi * 1.5) * (1 - smooth(1.1, 1.4, st.t - bi * 1.5)) : 0
          b.position.set(home.x + act * (11 - home.x - 0.4), home.y + act * (6.8 - home.y), home.z - act * (home.z + 0.3))
          b.rotation.z = act * -1.1
        })
        this.emitGauges(dt, () => [
          { label: 'Poured so far', value: `${Math.min(n, poured())} of ${n}`, tone: 'info' },
          { label: 'Bottom layer', value: sorted > 0.95 ? this.liquidInfo(order[0]).name : '…', tone: 'warn' },
          { label: 'Top layer', value: sorted > 0.95 ? this.liquidInfo(order[n - 1]).name : '…', tone: 'warn' },
        ])
        if (st.t > n * 1.5 + 4.6) {
          this.events.onNote?.('The layers sit in order of density: densest at the bottom.')
          return 700
        }
        return null
      },
      done: () => {
        this.bottles.forEach((b) => {
          b.position.copy(b.userData.home as THREE.Vector3)
          b.rotation.z = 0
        })
      },
    })
  }

  private async runDrop(p: { object: string; liquid: string }): Promise<void> {
    this.abort()
    this.setupDensity('drop', { liquids: [p.liquid] })
    const objects: Record<string, { name: string; density: number; color: number; shape: string }> = {
      cork: { name: 'Cork', density: 0.24, color: 0xc9964f, shape: 'cyl' },
      ice: { name: 'Ice cube', density: 0.92, color: 0xdff4ff, shape: 'box' },
      steel: { name: 'Steel bolt', density: 7.8, color: 0x9aa3b2, shape: 'cyl' },
      wax: { name: 'Candle wax', density: 0.9, color: 0xf3e6c4, shape: 'box' },
      grape: { name: 'Grape', density: 1.08, color: 0x6b3a8a, shape: 'sphere' },
      plastic: { name: 'Plastic ball', density: 0.6, color: 0xe5484d, shape: 'sphere' },
    }
    const ob = objects[p.object] ?? objects.cork
    const info = this.liquidInfo(p.liquid)
    // the liquid fills the jar
    this.layers.forEach((l, i) => (l.visible = i === 0))
    ;(this.layers[0].material as THREE.MeshStandardMaterial).color.setHex(info.color)
    ;(this.layers[0].material as THREE.MeshStandardMaterial).opacity = 0.55
    this.layers[0].setLevel(0.1, 4.4)
    this.dropper.geometry.dispose()
    this.dropper.geometry = ob.shape === 'box' ? new THREE.BoxGeometry(0.8, 0.8, 0.8) : ob.shape === 'cyl' ? new THREE.CylinderGeometry(0.25, 0.25, 1.1, 18) : new THREE.SphereGeometry(0.42, 24, 16)
    ;(this.dropper.material as THREE.MeshStandardMaterial).color.setHex(ob.color)
    this.dropper.visible = true
    this.dropper.position.set(0, 7, 0)
    this.objLabel.visible = true
    this.relabel(this.objLabel, `${ob.name}: ${f2(ob.density)} g/mL`)
    this.objLabel.position.set(0, 8.2, 0)
    const v = this.view('jar')
    await this.flyTo(v.pos, v.target, 1000)
    if (this.disposed) return
    const fl = floats(ob.density, info.density)
    const sub = submergedFraction(ob.density, info.density)
    const surface = 4.4
    const half = ob.shape === 'cyl' ? 0.55 : ob.shape === 'box' ? 0.4 : 0.42
    // a floating object rides with `sub` of its height below the surface
    const floatY = surface - sub * half * 2 + half
    const st = { t: 0 }
    return this.begin({
      update: (dt) => {
        st.t += dt
        const t = st.t
        const fall = smooth(0.4, 1.4, t)
        let y = 7 + (surface + 0.4 - 7) * fall
        if (t > 1.4) {
          const k = smooth(1.4, fl ? 3.4 : 4.4, t)
          const target = fl ? floatY : 0.1 + half
          y = surface + 0.4 + (target - surface - 0.4) * k
          if (fl) y += Math.sin(t * 5) * 0.06 * (1 - k)
        }
        this.dropper.position.set(0, y, 0)
        this.dropper.rotation.y = t * 0.8
        this.emitGauges(dt, () => [
          { label: ob.name, value: `${f2(ob.density)} g/mL`, tone: 'info' },
          { label: info.name, value: `${f2(info.density)} g/mL`, tone: 'info' },
          { label: 'Result', value: t > 3 ? (fl ? 'floats' : 'sinks') : '…', tone: 'warn' },
        ])
        if (t > 5.4) {
          this.events.onNote?.(fl ? 'It is less dense than the liquid, so it floats.' : 'It is denser than the liquid, so it sinks.')
          return 700
        }
        return null
      },
      done: () => undefined,
    })
  }

  /* =============================== tab 3, part two: Archimedes =============================== */
  private buildArchimedes() {
    const g = this.groups.density_measurement
    g.add(this.archi)
    this.archi.visible = false
    this.archiLabel = this.label('', '#cfe6ff', 0.95)
    this.archiLabel.position.set(27, 9.6, 0)
    this.archi.add(this.archiLabel)
    // --- the overflow can, with its spout and a catching cylinder ---
    this.can.position.set(CAN_X, 0, 0)
    const wall = glassBeaker(1.8, 3.8)
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.5, 14), glassMat())
    spout.rotation.z = -Math.PI / 2.6
    spout.position.set(2.3, 3.15, 0)
    this.canWater = new Liquid(1.75, 0x5aa9ff, 0.5)
    this.canWater.setLevel(0.1, 3.0)
    this.can.add(wall, spout, this.canWater)
    this.catchTube = glassBeaker(0.75, 3.2)
    this.catchTube.position.set(CAN_X + 3.6, 0, 0)
    this.catchLiquid = new Liquid(0.7, 0x5aa9ff, 0.7)
    this.catchTube.add(this.catchLiquid)
    for (let i = 1; i <= 7; i++) {
      const tick = new THREE.Mesh(new THREE.BoxGeometry(i % 2 ? 0.22 : 0.38, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: 0xe6edf7 }))
      tick.position.set(0.78, 0.1 + (i / 7) * 2.9, 0)
      this.catchTube.add(tick)
    }
    this.cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), std(0x9aa3b2, 0.35, 0.8))
    this.cube.castShadow = true
    this.cube.visible = false
    this.archi.add(this.can, this.catchTube, this.cube)
    // --- the spring scale: a spring from a bracket, a block, a ruler and a beaker of liquid ---
    this.springGroup.position.set(SPRING_X, 0, 0)
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 10, 14), std(0x2a2f39, 0.5, 0.7))
    post.position.set(-1.6, 5, -0.4)
    const arm = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.14, 0.14), std(0x2a2f39, 0.5, 0.7))
    arm.position.set(0, 9.9, -0.4)
    this.springGroup.add(post, arm)
    this.spring = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0xcfd6e2, metalness: 1, roughness: 0.25, wireframe: true }))
    this.block = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), std(0x9aa3b2, 0.35, 0.8))
    this.block.castShadow = true
    this.springGroup.add(this.spring, this.block)
    this.beakerA = glassBeaker(1.7, 4.2)
    this.beakerA.position.y = 0
    this.beakerWater = new Liquid(1.65, 0x5aa9ff, 0.45)
    this.beakerWater.setLevel(0.1, 3.0)
    this.beakerA.add(this.beakerWater)
    this.springGroup.add(this.beakerA)
    // a ruler beside the spring, graduated in newtons, with a pointer
    this.ruler.position.set(1.7, 0, 0)
    const rb = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6.2, 0.05), std(0xf3efe2, 0.6))
    rb.position.set(0, 6.6, 0)
    this.ruler.add(rb)
    for (let n = 0; n <= 20; n += 2) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(n % 10 === 0 ? 0.36 : 0.22, 0.03, 0.06), new THREE.MeshBasicMaterial({ color: 0x1a1a1a }))
      t.position.set(0.04, RULER_TOP - n * RULER_PER_N, 0.03)
      this.ruler.add(t)
    }
    const l0 = this.label('0 N', '#1a1a1a', 0.3)
    l0.position.set(0.7, RULER_TOP, 0.05)
    const l20 = this.label('20 N', '#1a1a1a', 0.3)
    l20.position.set(0.7, RULER_TOP - 20 * RULER_PER_N, 0.05)
    this.needleMark = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.08), new THREE.MeshBasicMaterial({ color: 0xd7263d }))
    this.ruler.add(l0, l20, this.needleMark)
    this.springGroup.add(this.ruler)
    for (const o of [this.arrowUp, this.arrowDown, this.shaftUp, this.shaftDown]) {
      o.visible = false
      this.springGroup.add(o)
    }
    this.archi.add(this.springGroup)
    // --- the tank for the clay boat ---
    this.tank.position.set(TANK_X, 0, 0)
    const box = new THREE.Mesh(new THREE.BoxGeometry(5.4, 3.6, 2.8), glassMat())
    box.position.y = 1.9
    box.renderOrder = 5
    this.tankWater = new Liquid(1, 0x5aa9ff, 0.45)
    this.tankWater.geometry.dispose()
    this.tankWater.geometry = new THREE.BoxGeometry(5.3, 1, 2.7)
    this.tankWater.setLevel(0.1, 2.6)
    this.tank.add(box, this.tankWater, this.clay, this.boat)
    this.clay.visible = false
    this.boat.visible = false
    this.archi.add(this.tank)
  }

  private showArchi(which: 'can' | 'scale' | 'tank') {
    this.statesStage.visible = false
    this.archi.visible = true
    this.jar.visible = false
    this.cyl.visible = false
    this.pans[1].anchor.parent!.visible = false
    this.bottles.forEach((b) => (b.visible = false))
    this.layers.forEach((l, i) => {
      l.visible = false
      this.layerLabels[i].visible = false
    })
    this.dropper.visible = false
    this.objLabel.visible = false
    this.stationLabel.visible = false
    this.can.visible = this.catchTube.visible = which === 'can'
    this.springGroup.visible = which === 'scale'
    this.tank.visible = which === 'tank'
    this.cube.visible = false
    this.relabel(this.archiLabel, which === 'can' ? 'Overflow can' : which === 'scale' ? 'Spring scale' : 'Clay boat')
    this.archiLabel.position.set(which === 'can' ? CAN_X + 1.8 : which === 'scale' ? SPRING_X : TANK_X, 9.2, 0)
  }

  private matColor(k: string): number {
    return ({ iron: 0x7d8594, aluminium: 0xc9d1dc, lead: 0x5a5f6b, steel: 0x9aa3b2, copper: 0xd2742f, wood: 0xb58850, cork: 0xc9964f, wax: 0xf3e6c4, brass: 0xc9a23a, clay: 0x9a6b3f } as Record<string, number>)[k] ?? 0xaaaaaa
  }

  /** Puts the overflow can, spring scale or tank in order for one question, before it is run. */
  private setupArchi(action: string, p: Record<string, unknown>) {
    const liq = String(p.liquid ?? 'water')
    const color = this.liquidInfo(liq).color
    if (action === 'displace') {
      this.showArchi('can')
      ;(this.canWater.material as THREE.MeshStandardMaterial).color.setHex(color)
      ;(this.catchLiquid.material as THREE.MeshStandardMaterial).color.setHex(color)
      this.canWater.setLevel(0.1, 3.0)
      this.catchLiquid.setLevel(0, 0)
      const v = this.view('can')
      void this.flyTo(v.pos, v.target, 900)
    } else if (action === 'spring_scale') {
      this.showArchi('scale')
      ;(this.beakerWater.material as THREE.MeshStandardMaterial).color.setHex(color)
      this.hangBlock(String(p.object ?? 'iron'), num(p.volume, 200), 'iron', 0, false)
      const v = this.view('spring')
      void this.flyTo(v.pos, v.target, 900)
    } else if (action === 'boat') {
      this.showArchi('tank')
      ;(this.tankWater.material as THREE.MeshStandardMaterial).color.setHex(color)
      this.clay.visible = false
      this.boat.visible = false
      const v = this.view('tank')
      void this.flyTo(v.pos, v.target, 900)
    }
  }

  /** Hangs a block from the spring: `drop` is how far down (0 = in air, 1 = fully under), `reading` the scale's reading. */
  private hangBlock(obj: string, volume: number, _fallback: string, reading: number, immersed: boolean, drop = 0) {
    const side = Math.cbrt(volume) * 0.22
    this.block.scale.set(side, side, side)
    ;(this.block.material as THREE.MeshStandardMaterial).color.setHex(this.matColor(obj))
    const springLen = Math.max(0.6, 1.6 + Math.max(0, reading) * 0.22)
    const top = 9.9
    this.spring.scale.set(1, springLen, 1)
    this.spring.position.set(0, top - springLen / 2, 0)
    const blockY = top - springLen - side / 2 - 0.2
    void drop
    this.block.position.set(0, blockY, 0)
    this.needleMark.position.set(0, RULER_TOP - Math.max(0, Math.min(20, reading)) * RULER_PER_N, 0.06)
    void immersed
    return { side, blockY, springLen }
  }

  private arrows(show: boolean, y: number, up: number, down: number) {
    for (const o of [this.arrowUp, this.arrowDown, this.shaftUp, this.shaftDown]) o.visible = show
    if (!show) return
    const upLen = Math.max(0.2, Math.min(3, up * 0.28))
    const dnLen = Math.max(0.2, Math.min(3.4, down * 0.28))
    this.shaftUp.scale.set(1, upLen, 1)
    this.shaftUp.position.set(0.95, y + upLen / 2, 0)
    this.arrowUp.position.set(0.95, y + upLen + 0.25, 0)
    this.shaftDown.scale.set(1, dnLen, 1)
    this.shaftDown.position.set(-0.95, y - dnLen / 2, 0)
    this.arrowDown.rotation.x = Math.PI
    this.arrowDown.position.set(-0.95, y - dnLen - 0.25, 0)
  }

  private async runDisplace(p: { a: { name: string; side: number; density: number }; b: { name: string; side: number; density: number }; liquid: string }): Promise<void> {
    this.abort()
    this.setupArchi('displace', p)
    const v = this.view('can')
    await this.flyTo(v.pos, v.target, 1100)
    if (this.disposed) return
    const liq = this.liquidInfo(p.liquid)
    const items = [p.a, p.b]
    const per = 7
    const results: { name: string; ml: number }[] = []
    const st = { t: 0 }
    const UNIT = 0.2
    return this.begin({
      update: (dt) => {
        st.t += dt
        const i = Math.min(1, Math.floor(st.t / per))
        const o = items[i]
        const local = st.t - i * per
        const side = o.side * UNIT
        const floatsNow = o.density < liq.density
        const ml = displacedCm3(o.density, liq.density, o.side ** 3)
        const lower = smooth(0.8, 2.6, local)
        const out = smooth(5.8, 6.7, local)
        const sub = floatsNow ? Math.min(1, o.density / liq.density) : 1
        this.cube.visible = true
        this.cube.scale.set(side, side, side)
        ;(this.cube.material as THREE.MeshStandardMaterial).color.setHex(this.matColor(o.name))
        // the cube comes down into the can: a floating one settles with `sub` of itself under the surface, a sinking one goes to the bottom
        const surface = 3.0
        const settleY = floatsNow ? surface - sub * side + side / 2 : 0.1 + side / 2
        const y0 = surface + 3.4
        const y = y0 + (settleY - y0) * lower + out * (y0 - settleY)
        this.cube.position.set(CAN_X, y, 0)
        // what overflows is the volume that has gone under the surface
        const frac = Math.max(0, Math.min(1, (y0 - y) / Math.max(0.01, y0 - settleY)))
        const pushed = ml * frac * (1 - out)
        const level = Math.min(3.0, 3.0)
        this.canWater.setLevel(0.1, level)
        this.catchLiquid.setLevel(0.05, 0.05 + (pushed / 350) * 2.9)
        if (local > 4.2 && !results[i]) results[i] = { name: `${o.side} cm ${o.name} cube`, ml }
        this.relabel(this.archiLabel, `${o.side} cm ${o.name} cube ${floatsNow ? '(floats)' : '(sinks)'}`)
        this.emitGauges(dt, () => [
          { label: 'Now testing', value: `${i === 0 ? 'A' : 'B'}: ${o.name}`, tone: 'info' },
          { label: 'Overflow', value: `${f1(pushed)} mL`, tone: 'ok' },
          ...results.filter(Boolean).map((r, k) => ({ label: `${k === 0 ? 'A' : 'B'} displaced`, value: `${f1(r.ml)} mL`, tone: 'warn' as const })),
        ])
        if (local > per - 0.2 && i === 0) this.catchLiquid.setLevel(0, 0)
        if (st.t > per * 2 - 0.1) return 800
        return null
      },
      done: () => {
        this.cube.visible = false
        this.catchLiquid.setLevel(0, 0)
        this.canWater.setLevel(0.1, 3.0)
      },
    })
  }

  private async runSpring(p: { tests: { object: string; volume: number; liquid: string }[]; held: boolean }): Promise<void> {
    this.abort()
    const first = p.tests[0]
    this.setupArchi('spring_scale', { object: first.object, volume: first.volume, liquid: first.liquid })
    const v = this.view('spring')
    await this.flyTo(v.pos, v.target, 1100)
    if (this.disposed) return
    const per = 6.4
    const rows: { name: string; air: number; liq: number }[] = []
    const st = { t: 0 }
    const MAT: Record<string, number> = { iron: 7.87, aluminium: 2.7, lead: 11.34, steel: 7.85, copper: 8.96, wood: 0.6, cork: 0.24, wax: 0.9, brass: 8.5 }
    return this.begin({
      update: (dt) => {
        st.t += dt
        const i = Math.min(p.tests.length - 1, Math.floor(st.t / per))
        const t = p.tests[i]
        const local = st.t - i * per
        const rho = MAT[t.object] ?? 7.87
        const lrho = this.liquidInfo(t.liquid).density
        const W = weightN(rho, t.volume)
        const B = buoyantN(lrho, t.volume)
        const A = apparentWeightN(rho, lrho, t.volume)
        ;(this.beakerWater.material as THREE.MeshStandardMaterial).color.setHex(this.liquidInfo(t.liquid).color)
        // the block goes in and stays there for the last test, so its reading is on screen when the run ends
        const down = smooth(1.4, 3.0, local) * (i === p.tests.length - 1 ? 1 : 1 - smooth(5.2, 6.2, local))
        const reading = W + (A - W) * down
        const h = this.hangBlock(t.object, t.volume, t.object, reading, down > 0.5, down)
        // the beaker is lifted up around the block until it is fully under, like in a real lab
        const needed = Math.max(0, h.blockY + h.side / 2 + 0.25 - 3.0)
        this.beakerA.position.y = needed * down
        this.beakerWater.setLevel(0.1, 3.0)
        this.arrows(down > 0.8, h.blockY, B, W)
        if (local > 3.4 && !rows[i]) rows[i] = { name: `${t.volume} cm³ ${t.object}`, air: W, liq: A }
        this.relabel(this.archiLabel, `${t.volume} cm³ ${t.object} in ${this.liquidInfo(t.liquid).name.toLowerCase()}`)
        this.emitGauges(dt, () => [
          { label: 'Block', value: `${t.volume} cm³ ${t.object}`, tone: 'info' },
          { label: 'Weight in air', value: `${f2(W)} N` },
          { label: 'Scale reading', value: `${f2(reading)} N${reading < 0 ? ' (held down)' : ''}`, tone: 'warn' },
          { label: 'Loss in weight', value: `${f2(W - reading)} N`, tone: 'ok' },
          ...(p.held ? [{ label: 'Buoyant force', value: `${f2(B)} N`, tone: 'ok' as const }] : []),
          ...rows.filter(Boolean).slice(0, i).map((r) => ({ label: r.name, value: `${f2(r.air)} → ${f2(r.liq)} N` })),
        ])
        if (st.t > per * p.tests.length - 0.1) {
          this.events.onNote?.('Buoyant force = weight of the liquid displaced. The scale reads the weight in air minus the buoyant force.')
          return 800
        }
        return null
      },
      done: () => {
        this.arrows(false, 0, 0, 0)
        this.beakerA.position.y = 0
        this.beakerWater.setLevel(0.1, 3.0)
      },
    })
  }

  private async runBoat(p: { mass: number; hull: number; liquid: string; clayvolume: number }): Promise<void> {
    this.abort()
    this.setupArchi('boat', p)
    const v = this.view('tank')
    await this.flyTo(v.pos, v.target, 1100)
    if (this.disposed) return
    const liq = this.liquidInfo(p.liquid)
    const need = p.mass / liq.density
    const floatsNow = boatFloats(p.mass, p.hull, liq.density)
    const f = Math.min(1, need / p.hull)
    const UNIT = 0.2
    const lumpR = Math.cbrt((3 * p.clayvolume) / (4 * Math.PI)) * UNIT * 1.6
    const hullR = Math.cbrt((1.5 * p.hull) / Math.PI) * UNIT
    const surface = 2.6
    this.clay.scale.setScalar(lumpR / 0.5)
    this.boat.scale.setScalar(hullR)
    const depth = bowlDepth(f) * hullR
    const floatY = surface - depth + hullR // the bowl's rim height when afloat: centre of the sphere sits `hullR - depth` above the water
    const st = { t: 0 }
    return this.begin({
      update: (dt) => {
        st.t += dt
        const t = st.t
        // first the lump, which sinks; then the same clay as a boat
        this.clay.visible = t < 3.6
        this.boat.visible = t >= 3.6
        const dropL = smooth(0.4, 1.4, t)
        const sink = smooth(1.4, 2.4, t)
        this.clay.position.set(0, 6 + (surface + lumpR - 6) * dropL + (0.1 + lumpR - surface - lumpR) * sink, 0)
        const tb = t - 3.6
        const dropB = smooth(0.2, 1.2, tb)
        const settle = smooth(1.2, 2.8, tb)
        let y = 6 + (surface + hullR * 0.3 - 6) * dropB
        if (floatsNow) y = y + (floatY - y) * settle + Math.sin(tb * 5) * 0.05 * (1 - settle)
        else y = y + (0.1 + 0.05 - y) * settle
        this.boat.position.set(0, tb < 0 ? 6 : y, 0)
        this.boat.rotation.x = 0
        const lumpDone = t > 2.6
        this.emitGauges(dt, () => [
          { label: 'Clay', value: `${p.mass} g (${f2(1.8)} g/cm³)`, tone: 'info' },
          { label: 'Clay lump', value: lumpDone ? 'sinks' : '…', tone: 'warn' },
          { label: 'Boat hull volume', value: `${p.hull} cm³` },
          { label: `${liq.name} to displace`, value: `${f1(need)} cm³ (weighs ${p.mass} g)`, tone: 'info' },
          { label: 'Boat', value: tb > 2.4 ? (floatsNow ? `floats, ${Math.round(f * 100)}% under` : 'sinks') : '…', tone: 'ok' },
        ])
        if (tb > 4.4) {
          this.events.onNote?.(floatsNow ? 'The hull displaces as much liquid as the boat weighs, so it floats.' : 'The hull cannot displace enough liquid to hold the boat up, so it sinks.')
          return 800
        }
        return null
      },
      done: () => {
        this.clay.visible = false
        this.boat.visible = false
      },
    })
  }

  /** The tests a spring-scale question asks the scene to run: one block, a pair, two liquids, or two sizes. */
  private springTests(params: Record<string, unknown>): { tests: { object: string; volume: number; liquid: string }[]; held: boolean } {
    const object = String(params.object ?? 'iron')
    const volume = num(params.volume, 200)
    const liquid = String(params.liquid ?? 'water')
    const mode = String(params.mode ?? '')
    const pair = (params.pair as string[]) ?? []
    if (mode === 'pair' && pair.length === 2) return { tests: pair.map((o) => ({ object: o, volume, liquid })), held: false }
    if (mode === 'liquids') return { tests: [{ object: pair[0] ?? object, volume, liquid }, { object: pair[0] ?? object, volume, liquid: String(params.liquid2 ?? 'oil') }], held: false }
    if (mode === 'volumes') return { tests: [{ object: pair[0] ?? object, volume, liquid }, { object: pair[0] ?? object, volume: num(params.volume2, volume * 2), liquid }], held: false }
    return { tests: [{ object, volume, liquid }], held: mode === 'held' }
  }

  private archiParams(action: string, params: Record<string, unknown>): Record<string, unknown> {
    if (action === 'spring_scale') {
      const t = this.springTests(params).tests[0]
      return { object: t.object, volume: t.volume, liquid: t.liquid }
    }
    return params
  }

  /* =============================== views and control =============================== */
  private view(name: string): { pos: THREE.Vector3; target: THREE.Vector3 } {
    const X1 = X.properties_changes
    const X2 = X.density_measurement
    switch (name) {
      case 'states':
        return { pos: V(-2.5, 5.2, 17.5), target: V(-3.6, 2.4, 0) }
      case 'chambers':
        return { pos: V(0, 3.4, 14.5), target: V(0, 1.6, 0) }
      case 'bench':
        return { pos: V(X1, 7, 12.5), target: V(X1, 2.2, 0) }
      case 'weigh':
        return { pos: V(X2 + 1, 5.4, 16.5), target: V(X2 - 0.5, 2.4, 0) }
      case 'jar':
        return { pos: V(X2 + 8, 4.4, 14), target: V(X2 + 8, 1.6, 0) }
      case 'can':
        return { pos: V(X2 + CAN_X + 2, 5.2, 14), target: V(X2 + CAN_X + 1.8, 1.8, 0) }
      case 'spring':
        return { pos: V(X2 + SPRING_X + 1, 6.5, 16), target: V(X2 + SPRING_X + 0.5, 4.2, 0) }
      case 'tank':
        return { pos: V(X2 + TANK_X, 4.6, 13), target: V(X2 + TANK_X, 1.8, 0) }
      case 'a1':
        return { pos: V(-2.5, 6, 18.5), target: V(-3.6, 2.4, 0) }
      case 'a2':
        return { pos: V(X1, 7, 13.5), target: V(X1, 2.2, 0) }
      default:
        return { pos: V(X2 + 3, 6, 19), target: V(X2 + 3, 2.2, 0) }
    }
  }

  async goto(moduleId: string, instant = false): Promise<void> {
    this.abort()
    this.moduleId = moduleId
    for (const [id, g] of Object.entries(this.groups)) g.visible = id === moduleId
    this.events.onGauges?.(null)
    this.events.onNote?.(null)
    const v = this.view(moduleId === 'states_changes' ? 'a1' : moduleId === 'properties_changes' ? 'a2' : 'a3')
    if (instant) {
      this.camera.position.copy(v.pos)
      this.controls.target.copy(v.target)
    } else await this.flyTo(v.pos, v.target)
  }

  /** Sets the table for a question before it is answered, without running it. */
  stage(action: string, params: Record<string, unknown> = {}) {
    if (this.busy) return
    switch (action) {
      case 'heat': {
        const p = { mode: String(params.mode ?? 'melt'), sub: num(params.sub, 150), beaker: num(params.beaker, 100), lid: params.lid === true, show: String(params.show ?? '') }
        this.setupHeat(p)
        this.setMass(0, p.beaker + p.sub)
        const s = heatState(p.mode, 0, p.show)
        this.relabel(this.tempLabel, `Temperature: ${f1(s.T)} °C`)
        const v = this.view('states')
        void this.flyTo(v.pos, v.target, 900)
        break
      }
      case 'particles': {
        this.statesStage.visible = true
        this.pans[0].anchor.parent!.visible = false
        this.thermo.visible = false
        this.tempLabel.visible = false
        this.chambers.forEach((c) => (c.visible = true))
        const v = this.view('chambers')
        void this.flyTo(v.pos, v.target, 900)
        break
      }
      case 'burn':
      case 'dissolve':
      case 'test_tool':
        this.setupBench(action, params)
        break
      case 'displace':
      case 'spring_scale':
      case 'boat':
        this.setupArchi(action, this.archiParams(action, params))
        break
      case 'weigh_liquids':
      case 'measure':
      case 'layer':
      case 'drop': {
        const liquids = action === 'drop' ? [String(params.liquid ?? 'water')] : (params.liquids as string[]) ?? []
        this.setupDensity(action, { liquids })
        if (action === 'drop') {
          const info = this.liquidInfo(String(params.liquid ?? 'water'))
          this.layers.forEach((l, i) => (l.visible = i === 0))
          ;(this.layers[0].material as THREE.MeshStandardMaterial).color.setHex(info.color)
          ;(this.layers[0].material as THREE.MeshStandardMaterial).opacity = 0.55
          this.layers[0].setLevel(0.1, 4.4)
        }
        break
      }
      default:
    }
  }

  async run(action: string, params: Record<string, unknown> = {}): Promise<void> {
    this.events.onNote?.(null)
    switch (action) {
      case 'heat':
        return this.runHeat({ mode: String(params.mode ?? 'melt'), sub: num(params.sub, 150), beaker: num(params.beaker, 100), lid: params.lid === true, show: String(params.show ?? '') })
      case 'particles':
        return this.runParticles(String(params.focus ?? 'gas'))
      case 'burn':
        return this.runBurn({ substance: String(params.substance ?? 'magnesium'), process: String(params.process ?? 'burn') })
      case 'dissolve':
        return this.runDissolve({ substance: String(params.substance ?? 'salt'), recover: params.recover !== false })
      case 'test_tool':
        return this.runTool({ tool: String(params.tool ?? 'hammer'), substance: String(params.substance ?? 'copper') })
      case 'weigh_liquids':
        return this.runWeigh({ liquids: (params.liquids as string[]) ?? ['water'], volume: num(params.volume, 50) })
      case 'measure':
        return this.runWeigh({ liquids: (params.liquids as string[]) ?? ['water'], volume: num(params.volume, 50), mode: String(params.mode ?? '') })
      case 'displace': {
        const a = (params.a as { name: string; side: number; density: number }) ?? { name: 'iron', side: 4, density: 7.87 }
        const b = (params.b as { name: string; side: number; density: number }) ?? { name: 'wood', side: 8, density: 0.6 }
        return this.runDisplace({ a, b, liquid: String(params.liquid ?? 'water') })
      }
      case 'spring_scale':
        return this.runSpring(this.springTests(params))
      case 'boat':
        return this.runBoat({ mass: num(params.mass, 100), hull: num(params.hull, 250), liquid: String(params.liquid ?? 'water'), clayvolume: num(params.clayvolume, 55) })
      case 'layer':
        return this.runLayer({ liquids: (params.liquids as string[]) ?? ['honey', 'water', 'oil'] })
      case 'drop':
        return this.runDrop({ object: String(params.object ?? 'cork'), liquid: String(params.liquid ?? 'water') })
      default:
    }
  }

  protected tick(dt: number, time: number) {
    if (this.job === null && this.moduleId === 'states_changes') {
      // while idle, a little steam curls off a warm beaker so the scene is never dead still
      this.puffSteam(dt, 0, true)
    }
    void time
    void easeInOut
  }
}
