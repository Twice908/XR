/*
 * Pure ray geometry for the optics lab. No three.js, so it can be tested and reasoned about on its own.
 *
 * Coordinates are in metres in the vertical plane that holds the principal axis:
 *   x = distance from the mirror's pole P, positive on the side the light comes from (the object side)
 *   y = height above the principal axis
 * A concave mirror has its focus F and centre of curvature C in front (x > 0); a convex mirror has them behind
 * the mirror (x < 0), where no light actually goes. Rays are drawn "ideally": every reflection point sits on the
 * real mirror surface, but the reflected direction is aimed at the textbook point (F, parallel, or back on itself).
 */

export type MirrorKind = 'concave' | 'convex'

export interface Pt {
  x: number
  y: number
}

export type SegStyle = 'incident' | 'reflected' | 'virtual'

export interface Seg {
  a: Pt
  b: Pt
  style: SegStyle
}

export interface RayPath {
  /** 1 parallel to axis, 2 through F, 3 through C, 4 at the pole. */
  id: 1 | 2 | 3 | 4
  segs: Seg[]
}

export interface ImageInfo {
  /** Position of the image tip. `null` for an image at infinity. */
  tip: Pt | null
  /** Distance of the image from the pole (signed, + in front). `null` at infinity. */
  v: number | null
  real: boolean
  atInfinity: boolean
  /** Lateral magnification (negative = inverted). */
  m: number
}

export interface Diagram {
  rays: RayPath[]
  image: ImageInfo
}

export interface Geometry {
  mirror: MirrorKind
  /** Focal length, a positive number. */
  f: number
  /** Half the mirror's height (its aperture). */
  aperture: number
  /** How far to the right (object side) a diagram may reach. */
  reach: number
}

const EPS = 1e-6
const NEAR = 0.012

export const focalX = (g: Geometry) => (g.mirror === 'concave' ? g.f : -g.f)
export const centreX = (g: Geometry) => 2 * focalX(g)
export const radius = (g: Geometry) => 2 * g.f

/** x of the mirror surface at height y (the cap curves toward the light for a concave mirror, away for a convex). */
export function surfaceX(g: Geometry, y: number): number {
  const R = radius(g)
  const yy = Math.min(Math.abs(y), R * 0.999)
  const sag = R - Math.sqrt(R * R - yy * yy)
  return g.mirror === 'concave' ? sag : -sag
}

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y })
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y })
const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k })
const len = (a: Pt) => Math.hypot(a.x, a.y)
const unit = (a: Pt): Pt => {
  const l = len(a) || 1
  return { x: a.x / l, y: a.y / l }
}

/** Where the image of an object at distance u forms. `u = null` means the object is at infinity. */
export function imageOf(g: Geometry, u: number | null, h: number): ImageInfo {
  const F = focalX(g)
  if (u === null) {
    // Parallel rays from a distant object on the axis meet at F (really for concave, apparently for convex).
    return { tip: { x: F, y: 0 }, v: F, real: g.mirror === 'concave', atInfinity: false, m: 0 }
  }
  if (g.mirror === 'concave' && Math.abs(u - g.f) < 1e-4) return { tip: null, v: null, real: true, atInfinity: true, m: -Infinity }
  const v = 1 / (1 / F - 1 / u)
  const m = -v / u
  return { tip: { x: v, y: m * h }, v, real: v > 0, atInfinity: false, m }
}

/** Mirror-side intersection of the line (p + t·d) with the circle of curvature. */
function circleHit(g: Geometry, p: Pt, d: Pt): Pt | null {
  const C: Pt = { x: centreX(g), y: 0 }
  const R = radius(g)
  const w = sub(p, C)
  const b = w.x * d.x + w.y * d.y
  const c = w.x * w.x + w.y * w.y - R * R
  const disc = b * b - c
  if (disc < 0) return null
  const s = Math.sqrt(disc)
  const hits = [-b - s, -b + s].map((t) => add(p, mul(d, t)))
  // The mirror is the part of the circle nearest the pole: smallest x for concave, largest x for convex.
  return g.mirror === 'concave' ? (hits[0].x < hits[1].x ? hits[0] : hits[1]) : hits[0].x > hits[1].x ? hits[0] : hits[1]
}

/** Draw one reflected ray from H along dir: to the real image if there is one, else a fixed length plus its virtual extension. */
function reflectedFrom(g: Geometry, H: Pt, dir: Pt, image: ImageInfo, id: RayPath['id']): Seg[] {
  const segs: Seg[] = []
  if (image.tip && image.real) {
    // Stop at the image tip, then carry on a little so the crossing is obvious.
    const toTip = sub(image.tip, H)
    const along = toTip.x * dir.x + toTip.y * dir.y
    const end = add(H, mul(dir, Math.max(0.05, along + 0.14)))
    segs.push({ a: H, b: end, style: 'reflected' })
  } else {
    segs.push({ a: H, b: add(H, mul(dir, 0.95)), style: 'reflected' })
    if (image.tip) segs.push({ a: H, b: image.tip, style: 'virtual' })
  }
  void id
  return segs
}

