import * as THREE from 'three'
import type { FundamentalsScene } from '../fundamentalsScene'
import { CanvasPanel, V, easeInOut, fx, num, seg } from '../fundamentalsScene'
import { G_EARTH, G_MOON, chargeOf, kelvin } from '../fundamentalsPhysics'
import { sound } from '../sound'
import { barMeter, bulb, stopwatch } from './common'

/*
 * Tab 4, Measurements: a workstation desk. One instrument at a time is set out on it: a digital thermometer in water,
 * a pendulum and stopwatch, a beam balance with brass masses, a spring balance that can go to the Moon, a ruler and a
 * cube, a graduated cylinder, and a bulb circuit with an ammeter in series.
 */
export const ACTIONS = ['thermo', 'stopwatch', 'balance', 'moon', 'ruler', 'cylinder', 'ammeter']
const ID = 'fundamental_quantities'
const DESK = 3 // height of the desk top

export function build(k: FundamentalsScene) {
  const g = k.groups[ID]
  const top = k.mesh(new THREE.BoxGeometry(30, 0.35, 8), k.mat(0x6b4a2f, 0.05, 0.6))
  top.position.y = DESK - 0.175
  g.add(top)
  for (const x of [-14, 14])
    for (const z of [-3.4, 3.4]) {
      const leg = k.mesh(new THREE.BoxGeometry(0.4, DESK - 0.35, 0.4), k.mat(0x2a303c, 0.5, 0.5))
      leg.position.set(x, (DESK - 0.35) / 2, z)
      g.add(leg)
    }
}

const homeView = (k: FundamentalsScene, near = false) => k.flyTo(near ? V(0, 8, 17) : V(0, 9, 22), V(0, near ? 5 : 5.5, 0), 900)

export function stage(k: FundamentalsScene, action: string, params: Record<string, unknown>) {
  const g = k.clear(ID)
  k.setBackground(0x0b0d12)
  if (action === 'thermo') {
    if (params.compare === true) {
      beakerSet(k, g, -4, 1.1, 2.2, 20)
      beakerSet(k, g, 4, 2.8, 4.2, 20)
    } else beakerSet(k, g, 0, 1.8, 3.4, 20)
    void homeView(k, true)
  } else if (action === 'stopwatch') {
    const p = pendStand(k, g, num(params.L, 1))
    p.pose(0)
    const sw = stopwatch(k, 3)
    sw.group.position.set(5.5, DESK, 0)
    g.add(sw.group)
    void homeView(k)
  } else if (action === 'balance') {
    const b = beamBalance(k, g, 0)
    b.setLeft(blockMesh(k, 0x7c8796, 1.4))
    void homeView(k, true)
  } else if (action === 'moon') {
    moonBench(k, g, num(params.m, 2))
    void homeView(k)
  } else if (action === 'ruler') {
    const c = cube(k, num(params.s, 2))
    g.add(c)
    void k.flyTo(V(2, 8, 12), V(0, DESK + 1, 0), 900)
  } else if (action === 'cylinder') {
    const c = gradCylinder(k, g)
    c.setLevel(num(params.v1, 50))
    void k.flyTo(V(0, 8, 15), V(0, DESK + 3.4, 0), 900)
  } else if (action === 'ammeter') {
    circuit(k, g)
    void homeView(k, true)
  }
}

export function run(k: FundamentalsScene, action: string, p: Record<string, unknown>): Promise<void> {
  switch (action) {
    case 'thermo':
      return runThermo(k, num(p.c, 100), String(p.what ?? 'water'), p.compare === true, String(p.small ?? 'cup'), String(p.big ?? 'bucket'))
    case 'stopwatch':
      return runStopwatch(k, num(p.L, 1), num(p.n, 20), num(p.tot, 40))
    case 'balance':
      return runBalance(k, Array.isArray(p.masses) ? (p.masses as unknown[]).map((x) => num(x, 0)) : [200, 50, 20])
    case 'moon':
      return runMoon(k, num(p.m, 2))
    case 'ruler':
      return runRuler(k, num(p.s, 2))
    case 'cylinder':
      return runCylinder(k, num(p.v1, 50), num(p.v2, 77), String(p.what ?? 'a small stone'))
    default:
      return runAmmeter(k, num(p.I, 0.5), num(p.t, 60))
  }
}

