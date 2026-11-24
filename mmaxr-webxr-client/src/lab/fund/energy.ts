import * as THREE from 'three'
import type { FundamentalsScene } from '../fundamentalsScene'
import { CanvasPanel, V, easeInOut, fx, num, seg } from '../fundamentalsScene'
import { G_EARTH, pendulumEnergy, pendulumStep, releaseAngle } from '../fundamentalsPhysics'
import { sound } from '../sound'
import { barMeter, bulb, crate, stopwatch } from './common'

/*
 * Tab 3, Work, Energy & Power: pushing a crate (work = F × s), holding one still (no work), a big pendulum with live
 * energy bars and an optional generator that lights a bulb, an energy-chain bench, and a motor winch with a stopwatch.
 */
export const ACTIONS = ['work', 'hold', 'pendulum', 'chain', 'motor']
const ID = 'work_energy'
const GREEN = 0x4ade80
const RED = 0xff5470

export function build(k: FundamentalsScene) {
  void k
}

export function stage(k: FundamentalsScene, action: string, params: Record<string, unknown>) {
  const g = k.clear(ID)
  if (action === 'work') {
    floorScene(k, g, num(params.s, 4))
    void k.flyTo(V(0, 7, 24), V(0, 2, 0), 900)
  } else if (action === 'hold') {
    const w = winch(k, 0, 'motor')
    g.add(w.g)
    w.setLoad(2.2)
    void k.flyTo(V(2, 7, 22), V(0, 4.5, 0), 900)
  } else if (action === 'pendulum') {
    const pd = pendulumRig(k, g, num(params.m, 2), params.gen === true)
    pd.pose(0)
    void k.flyTo(V(1.5, 7.5, 27), V(1.5, 6, 0), 900)
  } else if (action === 'chain') {
    chainBench(k, g, String(params.chain ?? 'dam'), false)
    void k.flyTo(V(0, 6, 25), V(0, 3, 0), 900)
  } else if (action === 'motor') {
    const two = typeof params.t2 === 'number'
    for (const [i, x] of (two ? [-4.5, 4.5] : [0]).entries()) {
      const w = winch(k, x, two ? `Motor ${i ? 'B' : 'A'}` : 'motor')
      g.add(w.g)
      w.setLoad(0)
    }
    void k.flyTo(V(0, 7, 26), V(0, 5, 0), 900)
  }
}

export function run(k: FundamentalsScene, action: string, p: Record<string, unknown>): Promise<void> {
  if (action === 'work') return runWork(k, num(p.F, 50), num(p.s, 4))
  if (action === 'hold') return runHold(k, num(p.W, 200), num(p.T, 30))
  if (action === 'pendulum') return runPendulum(k, num(p.m, 2), num(p.h, 0.5), p.gen === true)
  if (action === 'chain') return runChain(k, String(p.chain ?? 'dam'))
  return runMotor(k, num(p.m, 20), num(p.h, 3), num(p.t, 6), typeof p.t2 === 'number' ? p.t2 : null)
}

