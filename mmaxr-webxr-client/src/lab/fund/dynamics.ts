import * as THREE from 'three'
import type { FundamentalsScene } from '../fundamentalsScene'
import { CanvasPanel, V, easeInOut, fx, num, seg } from '../fundamentalsScene'
import { fallSpeed, stickVelocity } from '../fundamentalsPhysics'
import { sound } from '../sound'

/*
 * Tab 2, Dynamics & Impulse: an air track with carts (force and momentum), a Newton's cradle, and a drop tower where
 * an egg lands on concrete or on foam with a live force–time graph whose areas (the impulse) are equal.
 */
export const ACTIONS = ['push', 'collide', 'cradle', 'egg']
const ID = 'dynamics_impulse'
const TRACK_Y = 1.3
const HALF = 14
const PURPLE = 0xb07cff
const GREEN = 0x4ade80

export function build(k: FundamentalsScene) {
  void k
}

/* ---------------- the air track and its carts ---------------- */
function airTrack(k: FundamentalsScene, g: THREE.Group) {
  const rail = k.mesh(new THREE.BoxGeometry(HALF * 2 + 1, 0.5, 1.3), k.mat(0x9aa3b2, 0.85, 0.28))
  rail.position.y = TRACK_Y - 0.25
  g.add(rail)
  // air holes
  const holes = new THREE.InstancedMesh(new THREE.CircleGeometry(0.05, 8).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1b1f27 }), 2 * 56)
  let i = 0
  for (let x = -HALF + 0.25; x < HALF; x += 0.5)
    for (const z of [-0.3, 0.3]) holes.setMatrixAt(i++, new THREE.Matrix4().makeTranslation(x, TRACK_Y + 0.005, z))
  holes.count = i
  g.add(holes)
  for (const x of [-HALF + 1.5, HALF - 1.5]) {
    const leg = k.mesh(new THREE.BoxGeometry(0.4, TRACK_Y - 0.5, 0.9), k.mat(0x2a303c, 0.4, 0.6))
    leg.position.set(x, (TRACK_Y - 0.5) / 2, 0)
    g.add(leg)
  }
  for (const x of [-HALF - 0.3, HALF + 0.3]) {
    const stop = k.mesh(new THREE.BoxGeometry(0.4, 1.0, 1.5), k.mat(0xd7263d, 0.2, 0.5))
    stop.position.set(x, TRACK_Y + 0.25, 0)
    g.add(stop)
  }
  // the blower
  const blower = k.mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.2, 20).rotateZ(Math.PI / 2), k.mat(0x2b6cb0, 0.3, 0.5))
  blower.position.set(-HALF - 1.4, 0.6, 0)
  g.add(blower)
}
function cart(k: FundamentalsScene, color: number, m: number, name: string): THREE.Group {
  const c = new THREE.Group()
  const body = k.mesh(new THREE.BoxGeometry(2.2, 0.7, 1.7), k.mat(color, 0.35, 0.4))
  body.position.y = 0.45
  c.add(body)
  // brass slabs: one per kilogram (at least one), so a heavier cart looks heavier
  const slabs = Math.max(1, Math.min(8, Math.round(m)))
  for (let i = 0; i < slabs; i++) {
    const s = k.mesh(new THREE.BoxGeometry(1.5, 0.16, 1.2), k.mat(0xc9a24a, 0.9, 0.3))
    s.position.y = 0.88 + i * 0.18
    c.add(s)
  }
  const tag = k.label(`${name}: ${fx(m, m % 1 ? 1 : 0)} kg`, '#e6edf7', 1)
  tag.position.y = 1.3 + slabs * 0.18 + 0.5
  c.add(tag)
  c.userData.top = 1.3 + slabs * 0.18
  return c
}