/**
 * Principal-ray diagram for an object tip at distance u and height h from the pole.
 * Rays 1 (parallel to axis) is always drawn; the second and third are chosen among 2 (through F), 3 (through C)
 * and 4 (at the pole), skipping any that degenerate or miss the mirror.
 */
export function diagramFor(g: Geometry, u: number | null, h: number): Diagram {
  const F = focalX(g)
  const C = centreX(g)
  const image = imageOf(g, u, h)
  const rays: RayPath[] = []

  if (u === null) {
    // Object at infinity: two parallel rays, one above and one below the axis.
    for (const [i, y] of [0.07, -0.12].entries()) {
      const H: Pt = { x: surfaceX(g, y), y }
      const incident: Seg = { a: { x: g.reach, y }, b: H, style: 'incident' }
      const toF = sub({ x: F, y: 0 }, H)
      const dir = unit(g.mirror === 'concave' ? toF : mul(toF, -1))
      const reflected: Seg[] = g.mirror === 'concave' ? [{ a: H, b: add(H, mul(dir, len(toF) * 1.55)), style: 'reflected' }] : [{ a: H, b: add(H, mul(dir, 0.85)), style: 'reflected' }, { a: H, b: { x: F, y: 0 }, style: 'virtual' }]
      rays.push({ id: (i === 0 ? 1 : 2) as RayPath['id'], segs: [incident, ...reflected] })
    }
    return { rays, image }
  }

  const T: Pt = { x: u, y: h }
  const atF = g.mirror === 'concave' && Math.abs(u - g.f) < 1e-4

  // Ray 1: parallel to the axis, reflects through F.
  {
    const H: Pt = { x: surfaceX(g, h), y: h }
    // Aim at the image tip (which is F to within the width of the mirror's sag), so the rays meet exactly.
    const dir = image.atInfinity ? unit({ x: u, y: -h }) : unit(image.real ? sub(image.tip as Pt, H) : sub(H, image.tip as Pt))
    rays.push({ id: 1, segs: [{ a: T, b: H, style: 'incident' }, ...reflectedFrom(g, H, dir, image, 1)] })
  }

  const candidates: RayPath[] = []

  // Ray 2: aimed through F, reflects parallel to the axis.
  if (Math.abs(u - F) > NEAR) {
    const y2 = (-F * h) / (u - F)
    if (Math.abs(y2) <= g.aperture && Math.abs(y2) > EPS) {
      const H: Pt = { x: surfaceX(g, y2), y: y2 }
      const segs: Seg[] = [{ a: T, b: H, style: 'incident' }, ...reflectedFrom(g, H, { x: 1, y: 0 }, image, 2)]
      if (g.mirror === 'convex') segs.push({ a: H, b: { x: F, y: 0 }, style: 'virtual' })
      candidates.push({ id: 2, segs })
    }
  }

  // Ray 3: along a radius (through C), so it reflects straight back on itself.
  if (Math.abs(u - C) > NEAR) {
    const dir = unit(sub(T, { x: C, y: 0 }).x < 0 ? sub(T, { x: C, y: 0 }) : sub({ x: C, y: 0 }, T))
    const H = circleHit(g, T, dir)
    if (H && Math.abs(H.y) <= g.aperture) {
      const back = unit(sub(T, H))
      const segs: Seg[] = [{ a: T, b: H, style: 'incident' }]
      // Offset the return path a hair so incident and reflected are both visible on the same line.
      const n = { x: -back.y * 0.004, y: back.x * 0.004 }
      if (image.tip && image.real) segs.push({ a: add(H, n), b: add(image.tip, n), style: 'reflected' })
      else segs.push({ a: add(H, n), b: add(H, add(mul(back, 0.95), n)), style: 'reflected' })
      if (g.mirror === 'convex' && image.tip) segs.push({ a: H, b: image.tip, style: 'virtual' })
      else if (!image.real && image.tip) segs.push({ a: H, b: image.tip, style: 'virtual' })
      candidates.push({ id: 3, segs })
    }
  }

  // Ray 4: at the pole, reflects at the same angle on the other side of the axis.
  {
    const H: Pt = { x: 0, y: 0 }
    const dir = unit({ x: u, y: -h })
    candidates.push({ id: 4, segs: [{ a: T, b: H, style: 'incident' }, ...reflectedFrom(g, H, dir, image, 4)] })
  }

  // Two are enough to place the image; a third (when it exists) confirms it. At F, rays 1 and 4 are the parallel pair.
  const pick = atF ? candidates.filter((r) => r.id !== 2) : candidates
  rays.push(...pick.slice(0, 2))
  return { rays, image }
}

