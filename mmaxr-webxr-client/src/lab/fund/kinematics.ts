import * as THREE from 'three'
import type { FundamentalsScene } from '../fundamentalsScene'
import { CanvasPanel, V, fx, num, seg } from '../fundamentalsScene'
import { accelOf } from '../fundamentalsPhysics'

/*
 * Tab 1, Kinematics & Vectors: a circular test track drawn at a fixed size (radius RD units) whatever its real
 * circumference; the readouts use the real metres. The start line is at the front (nearest the camera) and the car
 * drives anticlockwise seen from above. A gold arrow is the displacement, blue the velocity, orange the acceleration.
 */
export const ACTIONS = ['walk', 'lap', 'accel']
const ID = 'kinematics_vectors'
const RD = 16
const HALF_W = 2.6
const GOLD = 0xffd166
const BLUE = 0x4f8cff
const ORANGE = 0xff8c42
const at = (phi: number, r = RD) => V(r * Math.sin(phi), 0, r * Math.cos(phi))
const tangent = (phi: number) => V(Math.cos(phi), 0, -Math.sin(phi))
const inward = (phi: number) => V(-Math.sin(phi), 0, -Math.cos(phi))
/** Compass words for a direction on the track: north is away from the camera (−z), east is +x. */
function compass(d: THREE.Vector3): string {
  if (d.lengthSq() < 1e-6) return ''
  const a = Math.atan2(d.x, -d.z) // 0 = north, clockwise
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖']
  const i = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8
  return `${arrows[i]} ${names[i]}`
}

/** The permanent track: grass, asphalt, kerbs, a dashed centre line and a chequered start line. */
export function build(k: FundamentalsScene) {
  const g = k.groups[ID]
  const grass = k.mesh(new THREE.CircleGeometry(RD - HALF_W - 0.6, 96), k.mat(0x24462c, 0, 0.95), false)
  grass.rotation.x = -Math.PI / 2
  grass.position.y = 0.0
  const verge = k.mesh(new THREE.RingGeometry(RD + HALF_W + 0.6, RD + HALF_W + 5, 128), k.mat(0x24462c, 0, 0.95), false)
  verge.rotation.x = -Math.PI / 2
  const asphalt = k.mesh(new THREE.RingGeometry(RD - HALF_W, RD + HALF_W, 160), k.mat(0x2b2f36, 0.05, 0.85), false)
  asphalt.rotation.x = -Math.PI / 2
  asphalt.position.y = 0.02
  g.add(grass, verge, asphalt)
  // red and white kerbs on both edges
  const n = 96
  const kerbGeo = new THREE.BoxGeometry(1, 0.12, 0.6)
  for (const side of [-1, 1]) {
    const r = RD + side * (HALF_W + 0.3)
    for (let i = 0; i < n; i++) {
      const phi = ((i + 0.5) / n) * Math.PI * 2
      const kb = new THREE.Mesh(kerbGeo, k.mat(i % 2 ? 0xd7263d : 0xf2f2f2, 0, 0.7))
      kb.scale.x = (2 * Math.PI * r) / n
      kb.position.copy(at(phi, r)).setY(0.06)
      kb.rotation.y = phi
      kb.receiveShadow = true
      g.add(kb)
    }
  }
  // dashed centre line
  for (let i = 0; i < 60; i++) {
    const phi = ((i + 0.25) / 60) * Math.PI * 2
    const d = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.18).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf5f5f5 }))
    d.rotation.y = phi
    d.position.copy(at(phi)).setY(0.04)
    g.add(d)
  }
  // chequered start line across the track at phi = 0 (front)
  const cells = 12
  for (let i = 0; i < cells; i++)
    for (let j = 0; j < 2; j++) {
      const c = new THREE.Mesh(new THREE.PlaneGeometry((2 * HALF_W) / cells, 0.45), new THREE.MeshBasicMaterial({ color: (i + j) % 2 ? 0x111111 : 0xffffff }))
      c.rotation.x = -Math.PI / 2
      c.position.set(-0.225 + j * 0.45, 0.05, RD - HALF_W + ((i + 0.5) * 2 * HALF_W) / cells)
      c.rotation.z = Math.PI / 2
      g.add(c)
    }
  const startTag = k.label('START', '#ffd166', 0.8)
  startTag.position.set(-2.4, 1.2, RD + HALF_W + 2.2)
  g.add(startTag)
  // a few cones and a gantry for life
  for (let i = 0; i < 10; i++) {
    const phi = (i / 10) * Math.PI * 2 + 0.3
    const cone = k.mesh(new THREE.ConeGeometry(0.35, 0.9, 16), k.mat(0xff7a1a, 0, 0.6))
    cone.position.copy(at(phi, RD + HALF_W + 2.6)).setY(0.45)
    g.add(cone)
  }
}