/* ---------------- temperature ---------------- */
function waterColor(c: number): THREE.Color {
  const cold = new THREE.Color(0x5aa9ff)
  const warm = new THREE.Color(0x7fd3ff)
  const hot = new THREE.Color(0xff8a5c)
  return c < 25 ? cold.clone().lerp(warm, Math.max(0, (c + 20) / 45)) : warm.clone().lerp(hot, Math.min(1, (c - 25) / 75))
}
function beakerSet(k: FundamentalsScene, g: THREE.Group, x: number, r: number, h: number, c0: number) {
  const glass = k.mesh(new THREE.CylinderGeometry(r, r * 0.96, h, 40, 1, true), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, roughness: 0.05, side: THREE.DoubleSide }), false)
  glass.position.set(x, DESK + h / 2, 0)
  const bottom = k.mesh(new THREE.CylinderGeometry(r * 0.96, r * 0.96, 0.08, 40), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 }), false)
  bottom.position.set(x, DESK + 0.04, 0)
  const wMat = new THREE.MeshStandardMaterial({ color: waterColor(c0), transparent: true, opacity: 0.72, roughness: 0.1 })
  const water = k.mesh(new THREE.CylinderGeometry(r * 0.92, r * 0.9, h * 0.78, 40), wMat, false)
  water.position.set(x, DESK + 0.08 + (h * 0.78) / 2, 0)
  g.add(glass, bottom, water)
  // the digital thermometer stands in the water: its long side turned upright
  const turned = new THREE.Group()
  const probe = k.fitTurned(k.models.thermometer, [0, 0, Math.PI / 2], { height: h + 1.6, fallback: () => k.mesh(new THREE.CylinderGeometry(0.08, 0.08, h + 1.6, 10), k.mat(0xdfe5ee, 0.6, 0.3)) })
  turned.add(probe)
  turned.position.set(x + r * 0.45, DESK + 0.2, 0.2)
  g.add(turned)
  const display = new CanvasPanel(2.4, 0.8)
  display.position.set(x + r * 0.45, DESK + h + 2.2, 0.5)
  g.add(display)
  const set = (c: number) => {
    wMat.color.copy(waterColor(c))
    display.card()
    display.text(`${fx(c, 1)} °C`, display.W / 2, display.H / 2 + 2, Math.round(display.H * 0.56), '#5ee6ff', 'center', 800)
    display.flush()
  }
  set(c0)
  return { set, water, x, r, h, top: DESK + 0.08 + h * 0.78 }
}
/** A two-scale panel: Celsius on the left, kelvin on the right, with a marker at the reading. */
function scalePanel(k: FundamentalsScene) {
  const p = new CanvasPanel(3.2, 6.4, 384)
  const draw = (c: number) => {
    p.card()
    const top = 70
    const bot = p.H - 70
    const lo = -30
    const hi = 110
    const y = (v: number) => bot - ((v - lo) / (hi - lo)) * (bot - top)
    const x = p.W / 2
    const cx = p.ctx
    cx.fillStyle = 'rgba(255,255,255,0.12)'
    cx.fillRect(x - 14, top, 28, bot - top)
    cx.fillStyle = '#ff5470'
    cx.fillRect(x - 10, y(c), 20, bot - y(c))
    p.text('°C', x - 90, 36, 30, '#9fb0c8')
    p.text('K', x + 90, 36, 30, '#9fb0c8')
    for (const v of [-20, 0, 20, 40, 60, 80, 100]) {
      cx.fillStyle = 'rgba(255,255,255,0.5)'
      cx.fillRect(x - 30, y(v) - 1, 60, 2)
      p.text(`${v}`, x - 50, y(v), 24, '#e6edf7', 'right', 600)
      p.text(`${v + 273}`, x + 50, y(v), 24, '#e6edf7', 'left', 600)
    }
    cx.fillStyle = '#ffd166'
    cx.beginPath()
    cx.moveTo(x - 24, y(c))
    cx.lineTo(x - 44, y(c) - 12)
    cx.lineTo(x - 44, y(c) + 12)
    cx.fill()
    p.text(`${fx(c, 0)} °C = ${fx(kelvin(c), 0)} K`, x, p.H - 32, 28, '#ffd166', 'center', 800)
    p.flush()
  }
  draw(20)
  return { p, draw }
}
function runThermo(k: FundamentalsScene, c: number, what: string, compare: boolean, small: string, big: string): Promise<void> {
  k.abort()
  const g = k.clear(ID)
  const sets = compare ? [beakerSet(k, g, -4, 1.1, 2.2, 20), beakerSet(k, g, 4, 2.8, 4.2, 20)] : [beakerSet(k, g, 0, 1.8, 3.4, 20)]
  if (compare) {
    const a = k.label(`${small}`, '#e6edf7', 0.6)
    a.position.set(-4, DESK - 0.6, 3.4)
    const b = k.label(`${big}`, '#e6edf7', 0.6)
    b.position.set(4, DESK - 0.6, 3.4)
    g.add(a, b)
  } else {
    const a = k.label(what, '#e6edf7', 0.55)
    a.position.set(0, DESK - 0.6, 3.4)
    g.add(a)
  }
  const sc = compare ? null : scalePanel(k)
  if (sc) {
    sc.p.position.set(-6, DESK + 3.6, 0)
    g.add(sc.p)
  }
  const meters = compare
    ? [
        { m: barMeter(k, 0xff8a5c, 1, 'heat stored'), x: -7.5, frac: 0.06 },
        { m: barMeter(k, 0xff8a5c, 5, 'heat stored'), x: 9.2, frac: 1 },
      ]
    : []
  for (const mm of meters) {
    mm.m.group.position.set(mm.x, DESK, 0)
    g.add(mm.m.group)
  }
  void homeView(k, true)
  // ice cubes when it is freezing, bubbles and steam when it is hot
  const bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }), 60 * sets.length)
  bubbles.count = 0
  bubbles.frustumCulled = false
  g.add(bubbles)
  const steam = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false }), 30 * sets.length)
  steam.count = 0
  steam.frustumCulled = false
  g.add(steam)
  if (c <= 0)
    for (const s of sets)
      for (let i = 0; i < 4; i++) {
        const ice = k.mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), new THREE.MeshPhysicalMaterial({ color: 0xe8f6ff, transparent: true, opacity: 0.8, roughness: 0.15 }))
        ice.position.set(s.x - s.r * 0.4 + (i % 2) * 0.7, s.top - 0.1, -0.4 + Math.floor(i / 2) * 0.6)
        ice.rotation.y = i
        g.add(ice)
      }
  const seeds = Array.from({ length: 60 }, () => [Math.random(), Math.random(), Math.random()])
  const mtx = new THREE.Matrix4()
  const st = { t: 0 }
  return k.begin({
    update: (dt) => {
      st.t += dt
      const prog = 1 - Math.exp(-Math.max(0, st.t - 0.8) * 1.3)
      const now = 20 + (c - 20) * prog
      for (const s of sets) s.set(now)
      sc?.draw(now)
      meters.forEach((mm) => mm.m.set(mm.frac * prog, mm.frac < 1 ? 'small' : 'large'))
      let bn = 0
      let sn = 0
      if (now > 85)
        sets.forEach((s) => {
          for (const [a, b, cc] of seeds) {
            const u = (b + st.t * (0.6 + a)) % 1
            mtx.makeTranslation(s.x + (a - 0.5) * s.r * 1.4, DESK + 0.2 + u * (s.top - DESK - 0.2), (cc - 0.5) * s.r * 1.4)
            bubbles.setMatrixAt(bn++, mtx)
          }
          for (const [a, b] of seeds.slice(0, 30)) {
            const u = (b + st.t * 0.25) % 1
            mtx.makeScale(1 + u * 2, 1 + u * 2, 1 + u * 2).setPosition(s.x + (a - 0.5) * s.r + Math.sin(st.t + a * 9) * 0.3, s.top + 0.4 + u * 3, 0)
            steam.setMatrixAt(sn++, mtx)
          }
        })
      bubbles.count = bn
      steam.count = sn
      bubbles.instanceMatrix.needsUpdate = true
      steam.instanceMatrix.needsUpdate = true
      k.emitGauges(dt, () =>
        compare
          ? [
              { label: `Thermometer in the ${small}`, value: `${fx(now, 1)} °C`, tone: 'info' },
              { label: `Thermometer in the ${big}`, value: `${fx(now, 1)} °C`, tone: 'info' },
              { label: 'Water in the bigger one', value: 'many times more', tone: 'warn' },
            ]
          : [
              { label: 'Thermometer', value: `${fx(now, 1)} °C`, tone: 'info' },
              { label: 'In kelvin', value: `${fx(kelvin(now), 0)} K`, tone: 'warn' },
            ],
      )
      return st.t > 5.5 ? 1400 : null
    },
    done: () => undefined,
  })
}

