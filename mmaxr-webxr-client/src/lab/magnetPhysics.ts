/*
 * Pure physics for the magnetism lab: no Three.js, so it can be tested on its own. The scene only draws what these
 * functions say. Magnets are modelled as pairs of magnetic poles: a + pole (North) and a - pole (South).
 */

export type V3 = [number, number, number]
export interface Pole {
  p: V3
  /** +1 for a North pole, -1 for a South pole. */
  q: number
}

/** A bar magnet 4 units long, North at +x. */
export const BAR: Pole[] = [
  { p: [1.8, 0, 0], q: 1 },
  { p: [-1.8, 0, 0], q: -1 },
]
/** A horseshoe magnet: North and South tips side by side, facing +z. */
export const HORSE: Pole[] = [
  { p: [-0.9, 0, 1.4], q: 1 },
  { p: [0.9, 0, 1.4], q: -1 },
]
/** Two bar magnets pushed together with their North poles facing. */
export const TWO_NN: Pole[] = [
  { p: [-0.6, 0, 0], q: 1 },
  { p: [-4.2, 0, 0], q: -1 },
  { p: [0.6, 0, 0], q: 1 },
  { p: [4.2, 0, 0], q: -1 },
]
export const polesFor = (kind: string): Pole[] => (kind === 'horseshoe' ? HORSE : kind === 'two_nn' ? TWO_NN : BAR)

export function fieldAt(poles: Pole[], p: V3): V3 {
  let bx = 0
  let by = 0
  let bz = 0
  for (const { p: c, q } of poles) {
    const dx = p[0] - c[0]
    const dy = p[1] - c[1]
    const dz = p[2] - c[2]
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-9
    const k = q / (r * r * r)
    bx += k * dx
    by += k * dy
    bz += k * dz
  }
  return [bx, by, bz]
}
export const mag = (v: V3) => Math.hypot(v[0], v[1], v[2])

/** Follows a field line from `seed`, forwards (dir = 1) or backwards (-1), until it reaches a pole of the other sign or leaves. */
export function traceLine(poles: Pole[], seed: V3, dir: 1 | -1 = 1, step = 0.12, maxSteps = 900, reach = 9): V3[] {
  const pts: V3[] = [seed]
  let p = seed
  const f = (x: V3): V3 => {
    const b = fieldAt(poles, x)
    const m = mag(b) || 1
    return [(dir * b[0]) / m, (dir * b[1]) / m, (dir * b[2]) / m]
  }
  for (let i = 0; i < maxSteps; i++) {
    const k1 = f(p)
    const k2 = f([p[0] + (step / 2) * k1[0], p[1] + (step / 2) * k1[1], p[2] + (step / 2) * k1[2]])
    const k3 = f([p[0] + (step / 2) * k2[0], p[1] + (step / 2) * k2[1], p[2] + (step / 2) * k2[2]])
    const k4 = f([p[0] + step * k3[0], p[1] + step * k3[1], p[2] + step * k3[2]])
    p = [p[0] + (step / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]), p[1] + (step / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]), p[2] + (step / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2])]
    pts.push(p)
    if (Math.hypot(p[0], p[1], p[2]) > reach) break
    // arrived at a pole that draws the line in
    if (poles.some((c) => c.q * dir < 0 && Math.hypot(p[0] - c.p[0], p[1] - c.p[1], p[2] - c.p[2]) < 0.22)) break
  }
  return pts
}

/** Field lines leaving each North pole in `n` directions spread in the x-z plane (the plane of the table). */
export function fieldLines(poles: Pole[], n = 10, radius = 0.28): V3[][] {
  const lines: V3[][] = []
  for (const north of poles.filter((c) => c.q > 0)) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const seed: V3 = [north.p[0] + radius * Math.cos(a), 0, north.p[2] + radius * Math.sin(a)]
      lines.push(traceLine(poles, seed))
    }
  }
  return lines
}

function segCross(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean {
  const o = (p: [number, number], q: [number, number], r: [number, number]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const d1 = o(c, d, a)
  const d2 = o(c, d, b)
  const d3 = o(a, b, c)
  const d4 = o(a, b, d)
  return d1 * d2 < 0 && d3 * d4 < 0
}

/** How many times lines in the table plane cross each other. Physics says none; the scene counts to prove it. */
export function countCrossings(lines: V3[][], skip = 4): number {
  let n = 0
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++)
      for (let a = 0; a < lines[i].length - 1; a += skip)
        for (let b = 0; b < lines[j].length - 1; b += skip)
          if (segCross([lines[i][a][0], lines[i][a][2]], [lines[i][a + 1][0], lines[i][a + 1][2]], [lines[j][b][0], lines[j][b][2]], [lines[j][b + 1][0], lines[j][b + 1][2]])) n++
  return n
}

// ---- Oersted: a current in a straight wire turns a compass needle ----
/**
 * Sideways turn of the needle's North end, in degrees: positive towards the East, negative towards the West.
 * Wire along North-South above the compass, current flowing North: the needle swings West.
 */
export function oerstedDegrees(o: { current: number; amps: number; placement: string; wire: string; distance: number }): number {
  if (o.wire === 'ew') return 0
  const tan = 0.5 * (o.amps / 3) * (3 / o.distance)
  const mag = (Math.atan(tan) * 180) / Math.PI
  const side = o.placement === 'under' ? -1 : 1 // compass below the wire: West; above it: East
  return side * Math.sign(o.current || 1) * mag
}

// ---- electromagnet ----
/** Paper clips held: 3 for 10 turns and 1 A, in proportion to turns × current; an air core is about a tenth as strong. */
export function clipsHeld(turns: number, current: number, core: string): number {
  return Math.floor(0.3 * turns * current * (core === 'iron' ? 1 : 0.1))
}

// ---- force on a current ----
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
/** Fleming's left-hand rule: the force is along current × field. */
export const flemingForce = (current: V3, field: V3): V3 => cross(current, field)
export const forceNewtons = (B: number, I: number, L: number) => B * I * L

// ---- induction ----
/** How much magnetic flux a magnet's pole puts through the coil, as the pole is x units from its centre. */
export const flux = (x: number, north: boolean) => (north ? 1 : -1) * Math.exp(-((x / 1.6) ** 2))
/** Galvanometer reading (+1 = full scale to the right) for a magnet pole at x, moving at `v` units per second. */
export function galvo(x: number, v: number, north: boolean, turns: number, gain = 0.5): number {
  const dx = 0.01
  const dPhi = (flux(x + dx, north) - flux(x - dx, north)) / (2 * dx)
  return Math.max(-1, Math.min(1, gain * (turns / 40) * dPhi * v))
}