interface Rig {
  car: THREE.Group
  disp: ReturnType<FundamentalsScene['arrow']>
  vel: ReturnType<FundamentalsScene['arrow']>
  acc: ReturnType<FundamentalsScene['arrow']>
  trail: THREE.InstancedMesh
  board: CanvasPanel
  graph: CanvasPanel | null
}
const TRAIL_STEP = 0.45

/** The car and the arrows, ready at the start line. */
function rig(k: FundamentalsScene, withGraph = false): Rig {
  const g = k.clear(ID)
  const car = k.fit(k.models.car, { depth: 4.4, fallback: () => k.mesh(new THREE.BoxGeometry(2, 1.2, 4.4), k.mat(0xd7263d, 0.4, 0.4)) })
  g.add(car)
  const disp = k.arrow(GOLD, 0.3)
  const vel = k.arrow(BLUE, 0.28)
  const acc = k.arrow(ORANGE, 0.28)
  // the odometer trail: one glowing dot every TRAIL_STEP units along the path
  const maxDots = 1400
  const trail = new THREE.InstancedMesh(new THREE.CircleGeometry(0.16, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x5ee6ff, transparent: true, opacity: 0.85 }), maxDots)
  trail.count = 0
  trail.frustumCulled = false
  const board = new CanvasPanel(13, 5.2)
  board.position.set(0, 3.4, -3)
  g.add(disp, vel, acc, trail, board)
  let graph: CanvasPanel | null = null
  if (withGraph) {
    graph = new CanvasPanel(11, 6)
    graph.position.set(6.2, 3.8, -1)
    board.position.set(-6.4, 3.4, -1)
    board.scale.setScalar(0.85)
    g.add(graph)
  }
  // billboard the panels towards the camera
  k.idle.add(() => {
    board.quaternion.copy(k.camera.quaternion)
    if (graph) graph.quaternion.copy(k.camera.quaternion)
  })
  return { car, disp, vel, acc, trail, board, graph }
}
function drawBoard(b: CanvasPanel, rows: [string, string, string][]) {
  b.card()
  const h = b.H / (rows.length + 0.4)
  rows.forEach(([name, value, color], i) => {
    const y = h * (i + 0.7)
    b.text(name, 28, y, Math.round(h * 0.36), '#9fb0c8', 'left', 600)
    b.text(value, b.W - 28, y, Math.round(h * 0.5), color, 'right', 800)
  })
  b.flush()
}
const dotMatrix = new THREE.Matrix4()
function setTrail(trail: THREE.InstancedMesh, pointAt: (s: number) => THREE.Vector3, length: number) {
  const n = Math.min(trail.instanceMatrix.count, Math.floor(length / TRAIL_STEP))
  for (let i = trail.count; i < n; i++) {
    const p = pointAt(i * TRAIL_STEP)
    trail.setMatrixAt(i, dotMatrix.makeTranslation(p.x, 0.09, p.z))
  }
  if (n !== trail.count) {
    trail.count = n
    trail.instanceMatrix.needsUpdate = true
  }
}
function placeCar(car: THREE.Group, p: THREE.Vector3, dir: THREE.Vector3) {
  car.position.copy(p)
  // the model's nose points along −z, so turn −z onto the direction of travel
  car.rotation.y = Math.atan2(-dir.x, -dir.z)
}