/* ---------------- time: a pendulum and a stopwatch ---------------- */
function pendStand(k: FundamentalsScene, g: THREE.Group, L: number) {
  const Ld = 1.6 + L * 3.4
  const pivY = DESK + Ld + 1.2
  const base = k.mesh(new THREE.BoxGeometry(2.6, 0.25, 1.8), k.mat(0x1f2430, 0.5, 0.4))
  base.position.set(-2.6, DESK + 0.12, -0.6)
  const rod = k.mesh(new THREE.CylinderGeometry(0.08, 0.08, pivY - DESK + 0.4, 12), k.mat(0x9aa3b2, 0.9, 0.3))
  rod.position.set(-3.4, (pivY + DESK + 0.4) / 2, -0.6)
  const boss = k.mesh(new THREE.BoxGeometry(3.6, 0.18, 0.18), k.mat(0x9aa3b2, 0.9, 0.3))
  boss.position.set(-1.8, pivY, -0.6)
  g.add(base, rod, boss)
  const arm = new THREE.Group()
  arm.position.set(0, pivY, -0.6)
  const str = k.mesh(new THREE.CylinderGeometry(0.02, 0.02, Ld, 6), k.mat(0xe6edf7, 0, 0.8))
  str.position.y = -Ld / 2
  const bob = k.mesh(new THREE.SphereGeometry(0.35, 24, 16), k.mat(0xc9a24a, 1, 0.2))
  bob.position.y = -Ld
  arm.add(str, bob)
  g.add(arm)
  const ll = k.label(`length ${fx(L * 100, 0)} cm`, '#9fb0c8', 0.5)
  ll.position.set(1.6, pivY - Ld / 2, -0.6)
  g.add(ll)
  return { pose: (a: number) => (arm.rotation.z = a) }
}
function runStopwatch(k: FundamentalsScene, L: number, n: number, tot: number): Promise<void> {
  k.abort()
  const g = k.clear(ID)
  const p = pendStand(k, g, L)
  const sw = stopwatch(k, 3)
  sw.group.position.set(5.5, DESK, 0)
  g.add(sw.group)
  const counter = new CanvasPanel(3.4, 1.1)
  counter.position.set(5.5, DESK + 4.6, 0)
  g.add(counter)
  void homeView(k)
  const T = tot / n
  const A = 8
  const fast = Math.max(1, tot / A)
  const amp = 0.32
  const ff = k.label(fast > 1.05 ? `fast-forward ×${fx(fast, 1)}` : 'real time', '#9fb0c8', 0.5)
  ff.position.set(5.5, DESK - 0.5, 2.6)
  g.add(ff)
  const st = { t: 0, count: -1 }
  return k.begin({
    update: (dt) => {
      st.t += dt
      // pull aside, then release and start the watch at the same moment
      let real = 0
      if (st.t < 1) p.pose(amp * easeInOut(seg(st.t, 0.1, 0.9)))
      else {
        real = Math.min(tot, (st.t - 1) * fast)
        p.pose(amp * Math.cos((2 * Math.PI * real) / T))
      }
      sw.set(real)
      const swings = Math.floor(real / T + 1e-6)
      if (swings !== st.count) {
        st.count = swings
        if (swings > 0) sound.click()
        counter.card()
        counter.text(`swings: ${swings} / ${n}`, counter.W / 2, counter.H / 2 + 2, Math.round(counter.H * 0.45), '#ffd166')
        counter.flush()
      }
      const done = real >= tot
      k.emitGauges(dt, () => [
        { label: 'Complete swings', value: `${Math.min(n, swings)} of ${n}` },
        { label: 'Stopwatch', value: `${fx(real, 2)} s`, tone: 'info' },
        ...(done ? [{ label: 'One swing = total ÷ swings', value: `${fx(tot, 2)} ÷ ${n} = ${fx(T, 2)} s`, tone: 'warn' as const }] : []),
      ], done)
      return done && st.t > 1 + tot / fast + 0.4 ? 1600 : null
    },
    done: () => undefined,
  })
}