export interface RuleDiagram {
  rays: RayPath[]
  /** Where the labelled hit point is, for a marker. */
  hit: Pt
}

export interface RuleParams {
  /** Centimetres off the axis (rules 1 and 2) or degrees (rules 3 and 4). */
  n: number
  where: 'above' | 'below'
}

const DEFAULT_RULE_PARAMS: Record<1 | 2 | 3 | 4, RuleParams> = {
  1: { n: 10, where: 'above' },
  2: { n: 12, where: 'below' },
  3: { n: 14, where: 'below' },
  4: { n: 12, where: 'above' },
}

/** The four single-ray demonstrations on a concave mirror (rule 1 to 4), placed by this session's numbers. */
export function ruleDiagram(g: Geometry, rule: 1 | 2 | 3 | 4, params: RuleParams = DEFAULT_RULE_PARAMS[rule]): RuleDiagram {
  const F = focalX(g)
  const C = centreX(g)
  const R = radius(g)
  const sign = params.where === 'above' ? 1 : -1
  if (rule === 1) {
    const y = (sign * params.n) / 100
    const H: Pt = { x: surfaceX(g, y), y }
    const toF = sub({ x: F, y: 0 }, H)
    return { hit: H, rays: [{ id: 1, segs: [{ a: { x: g.reach, y }, b: H, style: 'incident' }, { a: H, b: add(H, mul(toF, 1.6)), style: 'reflected' }] }] }
  }
  if (rule === 2) {
    const y = (sign * params.n) / 100
    const H: Pt = { x: surfaceX(g, y), y }
    const d = sub({ x: F, y: 0 }, H)
    const t = (g.reach - H.x) / d.x
    const source = add(H, mul(d, t))
    return { hit: H, rays: [{ id: 2, segs: [{ a: source, b: H, style: 'incident' }, { a: H, b: { x: g.reach, y }, style: 'reflected' }] }] }
  }
  if (rule === 3) {
    const th = (params.n * Math.PI) / 180
    const H: Pt = { x: C - R * Math.cos(th), y: sign * R * Math.sin(th) }
    const source: Pt = { x: C + 0.42 * Math.cos(th), y: -sign * 0.42 * Math.sin(th) }
    const back = unit(sub(source, H))
    const n = { x: -back.y * 0.006, y: back.x * 0.006 }
    return { hit: H, rays: [{ id: 3, segs: [{ a: source, b: H, style: 'incident' }, { a: add(H, n), b: add(source, n), style: 'reflected' }] }] }
  }
  const P: Pt = { x: 0, y: 0 }
  const x0 = 0.9
  const source: Pt = { x: x0, y: sign * x0 * Math.tan((params.n * Math.PI) / 180) }
  return { hit: P, rays: [{ id: 4, segs: [{ a: source, b: P, style: 'incident' }, { a: P, b: { x: source.x, y: -source.y }, style: 'reflected' }] }] }
}

/** Reflection off a flat surface at 45°: a clean mirror image of every incident ray. */
export function reflectDir(d: Pt, n: Pt): Pt {
  const dot = d.x * n.x + d.y * n.y
  return { x: d.x - 2 * dot * n.x, y: d.y - 2 * dot * n.y }
}

/**
 * Textbook description of the image for a candle at u/f times the focal length, used to cross-check the
 * geometry against the lesson table. Mirrors the option ids in the lesson contract.
 */
export function classifyImage(mirror: MirrorKind, uOverF: number | null): { position: string; size: string; nature: string; orientation: string } {
  const g: Geometry = { mirror, f: 1, aperture: 10, reach: 10 }
  const im = imageOf(g, uOverF, 1)
  if (uOverF === null) return { position: mirror === 'concave' ? 'at_f' : 'at_f_behind', size: 'highly_diminished', nature: im.real ? 'real' : 'virtual', orientation: im.real ? 'inverted' : 'erect' }
  if (im.atInfinity) return { position: 'at_infinity', size: 'highly_enlarged', nature: 'real', orientation: 'inverted' }
  const v = im.v as number
  const a = Math.abs(im.m)
  const size = a < 0.95 ? 'diminished' : a <= 1.05 ? 'same_size' : 'enlarged'
  if (im.real) {
    const position = Math.abs(v - 2) < 0.02 ? 'at_c' : v > 2 ? 'beyond_c' : 'between_f_c'
    return { position, size, nature: 'real', orientation: 'inverted' }
  }
  return { position: mirror === 'concave' ? 'behind_mirror' : 'between_p_f_behind', size, nature: 'virtual', orientation: 'erect' }
}