/* ---------------- work = force × distance ---------------- */
function floorScene(k: FundamentalsScene, g: THREE.Group, s: number) {
  const span = 16
  // a tape measure along the floor, marked in metres from the crate's start (12 units = s metres)
  void span
  const tape = new CanvasPanel(13, 0.9, 1024)
  tape.card('rgba(255,209,102,0.95)')
  const steps = Math.max(1, Math.round(s * 2))
  for (let i = 0; i <= steps; i++) {
    const xx = 40 + (i / steps) * (tape.W - 80)
    tape.ctx.fillStyle = '#2b2b2b'
    tape.ctx.fillRect(xx - 2, 0, 4, i % 2 === 0 ? 34 : 20)
    if (i % 2 === 0) tape.text(`${i / 2} m`, xx, 52, 20, '#2b2b2b', 'center', 700)
  }
  tape.flush()
  tape.rotation.x = -Math.PI / 2
  tape.position.set(-8 + 0.9 + 6, 0.02, 2.0)
  g.add(tape)
  const c = crate(k, 1.8)
  c.position.set(-8 + 0.9, 0, 0)
  g.add(c)
  return c
}
function runWork(k: FundamentalsScene, F: number, s: number): Promise<void> {
  k.abort()
  const g = k.clear(ID)
  const c = floorScene(k, g, s)
  void k.flyTo(V(0, 7, 24), V(0, 2, 0), 900)
  const arrow = k.arrow(GREEN, 0.16)
  g.add(arrow)
  const meter = barMeter(k, 0xffd166, 5, 'work done')
  meter.group.position.set(9.5, 0, 0)
  g.add(meter.group)
  const startX = -8 + 0.9
  const units = 12 / s
  const st = { t: 0 }
  return k.begin({
    update: (dt) => {
      st.t += dt
      const prog = easeInOut(seg(st.t, 0.8, 4.8))
      const x = startX + prog * s * units
      c.position.x = x
      const pushing = st.t > 0.6 && prog < 1
      k.point(arrow, V(x - 3.6, 0.9, 0), V(1, 0, 0), pushing ? 1.4 + Math.min(2.2, F / 80) : 0, 0.6)
      const d = prog * s
      meter.set(d / s, `${fx(F * d, 0)} J`)
      k.emitGauges(dt, () => [
        { label: 'Force', value: `${fx(F, 0)} N`, tone: 'info' },
        { label: 'Distance moved', value: `${fx(d, 2)} m` },
        { label: 'Work done = F × s', value: `${fx(F * d, 0)} J`, tone: 'warn' },
      ], prog >= 1)
      return st.t > 5.6 ? 1300 : null
    },
    done: () => undefined,
  })
}