/* ---------------- mass: a beam balance with brass masses ---------------- */
function blockMesh(k: FundamentalsScene, color: number, size: number) {
  return k.mesh(new THREE.BoxGeometry(size, size * 0.8, size), k.mat(color, 0.85, 0.3))
}
function brass(k: FundamentalsScene, grams: number) {
  const s = Math.cbrt(grams / 100) * 0.55
  const grp = new THREE.Group()
  const body = k.mesh(new THREE.CylinderGeometry(s, s, s * 1.4, 24), k.mat(0xc9a24a, 1, 0.22))
  body.position.y = s * 0.7
  const knob = k.mesh(new THREE.SphereGeometry(s * 0.35, 12, 8), k.mat(0xc9a24a, 1, 0.22))
  knob.position.y = s * 1.4 + s * 0.25
  grp.add(body, knob)
  grp.userData.h = s * 1.4
  grp.userData.r = s
  return grp
}
function beamBalance(k: FundamentalsScene, g: THREE.Group, x: number) {
  const PIV_Y = DESK + 5
  const ARM = 3.2
  const base = k.mesh(new THREE.BoxGeometry(3, 0.35, 2), k.mat(0x1f2430, 0.5, 0.4))
  base.position.set(x, DESK + 0.17, -0.4)
  const pillar = k.mesh(new THREE.CylinderGeometry(0.16, 0.2, PIV_Y - DESK, 16), k.mat(0x9aa3b2, 0.9, 0.3))
  pillar.position.set(x, (PIV_Y + DESK) / 2, -0.4)
  g.add(base, pillar)
  const beam = new THREE.Group()
  beam.position.set(x, PIV_Y, -0.4)
  const bar = k.mesh(new THREE.BoxGeometry(ARM * 2, 0.16, 0.24), k.mat(0xc9a24a, 0.9, 0.25))
  const needle = k.mesh(new THREE.BoxGeometry(0.06, 2.2, 0.06), k.mat(0xd7263d, 0.3, 0.4))
  needle.position.y = -1.1
  beam.add(bar, needle)
  g.add(beam)
  const scale = new CanvasPanel(1.6, 0.6, 256)
  scale.position.set(x, PIV_Y - 2.4, -0.2)
  scale.card('rgba(8,12,20,0.6)')
  for (let i = -4; i <= 4; i++) {
    scale.ctx.fillStyle = i ? '#9fb0c8' : '#4ade80'
    scale.ctx.fillRect(scale.W / 2 + i * 26 - 2, 12, 4, i ? 30 : 44)
  }
  scale.flush()
  g.add(scale)
  const pans = [-1, 1].map((side) => {
    const hang = new THREE.Group()
    const pan = k.mesh(new THREE.CylinderGeometry(1.15, 0.95, 0.12, 32), k.mat(0x9aa3b2, 0.9, 0.25))
    hang.add(pan)
    const strings = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(18), 3)), new THREE.LineBasicMaterial({ color: 0xcfd6e0 }))
    g.add(hang, strings)
    const load = new THREE.Group()
    load.position.y = 0.06
    hang.add(load)
    return { side, hang, strings, load }
  })
  const DROP = 2.9
  let angle = 0
  const setAngle = (a: number) => {
    angle = a
    beam.rotation.z = a
    for (const p of pans) {
      const ex = x + p.side * ARM * Math.cos(a)
      const ey = PIV_Y + p.side * ARM * Math.sin(a)
      p.hang.position.set(ex, ey - DROP, -0.4)
      const arr = p.strings.geometry.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < 3; i++) {
        const q = (i / 3) * Math.PI * 2
        arr.setXYZ(i * 2, ex, ey, -0.4)
        arr.setXYZ(i * 2 + 1, ex + Math.cos(q) * 1.05, ey - DROP + 0.06, -0.4 + Math.sin(q) * 1.05)
      }
      arr.needsUpdate = true
    }
  }
  setAngle(0)
  const setLeft = (o: THREE.Object3D) => {
    pans[0].load.clear()
    o.position.y = (o as THREE.Mesh).geometry ? ((o as THREE.Mesh).geometry as THREE.BoxGeometry).parameters?.height / 2 || 0 : 0
    pans[0].load.add(o)
  }
  const addRight = (o: THREE.Object3D, slot: number) => {
    const cols = 3
    o.position.set(((slot % cols) - 1) * 0.6, 0, (Math.floor(slot / cols) - 0.5) * 0.6)
    pans[1].load.add(o)
  }
  return { setAngle, get angle() { return angle }, setLeft, addRight, pans }
}
function runBalance(k: FundamentalsScene, masses: number[]): Promise<void> {
  k.abort()
  const g = k.clear(ID)
  const b = beamBalance(k, g, 0)
  const total = masses.reduce((a, x) => a + x, 0)
  b.setLeft(blockMesh(k, 0x7c8796, 1.4))
  const lt = k.label('block', '#e6edf7', 0.55)
  lt.position.set(-3.2, DESK + 0.6, 1.6)
  g.add(lt)
  void homeView(k, true)
  const st = { t: 0, added: 0, angle: -0.22, w: 0, right: 0, tags: [] as string[] }
  const per = 1.4
  const maxTilt = 0.22
  return k.begin({
    update: (dt) => {
      st.t += dt
      const due = Math.min(masses.length, Math.floor((st.t - 0.8) / per) + 1)
      while (st.added < due && st.t > 0.8) {
        const gm = masses[st.added]
        b.addRight(brass(k, gm), st.added)
        st.right += gm
        st.tags.push(`${gm} g`)
        st.added += 1
        sound.click()
      }
      // left heavier → left pan down (beam turns anticlockwise seen from the front, so a positive angle)
      const target = Math.max(-maxTilt, Math.min(maxTilt, ((total - st.right) / total) * maxTilt * 2))
      st.w += ((target - st.angle) * 14 - st.w * 4.5) * dt
      st.angle += st.w * dt
      b.setAngle(st.angle)
      const done = st.added >= masses.length && st.t > 0.8 + masses.length * per + 1.2
      k.emitGauges(dt, () => [
        { label: 'Masses on the right pan', value: st.tags.join(' + ') || '–' },
        { label: 'Right pan total', value: `${st.right} g`, tone: 'info' },
        { label: 'Beam', value: Math.abs(target) < 1e-6 ? 'level: balanced' : st.right < total ? 'block side is lower' : 'masses side is lower', tone: 'warn' },
      ], done)
      return done ? 1400 : null
    },
    done: () => undefined,
  })
}