export function stage(k: FundamentalsScene, action: string, params: Record<string, unknown>) {
  if (action === 'walk') {
    const w = walkSetup(k, num(params.a, 3), num(params.b, 4), false)
    drawBoard(w.r.board, [['Odometer (distance)', '0.0 m', '#5ee6ff'], ['Displacement', '0.0 m', '#ffd166']])
    void k.flyTo(V(0, 30, 22), V(0, 0, 0), 1000)
    return
  }
  const r = rig(k, action === 'accel')
  placeCar(r.car, at(0), tangent(0))
  drawBoard(r.board, [['Time', '0.0 s', '#e6edf7'], ['Odometer (distance)', '0.0 m', '#5ee6ff'], ['Displacement', '0.0 m', '#ffd166']])
  if (r.graph) drawGraph(r.graph, [], num(params.t, 5), Math.max(num(params.u, 0), num(params.v, 20)))
  void k.flyTo(V(0, 30, 40), V(0, 0, 2), 1000)
}

export function run(k: FundamentalsScene, action: string, p: Record<string, unknown>): Promise<void> {
  if (action === 'walk') return runWalk(k, num(p.a, 3), num(p.b, 4))
  if (action === 'accel') return runAccel(k, num(p.u, 0), num(p.v, 20), num(p.t, 5), num(p.C, 100))
  return runLap(k, { C: num(p.C, 100), frac: num(p.frac, 1), t: typeof p.t === 'number' ? p.t : null, v: typeof p.v === 'number' ? p.v : null, steady: p.steady === true, showAcc: p.showAcc === true })
}

/* ---------------- an L-shaped drive on the infield: distance adds, displacement is the arrow ---------------- */
function walkSetup(k: FundamentalsScene, a: number, b: number, labels: boolean) {
  const r = rig(k)
  const g = k.stuff[ID]
  const hyp = Math.hypot(a, b)
  const sc = Math.min(20 / hyp, 14 / Math.max(a, b))
  const O = V((-a * sc) / 2, 0, (b * sc) / 2)
  // a 1 m grid on the infield so the legs can be counted
  const size = Math.ceil(Math.max(a, b) + 2) * sc
  const grid = new THREE.GridHelper(size, Math.ceil(Math.max(a, b) + 2), 0x9fd3a8, 0x5f8f68)
  ;(grid.material as THREE.Material).transparent = true
  ;(grid.material as THREE.Material).opacity = 0.55
  grid.position.set(O.x + (a * sc) / 2, 0.08, O.z - (b * sc) / 2)
  g.add(grid)
  const north = k.label('N ↑', '#e6edf7', 1.3)
  north.position.set(O.x + a * sc + 3, 1.2, O.z - b * sc - 1)
  const east = k.label('E →', '#e6edf7', 1.3)
  east.position.set(O.x + a * sc + 4.5, 1.2, O.z - b * sc + 1)
  const startTag = k.label('start', '#ffd166', 1.2)
  startTag.position.copy(O).add(V(-2.6, 1.3, 1.6))
  g.add(north, east, startTag)
  if (labels) {
    const l1 = k.label(`${fx(a, 0)} m east`, '#5ee6ff', 1.3)
    l1.position.copy(O).add(V((a * sc) / 2, 1.2, 2.4))
    const l2 = k.label(`${fx(b, 0)} m north`, '#5ee6ff', 1.3)
    l2.position.copy(O).add(V(a * sc + 4.2, 1.2, (-b * sc) / 2))
    g.add(l1, l2)
  }
  r.car.scale.setScalar(Math.min(1, sc / 3))
  r.board.position.set(-7, 3.4, -6)
  placeCar(r.car, O, V(1, 0, 0))
  return { r, O, sc }
}
function runWalk(k: FundamentalsScene, a: number, b: number): Promise<void> {
  k.abort()
  const { r, O, sc } = walkSetup(k, a, b, true)
  void k.flyTo(V(0, 30, 22), V(0, 0, 0), 900)
  const L1 = a * sc
  const L2 = b * sc
  const total = a + b
  const st = { t: 0 }
  const pathAt = (s: number) => (s <= L1 ? O.clone().add(V(s, 0, 0)) : O.clone().add(V(L1, 0, -(s - L1))))
  let doneLabel: THREE.Sprite | null = null
  return k.begin({
    update: (dt) => {
      st.t += dt
      const prog = seg(st.t, 0.8, 6.8)
      const sUnits = prog * (L1 + L2)
      const p = pathAt(sUnits)
      const dir = sUnits < L1 - 0.3 ? V(1, 0, 0) : sUnits > L1 + 0.3 ? V(0, 0, -1) : V(1, 0, -1).normalize()
      placeCar(r.car, p, dir)
      setTrail(r.trail, pathAt, sUnits)
      const dvec = p.clone().sub(O)
      const dist = (sUnits / (L1 + L2)) * total
      const dispM = dvec.length() / sc
      k.point(r.disp, O.clone().setY(0.5), dvec, dvec.length(), 1.2)
      drawBoard(r.board, [['Odometer (distance)', `${fx(dist)} m`, '#5ee6ff'], ['Displacement', `${fx(dispM)} m ${compass(dvec)}`, '#ffd166']])
      if (prog >= 1 && !doneLabel) {
        doneLabel = k.label(`displacement ${fx(dispM)} m`, '#ffd166', 1.4)
        doneLabel.position.copy(O).add(dvec.clone().multiplyScalar(0.5)).add(V(-2.5, 1.6, 0))
        k.stuff[ID].add(doneLabel)
      }
      k.emitGauges(dt, () => [
        { label: 'Distance (odometer)', value: `${fx(dist)} m`, tone: 'info' },
        { label: 'Displacement', value: `${fx(dispM)} m ${compass(dvec)}`, tone: 'warn' },
      ])
      return st.t > 7.6 ? 1200 : null
    },
    done: () => undefined,
  })
}