/* ---------------- a motor winch: a frame, a motor and drum on top, a rope and a crate ---------------- */
const TOP = 10
function winch(k: FundamentalsScene, x: number, name: string) {
  const g = new THREE.Group()
  g.position.x = x
  const steel = k.mat(0x2a303c, 0.6, 0.4)
  for (const sx of [-1.6, 1.6]) {
    const post = k.mesh(new THREE.BoxGeometry(0.3, TOP, 0.3), steel)
    post.position.set(sx, TOP / 2, -0.6)
    g.add(post)
  }
  const beam = k.mesh(new THREE.BoxGeometry(3.8, 0.4, 1.4), steel)
  beam.position.set(0, TOP + 0.2, -0.3)
  const motor = k.mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.5, 24).rotateZ(Math.PI / 2), k.mat(0x2b6cb0, 0.5, 0.4))
  motor.position.set(-1.2, TOP + 1.0, -0.3)
  const drum = k.mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.1, 20).rotateZ(Math.PI / 2), k.mat(0x9aa3b2, 0.9, 0.3))
  drum.position.set(0.3, TOP + 1.0, -0.3)
  const stripe = k.mesh(new THREE.BoxGeometry(1.12, 0.08, 0.66), k.mat(0xffd166, 0.2, 0.5))
  drum.add(stripe)
  const tag = k.label(name, '#e6edf7', 0.6)
  tag.position.set(0, TOP + 2.2, -0.3)
  g.add(beam, motor, drum, tag)
  const box = crate(k, 1.6)
  g.add(box)
  const rope = k.rope([V(0.3, TOP + 0.7, -0.3), V(0.3, 1.6, -0.3)], 0.05)
  g.add(rope)
  const setLoad = (y: number) => {
    box.position.set(0.3, y, -0.3)
    k.setRope(rope, [V(0.3, TOP + 0.7, -0.3), V(0.3, y + 1.6, -0.3)])
  }
  return { g, drum, setLoad, top: TOP }
}
function runHold(k: FundamentalsScene, W: number, T: number): Promise<void> {
  k.abort()
  k.clear(ID)
  const w = winch(k, 0, 'motor (holding)')
  k.stuff[ID].add(w.g)
  w.setLoad(2.2)
  void k.flyTo(V(2, 7, 22), V(0, 4.5, 0), 900)
  const sw = stopwatch(k, 2.6)
  sw.group.position.set(5.5, 1.6, 0.5)
  k.stuff[ID].add(sw.group)
  const meter = barMeter(k, 0xffd166, 5, 'work done')
  meter.group.position.set(-6, 0, 0)
  k.stuff[ID].add(meter.group)
  const up = k.arrow(GREEN, 0.14)
  const down = k.arrow(RED, 0.14)
  k.stuff[ID].add(up, down)
  const height = k.label('height: stays the same', '#9fb0c8', 0.55)
  height.position.set(2.8, 3.2, 0)
  k.stuff[ID].add(height)
  const st = { t: 0 }
  const A = 5
  return k.begin({
    update: (dt) => {
      st.t += dt
      const prog = seg(st.t, 0.6, 0.6 + A)
      const time = prog * T
      sw.set(time)
      k.point(up, V(0.3, 3.9, 1.2), V(0, 1, 0), 2.2, 0.6)
      k.point(down, V(0.3, 2.9, 1.2), V(0, -1, 0), 2.2, 0.6)
      meter.set(0, '0 J')
      k.emitGauges(dt, () => [
        { label: 'Upward force (holding)', value: `${fx(W, 0)} N`, tone: 'info' },
        { label: 'Time held', value: `${fx(time, 0)} s` },
        { label: 'Distance moved', value: '0.00 m' },
        { label: 'Work done = F × s', value: '0 J', tone: 'warn' },
      ], prog >= 1)
      return st.t > A + 1.2 ? 1300 : null
    },
    done: () => undefined,
  })
}
function runMotor(k: FundamentalsScene, m: number, h: number, t1: number, t2: number | null): Promise<void> {
  k.abort()
  k.clear(ID)
  const two = t2 !== null
  const times = two ? [t1, t2!] : [t1]
  const rigs = times.map((_, i) => {
    const w = winch(k, two ? (i ? 4.5 : -4.5) : 0, two ? `Motor ${i ? 'B' : 'A'}` : 'motor')
    k.stuff[ID].add(w.g)
    w.setLoad(0)
    const sw = stopwatch(k, 2)
    sw.group.position.set((two ? (i ? 4.5 : -4.5) : 0) + 2.9, 1.5, 0.6)
    k.stuff[ID].add(sw.group)
    return { w, sw }
  })
  const hl = k.label(`lift ${fx(h, 1)} m`, '#e6edf7', 0.55)
  hl.position.set(two ? 0 : -3, 4, 0)
  k.stuff[ID].add(hl)
  void k.flyTo(V(0, 7, 26), V(0, 5, 0), 900)
  const scale = 6.5 / h // units per metre, so every lift fills the frame
  const tMax = Math.max(...times)
  const fast = tMax > 7 ? tMax / 7 : 1 // speed up long lifts, keeping the stopwatch in real seconds
  const W = m * G_EARTH * h
  const st = { t: 0, rang: [] as boolean[] }
  return k.begin({
    update: (dt) => {
      st.t += dt
      const real = Math.max(0, st.t - 0.8) * fast
      rigs.forEach(({ w, sw }, i) => {
        const T = times[i]
        const prog = Math.min(1, real / T)
        w.setLoad(prog * h * scale)
        w.drum.rotation.x -= prog < 1 ? dt * 6 : 0
        sw.set(Math.min(real, T))
        if (prog >= 1 && !st.rang[i]) {
          st.rang[i] = true
          sound.ring()
        }
      })
      const done = real >= tMax
      k.emitGauges(dt, () => [
        { label: 'Weight lifted', value: `${fx(m * G_EARTH, 0)} N` },
        { label: 'Height', value: `${fx(h, 1)} m` },
        { label: 'Work done = m g h', value: `${fx(W, 0)} J`, tone: 'info' },
        ...times.map((T, i) => ({ label: `${two ? `Motor ${i ? 'B' : 'A'}` : 'Motor'}: time`, value: real >= T ? `${fx(T, 1)} s → ${fx(W / T, 0)} W` : `${fx(real, 1)} s…`, tone: 'warn' as const })),
      ], done)
      return done && real > tMax + 0.8 * fast ? 1400 : null
    },
    done: () => undefined,
  })
}