/* ---------------- mass and weight on the Earth and the Moon ---------------- */
function springBalance(k: FundamentalsScene, g: THREE.Group, x: number) {
  const TOP = DESK + 9.2
  const stand = k.mesh(new THREE.BoxGeometry(0.25, TOP - DESK + 0.3, 0.25), k.mat(0x2a303c, 0.5, 0.5))
  stand.position.set(x - 1.8, (TOP + DESK) / 2, -0.6)
  const arm = k.mesh(new THREE.BoxGeometry(2.2, 0.2, 0.2), k.mat(0x2a303c, 0.5, 0.5))
  arm.position.set(x - 0.8, TOP, -0.6)
  g.add(stand, arm)
  // the coil spring model has its axis along x: stand it upright
  const springHolder = new THREE.Group()
  springHolder.position.set(x, TOP, -0.6)
  const spring = k.fitTurned(k.models.spring, [0, 0, Math.PI / 2], { height: 2, fallback: () => k.mesh(new THREE.CylinderGeometry(0.4, 0.4, 2, 16, 1, true), k.mat(0x9aa3b2, 0.9, 0.3)) })
  const inner = new THREE.Group()
  inner.add(spring)
  inner.rotation.x = Math.PI // hang down from the arm
  springHolder.add(inner)
  g.add(springHolder)
  const hook = k.mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6), k.mat(0xdfe5ee, 0.9, 0.3))
  const block = blockMesh(k, 0x7c8796, 1.2)
  g.add(hook, block)
  const scale = new CanvasPanel(1.6, 4.6, 256)
  scale.position.set(x + 1.4, TOP - 3.4, -0.4)
  g.add(scale)
  const maxN = 60
  const pxPerN = (scale.H - 80) / maxN
  const setWeight = (W: number) => {
    const stretch = 1 + Math.min(2.2, W / 12)
    inner.scale.y = stretch
    const end = TOP - 2 * stretch
    hook.position.set(x, end - 0.4, -0.6)
    block.position.set(x, end - 0.8 - 0.48, -0.6)
    scale.card()
    for (let n = 0; n <= maxN; n += 10) {
      const yy = 40 + n * pxPerN
      scale.ctx.fillStyle = '#9fb0c8'
      scale.ctx.fillRect(scale.W - 70, yy - 1, 50, 2)
      scale.text(`${n}`, scale.W - 84, yy, 22, '#e6edf7', 'right', 600)
    }
    scale.text('N', scale.W / 2, 22, 22, '#9fb0c8')
    const py = 40 + Math.min(maxN, W) * pxPerN
    scale.ctx.fillStyle = '#ffd166'
    scale.ctx.fillRect(16, py - 3, scale.W - 30, 6)
    scale.flush()
  }
  setWeight(0)
  return { setWeight }
}
function moonBench(k: FundamentalsScene, g: THREE.Group, m: number) {
  const b = beamBalance(k, g, -5)
  b.setLeft(blockMesh(k, 0x7c8796, 1.3))
  const std = brass(k, 300)
  b.addRight(std, 1)
  const tag = k.label(`standard ${fx(m, 1)} kg`, '#ffd166', 0.5)
  tag.position.set(-1.8, DESK + 0.6, 1.6)
  const tag2 = k.label('block', '#e6edf7', 0.5)
  tag2.position.set(-8.2, DESK + 0.6, 1.6)
  g.add(tag, tag2)
  const s = springBalance(k, g, 5.5)
  s.setWeight(m * G_EARTH)
  const sky = new THREE.Group()
  g.add(sky)
  return { b, s, sky }
}
function runMoon(k: FundamentalsScene, m: number): Promise<void> {
  k.abort()
  const g = k.clear(ID)
  const mb = moonBench(k, g, m)
  void homeView(k)
  const place = k.label('EARTH  g = 9.8 N/kg', '#7fd3ff', 0.8)
  place.position.set(0, DESK + 11.4, -3)
  g.add(place)
  const moonFloor = k.mesh(new THREE.CircleGeometry(40, 64).rotateX(-Math.PI / 2), k.mat(0x8a8a8a, 0, 1), false)
  moonFloor.position.y = 0.01
  moonFloor.visible = false
  g.add(moonFloor)
  for (let i = 0; i < 14; i++) {
    const cr = k.mesh(new THREE.RingGeometry(0.8 + (i % 3) * 0.6, 1.3 + (i % 3) * 0.7, 24).rotateX(-Math.PI / 2), k.mat(0x6d6d6d, 0, 1), false)
    cr.position.set(Math.sin(i * 2.3) * 16, 0.02, -6 + Math.cos(i * 1.7) * 8)
    moonFloor.add(cr)
  }
  const earth = k.icon('🌍', 3.6)
  earth.position.set(-9, DESK + 11, -6)
  earth.visible = false
  g.add(earth)
  const st = { t: 0, onMoon: false, W: m * G_EARTH }
  return k.begin({
    update: (dt) => {
      st.t += dt
      if (st.t > 2.6 && !st.onMoon) {
        st.onMoon = true
        sound.whoosh(1)
        k.setBackground(0x020306)
        moonFloor.visible = true
        earth.visible = true
        const fresh = k.label('MOON  g = 1.6 N/kg', '#e6edf7', 0.8)
        place.material.map = fresh.material.map
        place.scale.copy(fresh.scale)
      }
      const target = (st.onMoon ? G_MOON : G_EARTH) * m
      st.W += (target - st.W) * Math.min(1, dt * 2.5)
      mb.s.setWeight(st.W)
      mb.b.setAngle(Math.sin(st.t * 8) * 0.02 * Math.exp(-Math.max(0, st.t - 2.6) * 2) * (st.onMoon ? 1 : 0))
      k.emitGauges(dt, () => [
        { label: 'Place', value: st.onMoon ? 'Moon (g = 1.6 N/kg)' : 'Earth (g = 9.8 N/kg)' },
        { label: 'Beam balance (mass)', value: `balanced at ${fx(m, 1)} kg`, tone: 'info' },
        { label: 'Spring balance (weight)', value: `${fx(st.W, 1)} N`, tone: 'warn' },
      ])
      return st.t > 6.5 ? 1800 : null
    },
    done: () => undefined,
  })
}

