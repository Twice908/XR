/**
 * Celebration particles for card reveals: confetti that flutters in 3D, sparks with light trails, and twinkling
 * stars, drawn on one full-screen canvas that only runs while something is flying. Nothing here runs under
 * reduced motion: callers skip it.
 */

type Kind = 'confetti' | 'spark' | 'star'

interface Particle {
  kind: Kind
  x: number
  y: number
  vx: number
  vy: number
  /** Seconds lived and seconds to live. */
  age: number
  life: number
  size: number
  color: string
  spin: number
  spinV: number
  /** Confetti flutter phase: drawing scales one axis by cos(flip) so it looks like it turns in 3D. */
  flip: number
  flipV: number
  gravity: number
  drag: number
  px: number
  py: number
}

export interface BurstOptions {
  colors: string[]
  /** Roughly how many pieces. */
  count: number
  /** Launch speed in px/s. */
  power: number
  /** Share of sparks and stars; the rest is confetti. 0..1 */
  sparkle?: number
  /** Bias upward like a fountain (0 = round burst, 1 = mostly up). */
  lift?: number
}

const TAU = Math.PI * 2
const rand = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]

export class Splash {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private parts: Particle[] = []
  private frame = 0
  private last = 0
  private dpr = 1

  constructor(host: HTMLElement = document.body) {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'mx-splash'
    this.canvas.setAttribute('aria-hidden', 'true')
    host.append(this.canvas)
    this.ctx = this.canvas.getContext('2d')!
    this.resize()
    window.addEventListener('resize', this.resize)
  }

  private resize = () => {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.canvas.width = Math.round(window.innerWidth * this.dpr)
    this.canvas.height = Math.round(window.innerHeight * this.dpr)
  }

  /** A burst from a point in viewport coordinates. */
  burst(x: number, y: number, o: BurstOptions) {
    const sparkle = o.sparkle ?? 0.35
    const lift = o.lift ?? 0.25
    for (let i = 0; i < o.count; i++) {
      const r = Math.random()
      const kind: Kind = r < sparkle * 0.7 ? 'spark' : r < sparkle ? 'star' : 'confetti'
      const a = rand(0, TAU)
      const speed = o.power * rand(0.35, 1) * (kind === 'spark' ? 1.25 : 1)
      this.parts.push(
        this.make(kind, x + rand(-10, 10), y + rand(-10, 10), Math.cos(a) * speed, Math.sin(a) * speed - o.power * lift * rand(0.4, 1), pick(o.colors)),
      )
    }
    this.start()
  }

  /** Confetti falling from the top edge for a while. */
  rain(colors: string[], count = 120, seconds = 2.2) {
    const w = window.innerWidth
    for (let i = 0; i < count; i++) {
      const p = this.make('confetti', rand(0, w), rand(-200, -10), rand(-40, 40), rand(60, 220), pick(colors))
      p.age = -rand(0, seconds)
      p.life = 4.2
      p.gravity = 260
      p.drag = 1.4
      this.parts.push(p)
    }
    this.start()
  }

  private make(kind: Kind, x: number, y: number, vx: number, vy: number, color: string): Particle {
    return {
      kind,
      x,
      y,
      vx,
      vy,
      px: x,
      py: y,
      age: 0,
      life: kind === 'spark' ? rand(0.5, 0.9) : kind === 'star' ? rand(0.9, 1.6) : rand(1.6, 2.6),
      size: kind === 'confetti' ? rand(6, 12) : kind === 'star' ? rand(5, 10) : rand(1.5, 3),
      color,
      spin: rand(0, TAU),
      spinV: rand(-8, 8),
      flip: rand(0, TAU),
      flipV: rand(6, 14),
      gravity: kind === 'spark' ? 420 : kind === 'star' ? 120 : 520,
      drag: kind === 'spark' ? 2.2 : kind === 'star' ? 2.8 : 2.4,
    }
  }

  private start() {
    if (this.frame) return
    this.last = performance.now()
    this.frame = requestAnimationFrame(this.tick)
  }

  private tick = (now: number) => {
    const dt = Math.min((now - this.last) / 1000, 1 / 20)
    this.last = now
    const { ctx, dpr } = this
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const h = window.innerHeight + 40
    let alive = 0
    for (const p of this.parts) {
      p.age += dt
      if (p.age < 0) {
        alive++
        continue
      }
      if (p.age > p.life || p.y > h) continue
      alive++
      p.px = p.x
      p.py = p.y
      const k = Math.exp(-p.drag * dt)
      p.vx *= k
      p.vy = p.vy * k + p.gravity * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.spin += p.spinV * dt
      p.flip += p.flipV * dt
      const t = p.age / p.life
      const fade = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25
      this.draw(p, fade)
    }
    if (alive === 0) {
      this.parts = []
      this.frame = 0
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
      return
    }
    if (this.parts.length > alive * 2 + 50) this.parts = this.parts.filter((p) => p.age < 0 || (p.age <= p.life && p.y <= h))
    this.frame = requestAnimationFrame(this.tick)
  }

  private draw(p: Particle, alpha: number) {
    const { ctx } = this
    ctx.globalAlpha = alpha
    if (p.kind === 'confetti') {
      ctx.globalCompositeOperation = 'source-over'
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.spin)
      const turn = Math.cos(p.flip)
      ctx.scale(1, turn)
      // The back of the paper is dimmer, so the turn reads as 3D.
      ctx.fillStyle = p.color
      if (turn < 0) ctx.globalAlpha = alpha * 0.55
      ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6)
      ctx.restore()
      return
    }
    ctx.globalCompositeOperation = 'lighter'
    if (p.kind === 'spark') {
      ctx.strokeStyle = p.color
      ctx.lineWidth = p.size
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(p.px - p.vx * 0.03, p.py - p.vy * 0.03)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
      return
    }
    // star: a four-point twinkle
    const s = p.size * (0.7 + 0.3 * Math.sin(p.age * 18))
    ctx.fillStyle = p.color
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate(p.spin * 0.2)
    ctx.beginPath()
    for (let i = 0; i < 8; i++) {
      const r = i % 2 === 0 ? s : s * 0.22
      const a = (i / 8) * TAU
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    }
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  destroy() {
    cancelAnimationFrame(this.frame)
    window.removeEventListener('resize', this.resize)
    this.canvas.remove()
  }
}

/** Confetti colours per rarity: the rarity colour leads, with white and a warm or cool accent. */
export const SPLASH_COLORS = {
  common: ['#c9d2e6', '#ffffff', '#8fd3ff'],
  rare: ['#4ea1ff', '#8fd3ff', '#ffffff', '#5fe1ff'],
  epic: ['#b06cff', '#e09bff', '#ff6fd8', '#ffffff', '#5fe1ff'],
  legendary: ['#ffc44d', '#ffe08a', '#ff9f43', '#ffffff', '#ff6fd8', '#7fe6b5'],
} as const