/* ---------------- laps: distance keeps growing, displacement is the chord back to the start ---------------- */
function runLap(k: FundamentalsScene, p: { C: number; frac: number; t: number | null; v: number | null; steady: boolean; showAcc: boolean }): Promise<void> {
  k.abort()
  const r = rig(k)
  void k.flyTo(V(0, 30, 40), V(0, 0, 2), 900)
  const D = p.frac * p.C
  const T = p.t ?? (p.v ? D / p.v : D / 12)
  const speed = D / T
  const A = Math.min(10, Math.max(4.5, 4.5 * p.frac)) // seconds of animation
  const st = { t: 0 }
  const S = at(0).setY(0.55)
  const pathAt = (s: number) => at(s / RD)
  return k.begin({
    update: (dt) => {
      st.t += dt
      const prog = seg(st.t, 0.6, 0.6 + A)
      const phi = prog * p.frac * Math.PI * 2
      const pos = at(phi)
      const T1 = tangent(phi)
      placeCar(r.car, pos, T1)
      setTrail(r.trail, pathAt, Math.min(prog * p.frac, 1) * Math.PI * 2 * RD)
      const dvec = pos.clone().sub(at(0))
      const real = (RD > 0 ? p.C / (2 * Math.PI * RD) : 1) // metres per unit
      const dist = prog * D
      const disp = dvec.length() * real
      const time = prog * T
      const moving = prog > 0 && prog < 1
      k.point(r.disp, S, dvec, dvec.length(), 1.4)
      k.point(r.vel, pos.clone().setY(2.6), T1, moving ? 3.5 + speed * 0.3 : 0, 1.4)
      if (p.showAcc) k.point(r.acc, pos.clone().setY(1.6), inward(phi), moving ? 3.5 + (speed * speed) / (p.C / (2 * Math.PI)) * 0.6 : 0, 1.4)
      const rows: [string, string, string][] = [['Time', `${fx(time)} s`, '#e6edf7'], ['Odometer (distance)', `${fx(dist)} m`, '#5ee6ff'], ['Displacement', `${fx(disp)} m ${prog >= 1 && disp < 0.05 ? '(back at the start)' : compass(dvec)}`, '#ffd166']]
      drawBoard(r.board, rows)
      k.emitGauges(dt, () => {
        const g = [
          { label: 'Time', value: `${fx(time)} s` },
          { label: 'Distance (odometer)', value: `${fx(dist)} m`, tone: 'info' as const },
          { label: 'Displacement', value: `${fx(disp)} m ${compass(dvec)}`, tone: 'warn' as const },
          { label: 'Speed', value: `${fx(moving ? speed : 0)} m/s` },
          { label: 'Velocity', value: moving ? `${fx(speed)} m/s ${compass(T1)}` : '0.0 m/s' },
        ]
        if (p.showAcc) g.push({ label: 'Acceleration', value: moving ? `${fx((speed * speed) / (p.C / (2 * Math.PI)), 2)} m/s² to the centre` : '0' })
        if (prog >= 1 && p.t !== null) g.push({ label: 'Average speed', value: `${fx(D / T, 2)} m/s`, tone: 'info' }, { label: 'Average velocity', value: `${fx(disp / T, 2)} m/s`, tone: 'warn' })
        return g
      }, prog >= 1)
      return st.t > A + 1.2 ? 1400 : null
    },
    done: () => undefined,
  })
}