/* ---------------- length and volume: a ruler along a cube ---------------- */
const CM = 0.7 // units per centimetre
function cube(k: FundamentalsScene, s: number) {
  const c = k.mesh(new THREE.BoxGeometry(s * CM, s * CM, s * CM), new THREE.MeshPhysicalMaterial({ color: 0x8fd3ff, transparent: true, opacity: 0.28, roughness: 0.1 }))
  c.position.set(0, DESK + (s * CM) / 2, 0)
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(c.geometry), new THREE.LineBasicMaterial({ color: 0x8fd3ff }))
  c.add(edges)
  return c
}
function runRuler(k: FundamentalsScene, s: number): Promise<void> {
  k.abort()
  const g = k.clear(ID)
  const c = cube(k, s)
  g.add(c)
  void k.flyTo(V(2, 8, 12), V(0, DESK + 1, 0), 900)
  // the ruler model is a 30 cm rule: scaled so 1 cm on it is CM units, its zero mark at the cube's left edge
  const LEN = 31.4 * CM
  const rl = k.fit(k.models.ruler, { width: LEN, fallback: () => k.mesh(new THREE.BoxGeometry(LEN, 0.05, 2.8 * CM), k.mat(0xf1e3b1, 0, 0.6)) })
  const zeroX = -(s * CM) / 2
  rl.position.set(zeroX + LEN / 2 - 0.7 * CM, DESK + 0.01, (s * CM) / 2 + 1.1)
  g.add(rl)
  const bracket = k.mesh(new THREE.BoxGeometry(s * CM, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: 0xffd166 }))
  bracket.position.set(0, DESK + 0.1, (s * CM) / 2 + 0.25)
  bracket.visible = false
  const tags = [V(0, DESK + 0.3, (s * CM) / 2 + 2.6), V((s * CM) / 2 + 1.4, DESK + (s * CM) / 2, (s * CM) / 2), V((s * CM) / 2 + 1.4, DESK + 0.3, 0)].map((p) => {
    const t = k.label(`${fx(s, 1)} cm`, '#ffd166', 0.5)
    t.position.copy(p)
    t.visible = false
    g.add(t)
    return t
  })
  g.add(bracket)
  const whole = Math.abs(s - Math.round(s)) < 1e-6
  const n = whole ? Math.round(s) : 0
  const unit = new THREE.BoxGeometry(CM * 0.94, CM * 0.94, CM * 0.94)
  const unitMat = k.mat(0x5ee6ff, 0.1, 0.4, { transparent: true, opacity: 0.85 })
  const units = new THREE.InstancedMesh(unit, unitMat, Math.max(1, n * n * n))
  units.count = 0
  g.add(units)
  const fillMat = new THREE.MeshStandardMaterial({ color: 0x5ee6ff, transparent: true, opacity: 0.55 })
  const fill = k.mesh(new THREE.BoxGeometry(s * CM * 0.98, 1, s * CM * 0.98), fillMat, false)
  fill.geometry.translate(0, 0.5, 0)
  fill.position.set(0, DESK, 0)
  fill.scale.y = 0.001
  fill.visible = !whole
  g.add(fill)
  const mtx = new THREE.Matrix4()
  const st = { t: 0, placed: 0 }
  const V3 = s * s * s
  return k.begin({
    update: (dt) => {
      st.t += dt
      const show = st.t > 1.2
      bracket.visible = show
      tags.forEach((t, i) => (t.visible = st.t > 1.2 + i * 0.5))
      const prog = seg(st.t, 2.8, 6.8)
      if (whole) {
        const want = Math.floor(prog * n * n * n)
        while (st.placed < want) {
          const i = st.placed
          const x = i % n
          const z = Math.floor(i / n) % n
          const y = Math.floor(i / (n * n))
          mtx.makeTranslation(-(s * CM) / 2 + (x + 0.5) * CM, DESK + (y + 0.5) * CM, -(s * CM) / 2 + (z + 0.5) * CM)
          units.setMatrixAt(i, mtx)
          st.placed++
        }
        units.count = st.placed
        units.instanceMatrix.needsUpdate = true
      } else fill.scale.y = Math.max(0.001, prog * s * CM)
      k.emitGauges(dt, () => [
        { label: 'Each edge (ruler)', value: show ? `${fx(s, 1)} cm` : '–', tone: 'info' },
        whole ? { label: '1 cm cubes inside', value: `${st.placed}` } : { label: 'Filling', value: `${fx(prog * 100, 0)} %` },
        { label: 'Volume = side × side × side', value: prog >= 1 ? `${fx(V3, 2)} cm³` : '…', tone: 'warn' },
      ], prog >= 1)
      return st.t > 7.6 ? 1400 : null
    },
    done: () => undefined,
  })
}

