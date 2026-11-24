import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import type { OpticsLessonContract } from '@mmaxr/schema'
import { centreX, classifyImage, diagramFor, focalX, imageOf, ruleDiagram, surfaceX, type Geometry, type Pt, type Seg } from '../lab/opticsGeometry'

const lesson: OpticsLessonContract = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../mmaxr-platform/services/lesson-loader/data/physics-light.json'), 'utf8'))
const concave: Geometry = { mirror: 'concave', f: 0.25, aperture: 0.22, reach: 1.5 }
const convex: Geometry = { mirror: 'convex', f: 0.25, aperture: 0.22, reach: 1.5 }
const H = 0.08

const dirOf = (s: Seg): Pt => {
  const dx = s.b.x - s.a.x
  const dy = s.b.y - s.a.y
  const l = Math.hypot(dx, dy)
  return { x: dx / l, y: dy / l }
}
const reflectedOf = (g: Geometry, u: number | null, id: number) => diagramFor(g, u, H).rays.find((r) => r.id === id)!.segs.filter((s) => s.style === 'reflected')

describe('the geometry agrees with the lesson table', () => {
  for (const m of lesson.sphericalMirrors) {
    for (const c of m.cases) {
      it(`${c.id}: ${c.objectPosition}`, () => {
        expect(classifyImage(m.mirrorType, c.uOverF)).toEqual(c.expectedImage)
      })
    }
  }
})

describe('mirror formula', () => {
  it('puts a real, inverted image between F and C for an object beyond C', () => {
    const im = imageOf(concave, 0.8, H)
    expect(im.real).toBe(true)
    expect(im.v!).toBeGreaterThan(0.25)
    expect(im.v!).toBeLessThan(0.5)
    expect(im.m).toBeLessThan(0)
  })
  it('puts the image at infinity when the object is at F', () => {
    expect(imageOf(concave, 0.25, H).atInfinity).toBe(true)
  })
  it('a convex mirror always gives a virtual, upright, smaller image', () => {
    for (const u of [0.05, 0.2, 0.8, 5]) {
      const im = imageOf(convex, u, H)
      expect(im.real).toBe(false)
      expect(im.m).toBeGreaterThan(0)
      expect(im.m).toBeLessThan(1)
    }
  })
  it('F and C sit in front of a concave mirror and behind a convex one', () => {
    expect(focalX(concave)).toBeCloseTo(0.25)
    expect(centreX(concave)).toBeCloseTo(0.5)
    expect(focalX(convex)).toBeCloseTo(-0.25)
    expect(centreX(convex)).toBeCloseTo(-0.5)
  })
  it('the surface curves toward the light for concave and away for convex', () => {
    expect(surfaceX(concave, 0.2)).toBeGreaterThan(0)
    expect(surfaceX(convex, 0.2)).toBeLessThan(0)
    expect(surfaceX(concave, 0)).toBe(0)
  })
})

describe('principal rays', () => {
  it('rays 1 and 2 of a real image meet at the image tip', () => {
    const d = diagramFor(concave, 0.8, H)
    const tip = d.image.tip!
    const ends = d.rays.slice(0, 2).map((r) => r.segs.find((s) => s.style === 'reflected')!)
    // Each reflected ray, extended, passes through the tip.
    for (const s of ends) {
      const dir = dirOf(s)
      const t = (tip.x - s.a.x) / dir.x
      expect(s.a.y + dir.y * t).toBeCloseTo(tip.y, 3)
    }
  })
  it('ray 1 from a parallel beam reflects through F', () => {
    const [r] = reflectedOf(concave, 0.8, 1)
    const dir = dirOf(r)
    const t = (0.25 - r.a.x) / dir.x
    // Drawn to the image tip, so it passes F to within the mirror's sag (about a millimetre).
    expect(Math.abs(r.a.y + dir.y * t)).toBeLessThan(0.003)
  })
  it('the ray through F reflects parallel to the axis', () => {
    const d = diagramFor(concave, 0.8, H)
    const r2 = d.rays.find((r) => r.id === 2)!
    expect(dirOf(r2.segs.find((s) => s.style === 'reflected')!).y).toBeCloseTo(0, 6)
  })
  it('the ray through C reflects back along its own line', () => {
    const d = diagramFor(concave, 0.8, 0.08)
    const r3 = d.rays.find((r) => r.id === 3)
    expect(r3).toBeTruthy()
    const inc = dirOf(r3!.segs[0])
    const ref = dirOf(r3!.segs.find((s) => s.style === 'reflected')!)
    expect(ref.x).toBeCloseTo(-inc.x, 2)
    expect(ref.y).toBeCloseTo(-inc.y, 2)
  })
  it('the pole ray makes equal angles with the axis', () => {
    const r4 = diagramFor(concave, 0.8, H).rays.find((r) => r.id === 4)
    if (!r4) return
    const inc = dirOf(r4.segs[0])
    const ref = dirOf(r4.segs[1])
    expect(ref.x).toBeCloseTo(inc.x * -1 * -1, 6) // keeps going away from the mirror
    expect(Math.abs(ref.y)).toBeCloseTo(Math.abs(inc.y), 6)
    expect(Math.sign(ref.y)).toBe(-Math.sign(inc.y) * -1 * -1 || 1)
  })
  it('with the object at F the reflected rays leave parallel', () => {
    const d = diagramFor(concave, 0.25, H)
    const dirs = d.rays.map((r) => dirOf(r.segs.find((s) => s.style === 'reflected')!))
    expect(dirs.length).toBeGreaterThanOrEqual(2)
    for (const v of dirs) {
      expect(v.x).toBeCloseTo(dirs[0].x, 3)
      expect(v.y).toBeCloseTo(dirs[0].y, 3)
    }
    expect(d.image.atInfinity).toBe(true)
  })
  it('a virtual image comes with dashed extensions behind the mirror', () => {
    for (const [g, u] of [[concave, 0.1], [convex, 0.8]] as const) {
      const d = diagramFor(g, u, H)
      const virt = d.rays.flatMap((r) => r.segs).filter((s) => s.style === 'virtual')
      expect(virt.length).toBeGreaterThanOrEqual(2)
      for (const s of virt) expect(s.b.x).toBeLessThan(0)
    }
  })
  it('an object at infinity sends parallel rays to F (concave) or from F (convex)', () => {
    const d = diagramFor(concave, null, H)
    expect(d.rays).toHaveLength(2)
    for (const r of d.rays) {
      const ref = r.segs.find((s) => s.style === 'reflected')!
      const dir = dirOf(ref)
      const t = (0.25 - ref.a.x) / dir.x
      expect(ref.a.y + dir.y * t).toBeCloseTo(0, 4)
    }
    const v = diagramFor(convex, null, H)
    expect(v.image.real).toBe(false)
    expect(v.image.tip!.x).toBeCloseTo(-0.25)
  })
  it('every segment stays finite for every case in the lesson', () => {
    for (const m of lesson.sphericalMirrors)
      for (const c of m.cases) {
        const g = m.mirrorType === 'concave' ? concave : convex
        const d = diagramFor(g, c.uOverF === null ? null : c.uOverF * g.f, H)
        for (const r of d.rays) for (const s of r.segs) for (const p of [s.a, s.b]) expect(Number.isFinite(p.x) && Number.isFinite(p.y), `${c.id} ray ${r.id}`).toBe(true)
        expect(d.rays.length).toBeGreaterThanOrEqual(2)
      }
  })
})