export function stage(k: FundamentalsScene, action: string, params: Record<string, unknown>) {
  const g = k.clear(ID)
  if (action === 'push') {
    airTrack(k, g)
    const c = cart(k, 0x2b6cb0, num(params.m, 2), 'cart')
    c.position.set(-HALF + 2.4, TRACK_Y, 0)
    g.add(c)
    void k.flyTo(V(0, 9, 33), V(0, 2.2, 0), 900)
  } else if (action === 'collide') {
    airTrack(k, g)
    const a = cart(k, 0x2b6cb0, num(params.m1, 1), 'A')
    a.position.set(-8, TRACK_Y, 0)
    const b = cart(k, 0xd7263d, num(params.m2, 2), 'B')
    b.position.set(4, TRACK_Y, 0)
    g.add(a, b)
    void k.flyTo(V(0, 9, 33), V(0, 2.2, 0), 900)
  } else if (action === 'cradle') {
    const cr = cradle(k, g)
    cr.pose(0, 0, num(params.n, 1))
    void k.flyTo(V(0, 6.5, 17), V(0, 4.2, 0), 900)
  } else if (action === 'egg') {
    tower(k, g, num(params.h, 1), String(params.surface ?? 'both'))
    void k.flyTo(V(0, 6.5, 24), V(0, 5, 0), 900)
  }
}

export function run(k: FundamentalsScene, action: string, p: Record<string, unknown>): Promise<void> {
  if (action === 'push') return runPush(k, num(p.m, 2), num(p.F, 10), typeof p.m2 === 'number' ? p.m2 : null)
  if (action === 'collide') return runCollide(k, num(p.m1, 1), num(p.v1, 6), num(p.m2, 2), num(p.v2, 0))
  if (action === 'cradle') return runCradle(k, num(p.n, 1))
  return runEgg(k, num(p.h, 1), num(p.m, 0.06), num(p.tc, 0.002), num(p.tf, 0.1), String(p.surface ?? 'both'))
}

/* ---------------- F = m a: a steady push, with ticker dots every 0.25 s ---------------- */
function runPush(k: FundamentalsScene, m: number, F: number, m2: number | null): Promise<void> {
  k.abort()
  const g = k.clear(ID)
  airTrack(k, g)
  void k.flyTo(V(0, 9, 33), V(0, 2.2, 0), 900)
  const runs = m2 ? [m, m2] : [m]
  const T = 2.6 // seconds of push, in real time
  const aMax = F / Math.min(...runs)
  const scale = (2 * HALF - 6) / (0.5 * aMax * T * T) // units per metre so the fastest run just fits
  const startX = -HALF + 2.4
  const dots = new THREE.Group()
  g.add(dots)
  let current = cart(k, 0x2b6cb0, runs[0], 'cart')
  current.position.set(startX, TRACK_Y, 0)
  g.add(current)
  const probe = new THREE.Group()
  const rod = k.mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.6, 10).rotateZ(Math.PI / 2), k.mat(0xdde3ec, 0.9, 0.2))
  rod.position.x = -0.8
  const sensor = k.mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), k.mat(0xffb020, 0.2, 0.5))
  sensor.position.x = -2
  const readout = k.label(`${fx(F, 0)} N`, '#4ade80', 0.9)
  readout.position.set(-2, 1.0, 0)
  probe.add(rod, sensor, readout)
  g.add(probe)
  const force = k.arrow(GREEN, 0.14)
  g.add(force)
  const st = { t: 0, run: 0, lastDot: -1 }
  const results: string[] = []
  return k.begin({
    update: (dt) => {
      st.t += dt
      const mm = runs[st.run]
      const a = F / mm
      const tt = Math.max(0, Math.min(T, st.t - 0.6))
      const x = startX + 0.5 * a * tt * tt * scale
      const v = a * tt
      current.position.x = x
      probe.position.set(x - 1.1, TRACK_Y + 0.45, 0)
      k.point(force, V(x - 3.6, TRACK_Y + 0.45, 0.95), V(1, 0, 0), tt < T && st.t > 0.6 ? 1 + F * 0.06 : 0, 0.5)
      const dotN = Math.floor(tt / 0.25)
      if (st.t > 0.6 && dotN > st.lastDot && tt <= T) {
        st.lastDot = dotN
        const d = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.04, 12), new THREE.MeshBasicMaterial({ color: st.run ? 0xff8c42 : 0x5ee6ff }))
        d.position.set(x, TRACK_Y + 0.02, st.run ? -0.45 : 0.45)
        dots.add(d)
      }
      k.emitGauges(dt, () => [
        { label: 'Mass', value: `${fx(mm, 1)} kg` },
        { label: 'Force', value: `${fx(F, 0)} N`, tone: 'info' },
        { label: 'Time', value: `${fx(tt, 2)} s` },
        { label: 'Velocity', value: `${fx(v, 2)} m/s` },
        { label: 'Acceleration', value: st.t > 0.7 ? `${fx(a, 2)} m/s²` : '–', tone: 'warn' },
        ...results.map((r, i) => ({ label: `Run ${i + 1}`, value: r })),
      ], tt >= T)
      if (st.t > T + 1.4) {
        if (st.run + 1 < runs.length) {
          results.push(`${fx(F / mm, 2)} m/s² with ${fx(mm, 1)} kg`)
          st.run += 1
          st.t = 0
          st.lastDot = -1
          g.remove(current)
          current = cart(k, 0xd7263d, runs[st.run], 'heavier cart')
          current.position.set(startX, TRACK_Y, 0)
          g.add(current)
          return null
        }
        results.push(`${fx(F / mm, 2)} m/s² with ${fx(mm, 1)} kg`)
        k.emitGauges(0, () => [{ label: 'Force (both runs)', value: `${fx(F, 0)} N`, tone: 'info' }, ...results.map((r, i) => ({ label: `Run ${i + 1}`, value: r, tone: 'warn' as const }))], true)
        return 1400
      }
      return null
    },
    done: () => undefined,
  })
}