/* ---------------- volume by displacement: the graduated cylinder ---------------- */
const CYL_H = 7.5
function gradCylinder(k: FundamentalsScene, g: THREE.Group) {
  const model = k.fit(k.models.cylinder, { height: CYL_H, fallback: () => k.mesh(new THREE.CylinderGeometry(1, 1, CYL_H, 32, 1, true), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 })) })
  // hide the model's own liquid: the level is drawn here so it matches the scale
  let inner = 1
  model.traverse((o) => {
    if (/liquid|fluid/i.test(o.name)) o.visible = false
    if (/glass/i.test(o.name) && (o as THREE.Mesh).isMesh) {
      const b = new THREE.Box3().setFromObject(o)
      inner = Math.min(b.max.x - b.min.x, b.max.z - b.min.z) / 2
    }
  })
  model.position.set(0, DESK, 0)
  g.add(model)
  const r = Math.max(0.3, inner * 0.86)
  const base = DESK + CYL_H * 0.07
  const span = CYL_H * 0.8 // 0 to 100 mL
  const water = k.mesh(new THREE.CylinderGeometry(r, r, 1, 32), new THREE.MeshStandardMaterial({ color: 0x5aa9ff, transparent: true, opacity: 0.6, roughness: 0.1 }), false)
  water.geometry.translate(0, 0.5, 0)
  water.position.set(0, base, 0)
  g.add(water)
  const scale = new CanvasPanel(1.4, span + 0.6, 256)
  scale.position.set(-r - 1.1, base + span / 2, 0)
  scale.card('rgba(8,12,20,0.55)')
  const px = (scale.H - 0.6 * (scale.H / (span + 0.6))) / 100
  const pad = (0.3 * scale.H) / (span + 0.6)
  for (let v = 0; v <= 100; v += 5) {
    const y = scale.H - pad - v * px
    scale.ctx.fillStyle = '#e6edf7'
    scale.ctx.fillRect(scale.W - (v % 10 ? 50 : 90), y - 1.5, v % 10 ? 40 : 80, 3)
    if (v % 10 === 0) scale.text(`${v}`, scale.W - 100, y, 26, '#e6edf7', 'right', 600)
  }
  scale.text('mL', 50, 30, 24, '#9fb0c8')
  scale.flush()
  g.add(scale)
  const setLevel = (mL: number) => (water.scale.y = Math.max(0.001, (mL / 100) * span))
  return { setLevel, r, base, span }
}
function objectFor(k: FundamentalsScene, what: string): THREE.Object3D {
  if (/key/.test(what)) {
    const g = new THREE.Group()
    const gold = k.mat(0xd4af37, 1, 0.25)
    const ring = k.mesh(new THREE.TorusGeometry(0.28, 0.08, 10, 20), gold)
    ring.position.y = 0.55
    const shaft = k.mesh(new THREE.BoxGeometry(0.1, 0.8, 0.08), gold)
    shaft.position.y = -0.1
    const bit = k.mesh(new THREE.BoxGeometry(0.22, 0.12, 0.08), gold)
    bit.position.set(0.12, -0.4, 0)
    g.add(ring, shaft, bit)
    return g
  }
  if (/cube/.test(what)) return k.mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), k.mat(0x9aa3b2, 0.9, 0.3))
  if (/clay/.test(what)) return k.mesh(new THREE.IcosahedronGeometry(0.42, 1), k.mat(0xa0522d, 0, 0.9))
  return k.mesh(new THREE.DodecahedronGeometry(0.42, 0), k.mat(0x6b6f76, 0, 0.95))
}
function runCylinder(k: FundamentalsScene, v1: number, v2: number, what: string): Promise<void> {
  k.abort()
  const g = k.clear(ID)
  const c = gradCylinder(k, g)
  c.setLevel(v1)
  void k.flyTo(V(0, 8, 15), V(0, DESK + 3.4, 0), 900)
  const obj = objectFor(k, what)
  const topY = DESK + CYL_H + 1.5
  obj.position.set(0, topY, 0)
  g.add(obj)
  const thread = k.rope([V(0, topY + 3, 0), V(0, topY + 0.4, 0)], 0.015, 0xe6edf7)
  g.add(thread)
  const bottomY = c.base + 0.45
  const st = { t: 0, splash: false }
  return k.begin({
    update: (dt) => {
      st.t += dt
      const prog = easeInOut(seg(st.t, 0.8, 4.6))
      const y = topY + (bottomY - topY) * prog
      obj.position.y = y
      k.setRope(thread, [V(0, topY + 3, 0), V(0, y + 0.45, 0)])
      // how much of the object is under the water decides how far the level rises
      const level = c.base + (v1 / 100) * c.span
      const sub = Math.max(0, Math.min(1, (level + 0.4 - (y - 0.45)) / 0.9))
      if (sub > 0 && !st.splash) {
        st.splash = true
        sound.plop()
      }
      const mL = v1 + (v2 - v1) * sub
      c.setLevel(mL)
      k.emitGauges(dt, () => [
        { label: 'Water before', value: `${v1} mL`, tone: 'info' },
        { label: 'Water level now', value: `${fx(mL, 0)} mL` },
        { label: 'Rise = volume of the object', value: prog >= 1 ? `${v2 - v1} cm³` : '…', tone: 'warn' },
      ], prog >= 1)
      return st.t > 5.6 ? 1400 : null
    },
    done: () => undefined,
  })
}