/* ---------------- the pendulum, its energy bars and the generator ---------------- */
const PIV = 12
const LEN = 8 // display length of the string
const L_REAL = 2 // the physics uses a 2 m pendulum
function pendulumRig(k: FundamentalsScene, g: THREE.Group, m: number, gen: boolean) {
  const steel = k.mat(0x2a303c, 0.6, 0.4)
  for (const x of [-4.5, 4.5]) {
    const post = k.mesh(new THREE.BoxGeometry(0.35, PIV, 0.35), steel)
    post.position.set(x - 2, PIV / 2, -1.2)
    g.add(post)
  }
  const beam = k.mesh(new THREE.BoxGeometry(9.4, 0.4, 0.5), steel)
  beam.position.set(-2, PIV + 0.1, -1.2)
  g.add(beam)
  const hub = k.mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.6, 20).rotateX(Math.PI / 2), k.mat(0x9aa3b2, 0.9, 0.25))
  hub.position.set(-2, PIV, -0.5)
  g.add(hub)
  const arm = new THREE.Group()
  arm.position.set(-2, PIV, 0)
  const rod = k.mesh(new THREE.CylinderGeometry(0.04, 0.04, LEN, 8), k.mat(0xdfe5ee, 0.8, 0.3))
  rod.position.y = -LEN / 2
  const r = 0.55 * Math.cbrt(m / 2) + 0.25
  const bob = k.mesh(new THREE.SphereGeometry(r, 32, 24), k.mat(0xc9a24a, 1, 0.18))
  bob.position.y = -LEN
  arm.add(rod, bob)
  g.add(arm)
  const mtag = k.label(`${fx(m, 1)} kg`, '#e6edf7', 0.5)
  bob.add(mtag)
  mtag.position.set(0, r + 0.5, 0)
  let gen1: { shaft: THREE.Mesh; bulb: ReturnType<typeof bulb> } | null = null
  if (gen) {
    const housing = k.mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.6, 28).rotateX(Math.PI / 2), k.mat(0x6b46c1, 0.4, 0.4))
    housing.position.set(-2, PIV, -2.4)
    const ring = k.mesh(new THREE.TorusGeometry(0.92, 0.08, 8, 28), k.mat(0xc9a24a, 0.9, 0.3))
    ring.position.set(-2, PIV, -1.6)
    const shaft = k.mesh(new THREE.BoxGeometry(1.3, 0.14, 0.14), k.mat(0xffd166, 0.5, 0.4))
    shaft.position.set(-2, PIV, -1.55)
    const gl = k.label('generator', '#d4b8ff', 0.55)
    gl.position.set(-2, PIV + 1.6, -2.4)
    g.add(housing, ring, shaft, gl)
    const b = bulb(k, 1.2)
    b.group.position.set(-8.6, 0, 0)
    g.add(b.group)
    const wire = k.rope([V(-2.8, PIV, -2.4), V(-6.5, PIV - 1, -2.4), V(-8.2, 4, -1.5), V(-8.6, 0.9, 0)], 0.04, 0xd7263d)
    g.add(wire)
    gen1 = { shaft, bulb: b }
  }
  // height marker: the bob's lowest point and its release height
  const base = k.mesh(new THREE.BoxGeometry(2.2, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: 0x9fb0c8 }))
  base.position.set(-2, PIV - LEN, 0.8)
  g.add(base)
  const pose = (theta: number) => {
    arm.rotation.z = theta
  }
  return { arm, bob, pose, gen: gen1 }
}
function runPendulum(k: FundamentalsScene, m: number, h: number, gen: boolean): Promise<void> {
  k.abort()
  const g = k.clear(ID)
  const pd = pendulumRig(k, g, m, gen)
  void k.flyTo(V(1.5, 7.5, 27), V(1.5, 6, 0), 900)
  const th0 = releaseAngle(L_REAL, h)
  const E0 = m * G_EARTH * h
  const hDisp = LEN * (1 - Math.cos(th0))
  const hline = k.mesh(new THREE.BoxGeometry(5, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: 0xffd166 }))
  hline.position.set(-2 - LEN * Math.sin(th0), PIV - LEN + hDisp, 0.8)
  const hl = k.label(`h = ${fx(h, 2)} m`, '#ffd166', 0.5)
  hl.position.set(-2 - LEN * Math.sin(th0) - 3.2, PIV - LEN + hDisp / 2, 0.8)
  g.add(hline, hl)
  hline.visible = hl.visible = false
  const bars = [
    { key: 'pe', name: 'potential', color: 0x4f8cff },
    { key: 'ke', name: 'kinetic', color: GREEN },
    ...(gen ? [{ key: 'el', name: 'electrical → bulb', color: 0xffd166 }] : []),
    { key: 'tot', name: 'total', color: 0xe6edf7 },
  ].map((b, i) => {
    const mtr = barMeter(k, b.color, 6, b.name)
    mtr.group.position.set(5.2 + i * 2.3, 0.6, 0)
    g.add(mtr.group)
    return { ...b, mtr }
  })
  const s = { theta: -th0, omega: 0 }
  const drag = gen ? 0.55 : 0
  const st = { t: 0, released: false, el: 0, lastSign: 0 }
  const T_RUN = gen ? 11 : 9
  return k.begin({
    update: (dt) => {
      st.t += dt
      let pe = 0
      let ke = 0
      if (st.t < 1.2) {
        // pull it back
        pd.pose(-th0 * easeInOut(seg(st.t, 0.2, 1.1)))
        const e = pendulumEnergy(m, L_REAL, -th0 * easeInOut(seg(st.t, 0.2, 1.1)), 0)
        pe = e.pe
        hline.visible = hl.visible = st.t > 1
      } else {
        if (!st.released) {
          st.released = true
          sound.whoosh(0.6)
        }
        const before = pendulumEnergy(m, L_REAL, s.theta, s.omega)
        pendulumStep(s, L_REAL, dt, drag)
        const e = pendulumEnergy(m, L_REAL, s.theta, s.omega)
        pe = e.pe
        ke = e.ke
        if (gen) st.el += Math.max(0, before.pe + before.ke - (e.pe + e.ke))
        pd.pose(s.theta)
        if (pd.gen) {
          pd.gen.shaft.rotation.z = s.theta * 3
          const power = drag * m * Math.pow(L_REAL * s.omega, 2)
          pd.gen.bulb.glow(Math.min(1, power / Math.max(1e-6, E0 * 0.9)))
        }
      }
      const tot = pe + ke + st.el
      for (const b of bars) {
        const val = b.key === 'pe' ? pe : b.key === 'ke' ? ke : b.key === 'el' ? st.el : st.t < 1.2 ? pe : tot
        b.mtr.set(val / Math.max(E0, 1e-6), `${fx(val, 1)} J`)
      }
      k.emitGauges(dt, () => [
        { label: 'Potential energy (m g h)', value: `${fx(pe, 1)} J`, tone: 'info' },
        { label: 'Kinetic energy (½ m v²)', value: `${fx(ke, 1)} J`, tone: 'warn' },
        ...(gen ? [{ label: 'Converted to electrical', value: `${fx(st.el, 1)} J` }] : []),
        { label: 'Speed of the bob', value: `${fx(L_REAL * Math.abs(s.omega), 2)} m/s` },
        { label: 'Total', value: `${fx(tot, 1)} J` },
      ])
      return st.t > T_RUN ? 1400 : null
    },
    done: () => {
      pd.gen?.bulb.glow(0)
    },
  })
}