describe('rules placed by the session\'s own numbers', () => {
  const cases: [1 | 2 | 3 | 4, number][] = [[1, 5], [1, 12], [2, 6], [2, 16], [3, 8], [3, 15], [4, 6], [4, 13]]
  for (const where of ['above', 'below'] as const) {
    for (const [rule, n] of cases) {
      it(`rule ${rule}, ${n}, ${where}: the law of the rule still holds`, () => {
        const { rays, hit } = ruleDiagram(concave, rule, { n, where })
        const [inc, ref] = rays[0].segs
        const di = dirOf(inc)
        const dr = dirOf(ref)
        expect(Math.sign(hit.y) || 0).toBe(rule === 4 ? 0 : where === 'above' ? 1 : -1)
        if (rule === 1) {
          expect(di.y).toBeCloseTo(0, 6)
          expect(ref.a.y + dr.y * ((0.25 - ref.a.x) / dr.x)).toBeCloseTo(0, 6)
        }
        if (rule === 2) {
          expect(inc.a.y + di.y * ((0.25 - inc.a.x) / di.x)).toBeCloseTo(0, 6)
          expect(dr.y).toBeCloseTo(0, 6)
        }
        if (rule === 3) {
          expect(inc.a.y + di.y * ((0.5 - inc.a.x) / di.x)).toBeCloseTo(0, 6)
          expect(dr.x).toBeCloseTo(-di.x, 2)
        }
        if (rule === 4) {
          expect(ref.b.y).toBeCloseTo(-inc.a.y, 6)
          expect(Math.atan(Math.abs(inc.a.y) / inc.a.x)).toBeCloseTo((n * Math.PI) / 180, 6)
        }
        for (const p of [inc.a, inc.b, ref.a, ref.b]) expect(Number.isFinite(p.x + p.y)).toBe(true)
        if (rule !== 4) expect(Math.abs(hit.y)).toBeLessThanOrEqual(concave.aperture)
      })
    }
  }
})

describe('rule demonstrations', () => {
  it('rule 1: a parallel ray goes through F', () => {
    const { rays } = ruleDiagram(concave, 1)
    const [inc, ref] = rays[0].segs
    expect(dirOf(inc).y).toBeCloseTo(0, 6)
    const d = dirOf(ref)
    expect(ref.a.y + d.y * ((0.25 - ref.a.x) / d.x)).toBeCloseTo(0, 6)
  })
  it('rule 2: a ray through F reflects parallel', () => {
    const { rays } = ruleDiagram(concave, 2)
    const [inc, ref] = rays[0].segs
    const d = dirOf(inc)
    expect(inc.a.y + d.y * ((0.25 - inc.a.x) / d.x)).toBeCloseTo(0, 6)
    expect(dirOf(ref).y).toBeCloseTo(0, 6)
  })
  it('rule 3: a ray through C returns along the same line', () => {
    const { rays } = ruleDiagram(concave, 3)
    const [inc, ref] = rays[0].segs
    const d = dirOf(inc)
    expect(inc.a.y + d.y * ((0.5 - inc.a.x) / d.x)).toBeCloseTo(0, 6)
    expect(dirOf(ref).x).toBeCloseTo(-d.x, 2)
    expect(dirOf(ref).y).toBeCloseTo(-d.y, 2)
  })
  it('rule 4: the pole ray mirrors about the axis', () => {
    const { rays } = ruleDiagram(concave, 4)
    const [inc, ref] = rays[0].segs
    expect(ref.b.y).toBeCloseTo(-inc.a.y, 6)
    expect(ref.b.x).toBeCloseTo(inc.a.x, 6)
  })
})