/* ---------------- speeding up or braking along the track, with a live speed–time graph ---------------- */
function drawGraph(gp: CanvasPanel, pts: [number, number][], tMax: number, vMax: number) {
  gp.card()
  const x0 = 70
  const y0 = gp.H - 60
  const w = gp.W - 100
  const h = gp.H - 120
  const c = gp.ctx
  c.strokeStyle = 'rgba(255,255,255,0.35)'
  c.lineWidth = 2
  c.beginPath()
  c.moveTo(x0, 40)
  c.lineTo(x0, y0)
  c.lineTo(x0 + w, y0)
  c.stroke()
  gp.text('speed (m/s)', x0 + 4, 26, 20, '#9fb0c8', 'left', 600)
  gp.text('time (s)', x0 + w, y0 + 34, 20, '#9fb0c8', 'right', 600)
  const top = Math.ceil(vMax / 5) * 5 || 5
  for (let v = 0; v <= top; v += top / 4) gp.text(fx(v, 0), x0 - 10, y0 - (v / top) * h, 18, '#9fb0c8', 'right', 500)
  if (pts.length > 1) {
    c.strokeStyle = '#4f8cff'
    c.lineWidth = 5
    c.beginPath()
    pts.forEach(([t, v], i) => {
      const X = x0 + (t / tMax) * w
      const Y = y0 - (v / top) * h
      if (i === 0) c.moveTo(X, Y)
      else c.lineTo(X, Y)
    })
    c.stroke()
  }
  gp.flush()
}
function runAccel(k: FundamentalsScene, u: number, v: number, t: number, C: number): Promise<void> {
  k.abort()
  const r = rig(k, true)
  void k.flyTo(V(0, 30, 40), V(0, 0, 2), 900)
  const a = accelOf(u, v, t)
  const A = 6
  const st = { t: 0 }
  const S = at(0).setY(0.55)
  const unitsPerM = (2 * Math.PI * RD) / C
  const pts: [number, number][] = []
  const pathAt = (s: number) => at(s / RD)
  return k.begin({
    update: (dt) => {
      st.t += dt
      const prog = seg(st.t, 0.6, 0.6 + A)
      const time = prog * t
      const speed = u + a * time
      const dist = u * time + 0.5 * a * time * time
      const phi = (dist * unitsPerM) / RD
      const pos = at(phi)
      const T1 = tangent(phi)
      placeCar(r.car, pos, T1)
      setTrail(r.trail, pathAt, Math.min(dist * unitsPerM, 2 * Math.PI * RD))
      const dvec = pos.clone().sub(at(0))
      k.point(r.disp, S, dvec, dvec.length(), 1.4)
      k.point(r.vel, pos.clone().setY(2.6), T1, speed > 0.05 ? 2 + speed * 0.3 : 0, 1.4)
      const moving = prog > 0 && prog < 1
      k.point(r.acc, pos.clone().setY(1.6), T1.clone().multiplyScalar(Math.sign(a) || 1), moving ? 2.5 + Math.abs(a) * 0.5 : 0, 1.4)
      if (!pts.length || time - pts[pts.length - 1][0] > t / 60) pts.push([time, speed])
      drawGraph(r.graph!, pts, t, Math.max(u, v))
      drawBoard(r.board, [['Time', `${fx(time)} s`, '#e6edf7'], ['Speed', `${fx(speed)} m/s`, '#4f8cff'], ['Odometer (distance)', `${fx(dist)} m`, '#5ee6ff']])
      k.emitGauges(dt, () => [
        { label: 'Time', value: `${fx(time)} s` },
        { label: 'Speed', value: `${fx(speed)} m/s`, tone: 'info' },
        { label: 'Change in speed so far', value: `${fx(speed - u)} m/s` },
        { label: 'Acceleration', value: moving || prog >= 1 ? `${fx(a, 2)} m/s² ${a < 0 ? '(slowing down)' : ''}` : '–', tone: 'warn' },
      ], prog >= 1)
      return st.t > A + 1 ? 1400 : null
    },
    done: () => undefined,
  })
}