/* ---------------- momentum: two carts that stick together ---------------- */
function runCollide(k: FundamentalsScene, m1: number, v1: number, m2: number, v2: number): Promise<void> {
  k.abort()
  const g = k.clear(ID)
  airTrack(k, g)
  void k.flyTo(V(0, 9, 33), V(0, 2.2, 0), 900)
  const A = cart(k, 0x2b6cb0, m1, 'A')
  const B = cart(k, 0xd7263d, m2, 'B')
  g.add(A, B)
  const vf = stickVelocity(m1, v1, m2, v2)
  const U = 1.6 // units per metre
  const rel = v1 - v2
  const tc = Math.max(0.8, Math.min(3, 13 / (Math.max(0.1, rel) * U)))
  const xA0 = -9
  const xB0 = xA0 + 2.2 + rel * U * tc
  // shift so the crash happens near the middle of the track
  const xMeet = xA0 + v1 * U * tc
  const shift = -(xMeet + 1.1) * 0.8
  const pA = k.arrow(PURPLE, 0.14)
  const pB = k.arrow(PURPLE, 0.14)
  g.add(pA, pB)
  const tagA = k.label('', '#d4b8ff', 0.9)
  const tagB = k.label('', '#d4b8ff', 0.9)
  const setTag = (s: THREE.Sprite, text: string) => {
    const old = s.material.map
    const fresh = k.label(text, '#d4b8ff', 0.9)
    s.material.map = fresh.material.map
    s.scale.copy(fresh.scale)
    old?.dispose()
  }
  g.add(tagA, tagB)
  const st = { t: 0, stuck: false, flash: 0 }
  const pr = (m: number, v: number) => `p = ${fx(m, 1)} × ${fx(v, 1)} = ${fx(m * v, 1)}`
  let lastText = ''
  return k.begin({
    update: (dt) => {
      st.t += dt
      const t = Math.max(0, st.t - 0.8)
      let xa: number
      let xb: number
      let va = v1
      let vb = v2
      if (t < tc) {
        xa = xA0 + v1 * U * t + shift
        xb = xB0 + v2 * U * t + shift
      } else {
        if (!st.stuck) {
          st.stuck = true
          sound.thud()
        }
        const after = t - tc
        const x0 = xA0 + v1 * U * tc + shift
        xa = Math.max(-HALF + 1.2, Math.min(HALF - 3.4, x0 + vf * U * after))
        xb = xa + 2.2
        va = vb = vf
      }
      A.position.set(xa, TRACK_Y, 0)
      B.position.set(xb, TRACK_Y, 0)
      const y = TRACK_Y + Math.max(A.userData.top, B.userData.top) + 1.4
      if (!st.stuck) {
        k.point(pA, V(xa, y, 0), V(Math.sign(m1 * va) || 1, 0, 0), Math.abs(m1 * va) * 0.35, 0.5)
        k.point(pB, V(xb, y + 0.7, 0), V(Math.sign(m2 * vb) || 1, 0, 0), Math.abs(m2 * vb) * 0.35, 0.5)
        tagA.position.set(xa, y + 0.45, 1)
        tagB.position.set(xb, y + 1.15, 1)
        const text = `${pr(m1, va)}|${pr(m2, vb)}`
        if (text !== lastText) {
          lastText = text
          setTag(tagA, `A: ${pr(m1, va)}`)
          setTag(tagB, `B: ${pr(m2, vb)}`)
        }
      } else {
        const ptot = (m1 + m2) * vf
        k.point(pA, V(xa + 1.1, y, 0), V(Math.sign(ptot) || 1, 0, 0), Math.abs(ptot) * 0.35, 0.5)
        pB.visible = false
        tagB.visible = false
        tagA.position.set(xa + 1.1, y + 0.55, 1)
        const text = Math.abs(ptot) < 1e-6 ? 'A+B: p = 0 (stopped)' : `A+B: p = ${fx(m1 + m2, 1)} × ${fx(vf, 2)} = ${fx(ptot, 1)}`
        if (text !== lastText) {
          lastText = text
          setTag(tagA, text)
        }
      }
      k.emitGauges(dt, () => [
        { label: 'Momentum of A', value: `${fx(m1 * va, 1)} kg·m/s` },
        { label: 'Momentum of B', value: `${fx(st.stuck ? m2 * vf : m2 * vb, 1)} kg·m/s` },
        { label: 'Total momentum', value: `${fx(m1 * v1 + m2 * v2, 1)} kg·m/s`, tone: 'info' },
        { label: st.stuck ? 'Velocity after (stuck)' : 'Velocities', value: st.stuck ? `${fx(vf, 2)} m/s` : `A ${fx(v1, 1)} · B ${fx(v2, 1)} m/s`, tone: 'warn' },
      ], st.stuck)
      return t > tc + 2.6 ? 1400 : null
    },
    done: () => undefined,
  })
}