/* ---------------- the energy-chain bench ---------------- */
const FORM_COLOR: Record<string, number> = { potential: 0x4f8cff, kinetic: 0x4ade80, electrical: 0xffd166, light: 0xfff3b0, heat: 0xff5470, sound: 0xb07cff, chemical: 0x34d399, elastic: 0xf472b6, nuclear: 0xa3e635 }
const CHAINS: Record<string, [string, string, string][]> = {
  dam: [['🏞️', 'Water held high behind the dam', 'potential'], ['🌊', 'Water rushing down', 'kinetic'], ['⚙️', 'Turbine and generator', 'electrical'], ['🏠', 'Homes light up', 'light']],
  torch: [['🔋', 'Battery', 'chemical'], ['〰️', 'Wires', 'electrical'], ['💡', 'Bulb', 'light']],
  solar: [['☀️', 'Sunlight', 'light'], ['🔲', 'Solar panel', 'electrical'], ['🌀', 'Electric fan', 'kinetic']],
  speaker: [['🎵', 'Music player', 'electrical'], ['🔈', 'Loudspeaker cone', 'kinetic'], ['👂', 'Your ear', 'sound']],
  bow: [['💪', "Archer's muscles", 'chemical'], ['🏹', 'Drawn bow', 'elastic'], ['➶', 'Flying arrow', 'kinetic']],
  kettle: [['🔌', 'Socket', 'electrical'], ['♨️', 'Kettle element', 'heat'], ['☕', 'Boiling water', 'heat']],
  car: [['⛽', 'Petrol', 'chemical'], ['🔥', 'Engine', 'heat'], ['🚗', 'Moving car', 'kinetic']],
  plant: [['☀️', 'Sunlight', 'light'], ['🍃', 'Leaf', 'chemical'], ['🌱', 'Sugar in the plant', 'chemical']],
  brakes: [['🚲', 'Moving bicycle', 'kinetic'], ['🛑', 'Brake pads squeeze', 'kinetic'], ['🔥', 'Hot brake rim', 'heat']],
  mic: [['🗣️', 'Your voice', 'sound'], ['🎤', 'Microphone', 'electrical'], ['📼', 'Recorder', 'electrical']],
}
function chainBench(k: FundamentalsScene, g: THREE.Group, key: string, withForms: boolean) {
  const steps = CHAINS[key] ?? CHAINS.dam
  const gap = Math.min(7.5, 26 / Math.max(1, steps.length - 1))
  const x0 = (-(steps.length - 1) * gap) / 2
  const stations = steps.map(([emoji, name, form], i) => {
    const x = x0 + i * gap
    const ped = k.mesh(new THREE.CylinderGeometry(1.5, 1.8, 1.2, 36), k.mat(0x1d2330, 0.4, 0.45))
    ped.position.set(x, 0.6, 0)
    const ringMat = new THREE.MeshBasicMaterial({ color: FORM_COLOR[form] ?? 0xffffff, transparent: true, opacity: 0 })
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.65, 0.09, 8, 48).rotateX(Math.PI / 2), ringMat)
    ring.position.set(x, 1.22, 0)
    const ic = k.icon(emoji, 2.6)
    ic.position.set(x, 2.8, 0)
    const nm = k.label(name, '#e6edf7', 0.55)
    nm.position.set(x, 4.6, 0)
    const fm = k.label(`${form} energy`, '#' + new THREE.Color(FORM_COLOR[form] ?? 0xffffff).getHexString(), 0.6)
    fm.position.set(x, -0.25, 2.2)
    fm.visible = withForms
    g.add(ped, ring, ic, nm, fm)
    return { x, form, ring, ringMat, fm, ic }
  })
  return stations
}
function runChain(k: FundamentalsScene, key: string): Promise<void> {
  k.abort()
  const g = k.clear(ID)
  const stations = chainBench(k, g, key, false)
  void k.flyTo(V(0, 6, 25), V(0, 3, 0), 900)
  // particles that flow from one station to the next, taking the colour of the energy as it changes
  const N = 90
  const geo = new THREE.SphereGeometry(0.13, 8, 6)
  const dots = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), N)
  dots.frustumCulled = false
  dots.count = 0
  g.add(dots)
  const heat = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff5470, transparent: true, opacity: 0.7 }), 40)
  heat.count = 0
  heat.frustumCulled = false
  g.add(heat)
  const seeds = Array.from({ length: N }, () => Math.random())
  const hs = Array.from({ length: 40 }, () => [Math.random(), Math.random(), Math.random()])
  const mtx = new THREE.Matrix4()
  const col = new THREE.Color()
  const per = 2.2 // seconds per link
  const st = { t: 0, lit: -1 }
  const waste = k.label('some energy is always wasted as heat', '#ff8a9e', 0.55)
  waste.position.set(0, 6.2, 0)
  waste.visible = false
  g.add(waste)
  const total = 0.8 + stations.length * per + 1.2
  return k.begin({
    update: (dt) => {
      st.t += dt
      const t = st.t - 0.8
      const reached = Math.min(stations.length - 1, Math.floor(t / per))
      for (let i = 0; i <= reached && t >= 0; i++) {
        const s = stations[i]
        if (i > st.lit) {
          st.lit = i
          sound.click()
        }
        s.ringMat.opacity = 0.9
        s.fm.visible = true
        s.ic.scale.setScalar(2.6 + 0.25 * Math.sin(st.t * 5 + i))
      }
      // particles along links 0..reached-1 and the one being filled
      let n = 0
      for (let l = 0; l < stations.length - 1 && t >= 0; l++) {
        const linkStart = l * per
        if (t < linkStart) break
        const a = stations[l]
        const b = stations[l + 1]
        for (let j = 0; j < N / (stations.length - 1) && n < N; j++) {
          const u = (seeds[n] + (t - linkStart) * 0.45) % 1
          const shown = Math.min(1, (t - linkStart) / per)
          if (u > shown && t - linkStart < per) continue
          const x = a.x + 1.7 + (b.x - a.x - 3.4) * u
          const y = 1.8 + Math.sin(u * Math.PI) * 1.4 + Math.sin(seeds[n] * 40 + st.t * 3) * 0.12
          const z = (seeds[(n + 7) % N] - 0.5) * 0.8
          mtx.makeTranslation(x, y, z)
          dots.setMatrixAt(n, mtx)
          col.setHex(FORM_COLOR[u < 0.5 ? a.form : b.form] ?? 0xffffff)
          dots.setColorAt(n, col)
          n++
        }
      }
      dots.count = n
      dots.instanceMatrix.needsUpdate = true
      if (dots.instanceColor) dots.instanceColor.needsUpdate = true
      // waste heat rising from every station that is working
      let hn = 0
      if (reached >= 1)
        for (const [a, b, c] of hs) {
          const i = 1 + Math.floor(a * reached)
          const s = stations[Math.min(i, stations.length - 1)]
          const u = (b + st.t * 0.35) % 1
          mtx.makeTranslation(s.x + (c - 0.5) * 1.6, 1.4 + u * 4, (a - 0.5) * 1.2)
          heat.setMatrixAt(hn++, mtx)
        }
      heat.count = hn
      heat.instanceMatrix.needsUpdate = true
      waste.visible = reached >= stations.length - 1
      k.emitGauges(dt, () => stations.slice(0, Math.max(0, reached + 1)).map((s, i) => ({ label: `Step ${i + 1}`, value: `${s.form} energy`, tone: i === reached ? ('warn' as const) : undefined })))
      return st.t > total ? 1600 : null
    },
    done: () => undefined,
  })
}