/* ---------------- current: a bulb circuit with an ammeter in series ---------------- */
function circuit(k: FundamentalsScene, g: THREE.Group) {
  const batt = new THREE.Group()
  const body = k.mesh(new THREE.CylinderGeometry(0.6, 0.6, 2.4, 24).rotateZ(Math.PI / 2), k.mat(0x1f2430, 0.4, 0.4))
  const band = k.mesh(new THREE.CylinderGeometry(0.61, 0.61, 0.8, 24).rotateZ(Math.PI / 2), k.mat(0xc9a24a, 0.9, 0.3))
  band.position.x = 0.8
  const cap = k.mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.25, 12).rotateZ(Math.PI / 2), k.mat(0x9aa3b2, 0.9, 0.3))
  cap.position.x = 1.3
  batt.add(body, band, cap)
  batt.position.set(-5, DESK + 0.6, 1)
  const plus = k.label('+', '#ff5470', 0.4)
  plus.position.set(-3.5, DESK + 1.3, 1)
  g.add(batt, plus)
  const b = bulb(k, 1.1)
  b.group.position.set(5, DESK, -1)
  g.add(b.group)
  // the multimeter, set to amps: lying on the desk, tilted up so its face can be read
  const meter = k.fitTurned(k.models.multimeter, [-0.9, 0, 0], { width: 2.4, fallback: () => k.mesh(new THREE.BoxGeometry(2.4, 0.4, 3.2), k.mat(0xffb020, 0.2, 0.5)) })
  meter.position.set(0, DESK, 1.6)
  g.add(meter)
  const disp = new CanvasPanel(2.6, 0.9)
  disp.position.set(0, DESK + 3.4, 1.8)
  g.add(disp)
  const al = k.label('ammeter (in series)', '#9fb0c8', 0.5)
  al.position.set(0, DESK - 0.5, 3.6)
  g.add(al)
  const path = [V(-3.7, DESK + 0.6, 1), V(-2.2, DESK + 0.3, 1.8), V(-1.1, DESK + 0.6, 1.8), V(1.1, DESK + 0.6, 1.8), V(3, DESK + 0.3, 0.2), V(4.7, DESK + 0.5, -1), V(5.3, DESK + 0.5, -1), V(6.4, DESK + 0.3, -1), V(6.4, DESK + 0.15, -3), V(-6.6, DESK + 0.15, -3), V(-6.6, DESK + 0.3, 1), V(-6.3, DESK + 0.6, 1)]
  const curve = new THREE.CatmullRomCurve3(path, false, 'catmullrom', 0.1)
  const wire = k.mesh(new THREE.TubeGeometry(curve, 160, 0.06, 6, false), k.mat(0xd7263d, 0.2, 0.6))
  g.add(wire)
  const setI = (I: number) => {
    disp.card('rgba(16,24,16,0.92)')
    disp.text(`${fx(I, 2)} A`, disp.W / 2, disp.H / 2 + 2, Math.round(disp.H * 0.6), '#9dff9d', 'center', 800)
    disp.flush()
  }
  setI(0)
  return { bulb: b, curve, setI }
}
function runAmmeter(k: FundamentalsScene, I: number, t: number): Promise<void> {
  k.abort()
  const g = k.clear(ID)
  const c = circuit(k, g)
  void homeView(k, true)
  const sw = stopwatch(k, 2)
  sw.group.position.set(-10, DESK, 0)
  g.add(sw.group)
  const qm = barMeter(k, 0x5ee6ff, 4.5, 'charge passed')
  qm.group.position.set(10, DESK, 0)
  g.add(qm.group)
  const N = 40
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0x5ee6ff }), N)
  dots.frustumCulled = false
  dots.count = 0
  g.add(dots)
  const mtx = new THREE.Matrix4()
  const A = 6
  const fast = t / A
  const Q = chargeOf(I, t)
  const st = { t: 0, phase: 0 }
  return k.begin({
    update: (dt) => {
      st.t += dt
      const on = st.t > 0.8
      const real = on ? Math.min(t, (st.t - 0.8) * fast) : 0
      c.setI(on ? I : 0)
      c.bulb.glow(on ? Math.min(1, 0.35 + I * 0.5) : 0)
      st.phase += dt * I * 0.25
      if (on) {
        for (let i = 0; i < N; i++) {
          const u = (i / N + st.phase) % 1
          const p = c.curve.getPointAt(u)
          dots.setMatrixAt(i, mtx.makeTranslation(p.x, p.y, p.z))
        }
        dots.count = N
        dots.instanceMatrix.needsUpdate = true
      }
      sw.set(real)
      qm.set(real / t, `${fx(I * real, 1)} C`)
      const done = real >= t
      k.emitGauges(dt, () => [
        { label: 'Ammeter (current)', value: `${fx(on ? I : 0, 2)} A`, tone: 'info' },
        { label: 'Time', value: `${fx(real, 0)} s` },
        { label: 'Charge passed = I × t', value: `${fx(I * real, 1)} C`, tone: 'warn' },
      ], done)
      return done && st.t > 0.8 + A + 0.4 ? 1400 : null
    },
    done: () => {
      void Q
    },
  })
}