/* ---------------- Newton's cradle, built here: five chrome balls on V-shaped strings ---------------- */
const PIVOT_Y = 7.2
const STRING = 4.4
const R_BALL = 0.6
function cradle(k: FundamentalsScene, g: THREE.Group) {
  const frameMat = k.mat(0x1f2430, 0.6, 0.35)
  const base = k.mesh(new THREE.BoxGeometry(9, 0.4, 4), k.mat(0x2b1d14, 0.1, 0.6))
  base.position.y = 0.2
  g.add(base)
  for (const x of [-3.9, 3.9])
    for (const z of [-1.5, 1.5]) {
      const post = k.mesh(new THREE.CylinderGeometry(0.1, 0.1, PIVOT_Y - 0.4, 12), frameMat)
      post.position.set(x, 0.4 + (PIVOT_Y - 0.4) / 2, z)
      g.add(post)
    }
  for (const z of [-1.5, 1.5]) {
    const bar = k.mesh(new THREE.CylinderGeometry(0.09, 0.09, 7.8, 12).rotateZ(Math.PI / 2), frameMat)
    bar.position.set(0, PIVOT_Y, z)
    g.add(bar)
  }
  const chrome = k.mat(0xe8ecf2, 1, 0.08)
  const balls: THREE.Mesh[] = []
  const strings: THREE.LineSegments[] = []
  for (let i = 0; i < 5; i++) {
    const b = k.mesh(new THREE.SphereGeometry(R_BALL, 32, 24), chrome)
    balls.push(b)
    const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3))
    const s = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xcfd6e0 }))
    strings.push(s)
    g.add(b, s)
  }
  const restX = (i: number) => (i - 2) * 2 * R_BALL
  /** angles: left group (first n balls) swings out to the left by aL, right group (last n) to the right by aR. */
  const pose = (aL: number, aR: number, n: number) => {
    for (let i = 0; i < 5; i++) {
      const a = i < n ? -aL : i >= 5 - n ? aR : 0
      const px = restX(i)
      const bx = px + STRING * Math.sin(a)
      const by = PIVOT_Y - STRING * Math.cos(a)
      balls[i].position.set(bx, by, 0)
      const arr = strings[i].geometry.attributes.position as THREE.BufferAttribute
      arr.setXYZ(0, px, PIVOT_Y, -1.5)
      arr.setXYZ(1, bx, by + R_BALL * 0.9, 0)
      arr.setXYZ(2, px, PIVOT_Y, 1.5)
      arr.setXYZ(3, bx, by + R_BALL * 0.9, 0)
      arr.needsUpdate = true
    }
  }
  return { pose, balls }
}
function runCradle(k: FundamentalsScene, n: number): Promise<void> {
  k.abort()
  const g = k.clear(ID)
  const cr = cradle(k, g)
  void k.flyTo(V(0, 6.5, 17), V(0, 4.2, 0), 900)
  const A0 = 0.7
  const w = (2 * Math.PI) / 1.7
  const st = { t: 0, last: 1, hits: 0 }
  const out = k.label('', '#ffd166', 0.7)
  out.position.set(0, PIVOT_Y + 1.3, 0)
  out.visible = false
  g.add(out)
  return k.begin({
    update: (dt) => {
      st.t += dt
      if (st.t < 1.2) {
        cr.pose(A0 * easeInOut(seg(st.t, 0.2, 1.1)), 0, n)
      } else {
        const t = st.t - 1.2
        const amp = A0 * Math.exp(-0.05 * t)
        const s = amp * Math.cos(w * t)
        cr.pose(Math.max(s, 0), Math.max(-s, 0), n)
        const sign = Math.sign(s)
        if (sign !== st.last && sign !== 0) {
          st.last = sign
          st.hits += 1
          sound.hit()
          if (st.hits === 1) {
            const fresh = k.label(`${n} in → ${n} out`, '#ffd166', 0.7)
            out.material.map = fresh.material.map
            out.scale.copy(fresh.scale)
            out.visible = true
          }
        }
      }
      k.emitGauges(dt, () => [
        { label: 'Balls pulled back', value: `${n}`, tone: 'info' },
        { label: 'Balls swinging out', value: st.hits ? `${n}` : '–', tone: 'warn' },
        { label: 'Collisions', value: `${st.hits}` },
      ])
      return st.t > 1.2 + 1.7 * 3 ? 1000 : null
    },
    done: () => undefined,
  })
}

/* ---------------- the egg drop ---------------- */
const DROP = 7 // display height of the drop, units
function eggMesh(k: FundamentalsScene): THREE.Mesh {
  const pts: THREE.Vector2[] = []
  for (let i = 0; i <= 24; i++) {
    const t = i / 24
    const y = -1 + 2 * t
    const r = Math.sqrt(Math.max(0, 1 - y * y)) * (1 - 0.18 * y) * 0.72
    pts.push(new THREE.Vector2(r, y))
  }
  const geo = new THREE.LatheGeometry(pts, 32)
  geo.scale(0.42, 0.42, 0.42)
  geo.translate(0, 0.42, 0)
  return k.mesh(geo, k.mat(0xf3e6cf, 0, 0.55))
}
interface Station {
  x: number
  surface: 'concrete' | 'foam'
  top: number
  pad: THREE.Mesh
}
function tower(k: FundamentalsScene, g: THREE.Group, h: number, surface: string) {
  const stations: Station[] = []
  const list: ('concrete' | 'foam')[] = surface === 'foam' ? ['foam'] : ['concrete', 'foam']
  list.forEach((s, i) => {
    const x = list.length === 1 ? 0 : i === 0 ? -5 : 5
    let pad: THREE.Mesh
    let top: number
    if (s === 'concrete') {
      pad = k.mesh(new THREE.BoxGeometry(4, 0.8, 3), k.mat(0x8d8f93, 0, 0.95))
      pad.position.set(x, 0.4, 0)
      top = 0.8
    } else {
      pad = k.mesh(new THREE.BoxGeometry(4, 1.6, 3, 8, 4, 8), k.mat(0xf2c14e, 0, 0.98))
      pad.geometry.translate(0, 0.8, 0)
      pad.position.set(x, 0, 0)
      top = 1.6
    }
    g.add(pad)
    const name = k.label(s === 'concrete' ? 'Concrete' : 'Foam cushion', s === 'concrete' ? '#cfd6e0' : '#ffd166', 1)
    name.position.set(x, 0.5, 2.6)
    g.add(name)
    // the release clamp at the top of a mast, with the ruler beside it
    const mast = k.mesh(new THREE.BoxGeometry(0.25, DROP + 1.6, 0.25), k.mat(0x2a303c, 0.5, 0.5))
    mast.position.set(x - 2.4, (DROP + 1.6) / 2, -1)
    const arm = k.mesh(new THREE.BoxGeometry(2.4, 0.18, 0.18), k.mat(0x2a303c, 0.5, 0.5))
    arm.position.set(x - 1.2, top + DROP + 0.9, -1)
    const claw = k.mesh(new THREE.TorusGeometry(0.42, 0.06, 8, 20, Math.PI * 1.4), k.mat(0x9aa3b2, 0.8, 0.3))
    claw.rotation.x = Math.PI / 2
    claw.position.set(x, top + DROP + 0.75, 0)
    g.add(mast, arm, claw)
    // a metre scale from the landing surface up to the egg, marked every 10 cm
    const stick = new CanvasPanel(0.9, DROP, 128)
    stick.card('rgba(241,227,177,0.95)')
    const steps = Math.round(h * 10)
    for (let i = 0; i <= steps; i++) {
      const yy = stick.H - 6 - (i / steps) * (stick.H - 12)
      stick.ctx.fillStyle = '#2b2b2b'
      stick.ctx.fillRect(0, yy - 2, i % 5 === 0 ? 70 : 40, 4)
      if (i % 5 === 0) stick.text(`${fx(i / 10, 1)}`, 100, yy + (i === 0 ? -14 : i === steps ? 14 : 0), 26, '#2b2b2b', 'center', 700)
    }
    stick.flush()
    stick.position.set(x - 1.7, top + DROP / 2, 0.2)
    g.add(stick)
    const hl = k.label(`${fx(h, 2)} m drop`, '#e6edf7', 0.8)
    hl.position.set(x - 3.6, top + DROP / 2, 0.2)
    g.add(hl)
    stations.push({ x, surface: s, top, pad })
  })
  return stations
}
function drawImpulse(gp: CanvasPanel, curves: { label: string; color: string; F: number; t: number; shown: number }[], tMax: number) {
  gp.card()
  const c = gp.ctx
  const x0 = 90
  const y0 = gp.H - 70
  const w = gp.W - 130
  const h = gp.H - 150
  const peakAll = Math.max(...curves.map((q) => (Math.PI / 2) * q.F), 1e-6)
  c.strokeStyle = 'rgba(255,255,255,0.35)'
  c.lineWidth = 2
  c.beginPath()
  c.moveTo(x0, 50)
  c.lineTo(x0, y0)
  c.lineTo(x0 + w, y0)
  c.stroke()
  gp.text('force (N)', x0 + 6, 32, 22, '#9fb0c8', 'left', 600)
  gp.text('time of impact (s)', x0 + w, y0 + 40, 22, '#9fb0c8', 'right', 600)
  gp.text(fx(tMax, 2), x0 + w, y0 + 16, 18, '#9fb0c8', 'right', 500)
  gp.text('0', x0 - 10, y0, 18, '#9fb0c8', 'right', 500)
  gp.text(fx(peakAll, 0), x0 - 10, y0 - h, 18, '#9fb0c8', 'right', 500)
  curves.forEach((q, qi) => {
    if (q.shown <= 0) return
    const peak = (Math.PI / 2) * q.F
    c.fillStyle = q.color + '55'
    c.strokeStyle = q.color
    c.lineWidth = 4
    c.beginPath()
    c.moveTo(x0, y0)
    const steps = 80
    for (let i = 0; i <= steps; i++) {
      const tt = (i / steps) * q.t * q.shown
      const f = peak * Math.sin((Math.PI * tt) / q.t)
      c.lineTo(x0 + (tt / tMax) * w, y0 - (f / peakAll) * h)
    }
    c.lineTo(x0 + ((q.t * q.shown) / tMax) * w, y0)
    c.closePath()
    c.fill()
    c.stroke()
    if (q.shown >= 1) gp.text(`${q.label}: stopped in ${fx(q.t, 3)} s, average force ${fx(q.F, q.F < 10 ? 2 : 0)} N`, x0 + 30, 90 + qi * 40, 28, q.color, 'left', 700)
  })
  if (curves.length > 1 && curves.every((q) => q.shown >= 1)) gp.text('Same area under both = same impulse = same change in momentum', x0 + w / 2 + 40, y0 - h * 0.3, 24, '#e6edf7', 'center', 600)
  gp.flush()
}
function runEgg(k: FundamentalsScene, h: number, m: number, tc: number, tf: number, surface: string): Promise<void> {
  k.abort()
  const g = k.clear(ID)
  const stations = tower(k, g, h, surface)
  void k.flyTo(V(0, 8, 29), V(0, 6.2, 0), 900)
  const v = fallSpeed(h)
  const p = m * v
  const graph = new CanvasPanel(10, 4.6, 900)
  graph.position.set(0, DROP + 3.6, -2.5)
  g.add(graph)
  k.idle.add(() => graph.quaternion.copy(k.camera.quaternion))
  const curves = stations.map((s) => ({ label: s.surface === 'concrete' ? 'Concrete' : 'Foam', color: s.surface === 'concrete' ? '#ff5470' : '#ffd166', F: p / (s.surface === 'concrete' ? tc : tf), t: s.surface === 'concrete' ? tc : tf, shown: 0 }))
  const tMax = Math.max(tf, tc) * 1.15
  drawImpulse(graph, curves, tMax)
  const eggs = stations.map((s) => {
    const e = eggMesh(k)
    e.position.set(s.x, s.top + DROP, 0)
    g.add(e)
    return e
  })
  const FALL = 1.3 // slow-motion seconds for the fall
  const slow = k.label('slow motion', '#9fb0c8', 0.9)
  slow.position.set(0, 0.6, 3.4)
  g.add(slow)
  const frags: { m: THREE.Mesh; v: THREE.Vector3; w: THREE.Vector3 }[] = []
  const splat: THREE.Mesh[] = []
  const st = { t: 0, idx: 0, phase: 'wait' as 'wait' | 'fall' | 'impact' | 'rest', t0: 0, broke: [] as boolean[] }
  const startAt = (i: number) => 0.8 + i * (FALL + 2.4)
  return k.begin({
    update: (dt) => {
      st.t += dt
      stations.forEach((s, i) => {
        const e = eggs[i]
        const t = st.t - startAt(i)
        if (t < 0) return
        if (t < FALL) {
          const kfall = t / FALL
          e.position.y = s.top + DROP * (1 - kfall * kfall)
          e.rotation.z = kfall * 0.3
          return
        }
        const ti = t - FALL
        if (s.surface === 'concrete') {
          if (!st.broke[i]) {
            st.broke[i] = true
            sound.crack()
            e.visible = false
            // shell pieces
            for (let j = 0; j < 14; j++) {
              const piece = k.mesh(new THREE.SphereGeometry(0.3, 6, 4, Math.random() * 6, 1.1, Math.random() * 2, 1), k.mat(0xf3e6cf, 0, 0.6, { side: THREE.DoubleSide }))
              piece.position.set(s.x, s.top + 0.3, 0)
              g.add(piece)
              const a = Math.random() * Math.PI * 2
              frags.push({ m: piece, v: V(Math.cos(a) * (1.5 + Math.random() * 2.5), 2 + Math.random() * 3, Math.sin(a) * (1.5 + Math.random() * 2)), w: V(Math.random() * 8, Math.random() * 8, Math.random() * 8) })
            }
            const white = k.mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xfaf7ee, transparent: true, opacity: 0.75, roughness: 0.15 }), false)
            white.position.set(s.x, s.top + 0.02, 0)
            const yolk = k.mesh(new THREE.SphereGeometry(0.42, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), k.mat(0xffb020, 0, 0.25), false)
            yolk.position.set(s.x + 0.15, s.top + 0.02, 0.1)
            yolk.scale.set(1, 0.35, 1)
            white.scale.setScalar(0.01)
            yolk.scale.setScalar(0.01)
            g.add(white, yolk)
            splat.push(white, yolk)
          }
          const grow = Math.min(1, ti / 0.5)
          splat[0].scale.setScalar(0.01 + grow * 1.3)
          splat[1].scale.set(0.01 + grow, 0.01 + grow * 0.35, 0.01 + grow)
          curves[i].shown = Math.min(1, ti / 0.4)
        } else {
          // the foam squashes over the (slowed) stopping time, then springs back a little
          const squeeze = Math.min(1, ti / 0.9)
          const depth = 0.55 * Math.sin((Math.PI / 2) * squeeze) - (squeeze >= 1 ? Math.min(0.2, (ti - 0.9) * 0.4) : 0)
          s.pad.scale.y = 1 - depth / s.top
          e.position.y = s.top - depth
          e.rotation.z = 0.3
          if (!st.broke[i]) {
            st.broke[i] = true
            sound.thud()
          }
          curves[i].shown = squeeze
        }
      })
      for (const f of frags) {
        f.v.y -= 9.8 * dt
        f.m.position.addScaledVector(f.v, dt)
        if (f.m.position.y < 0.05 + (stations[0].surface === 'concrete' ? 0.8 : 0)) {
          f.m.position.y = 0.05 + (stations[0].surface === 'concrete' ? 0.8 : 0)
          f.v.multiplyScalar(0.3)
          f.v.y = Math.abs(f.v.y) * 0.2
        }
        f.m.rotation.x += f.w.x * dt
        f.m.rotation.y += f.w.y * dt
      }
      drawImpulse(graph, curves, tMax)
      const now = Math.min(stations.length - 1, Math.max(0, Math.floor((st.t - 0.8) / (FALL + 2.4))))
      const s = stations[now]
      const landed = st.t - startAt(now) > FALL
      k.emitGauges(dt, () => [
        { label: 'Egg mass', value: `${fx(m * 1000, 0)} g` },
        { label: 'Speed at impact', value: `${fx(v, 2)} m/s` },
        { label: 'Momentum at impact', value: `${fx(p, 3)} kg·m/s`, tone: 'info' },
        { label: `${s.surface === 'concrete' ? 'Concrete' : 'Foam'}: stopping time`, value: landed ? `${fx(s.surface === 'concrete' ? tc : tf, 3)} s` : '–' },
        { label: `${s.surface === 'concrete' ? 'Concrete' : 'Foam'}: average force`, value: landed ? `${fx(p / (s.surface === 'concrete' ? tc : tf), 2)} N` : '–', tone: 'warn' },
      ])
      return st.t > startAt(stations.length - 1) + FALL + 2.2 ? 1600 : null
    },
    done: () => undefined,
  })
}
