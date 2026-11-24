/*
 * The physics behind the Fundamental Physics lab, apart from the drawing so it can be checked on its own.
 * g = 9.8 N/kg on the Earth and 1.6 N/kg on the Moon. Everything is ideal unless a generator or a surface says otherwise.
 */
export const G_EARTH = 9.8
export const G_MOON = 1.6

/** Straight-line distance from the start after going `frac` of the way round a circle of circumference C. */
export const chord = (C: number, frac: number): number => (C / Math.PI) * Math.abs(Math.sin(Math.PI * frac))
/** Displacement after two legs at right angles. */
export const legs = (a: number, b: number): number => Math.hypot(a, b)

/** Steady acceleration: velocity and distance after time t. */
export const accelOf = (u: number, v: number, t: number): number => (t > 0 ? (v - u) / t : 0)
export const distanceAt = (u: number, a: number, t: number): number => u * t + 0.5 * a * t * t

/** Two carts that stick together: the shared velocity afterwards (momentum is conserved). */
export const stickVelocity = (m1: number, v1: number, m2: number, v2: number): number => (m1 * v1 + m2 * v2) / (m1 + m2)

/** Speed after falling h from rest (no air resistance). */
export const fallSpeed = (h: number, g = G_EARTH): number => Math.sqrt(2 * g * Math.max(0, h))
/** Average force to stop a momentum p in time t. */
export const stopForce = (p: number, t: number): number => (t > 0 ? p / t : Infinity)

/** Pendulum: period of a simple pendulum of length L. */
export const period = (L: number, g = G_EARTH): number => 2 * Math.PI * Math.sqrt(L / g)
/** Release angle that raises the bob by h on a string of length L. */
export const releaseAngle = (L: number, h: number): number => Math.acos(Math.max(-1, Math.min(1, 1 - h / L)))
/** Potential and kinetic energy of a bob of mass m on a string of length L at angle theta and angular speed omega. */
export function pendulumEnergy(m: number, L: number, theta: number, omega: number, g = G_EARTH): { pe: number; ke: number } {
  const h = L * (1 - Math.cos(theta))
  const v = L * omega
  return { pe: m * g * h, ke: 0.5 * m * v * v }
}
/** One step of the pendulum equation, with an optional drag (the generator) that takes energy out. */
export function pendulumStep(s: { theta: number; omega: number }, L: number, dt: number, drag = 0, g = G_EARTH): void {
  // semi-implicit Euler in small steps: stable and keeps the energy steady when drag = 0
  const n = Math.max(1, Math.ceil(dt / 0.002))
  const h = dt / n
  for (let i = 0; i < n; i++) {
    s.omega += (-(g / L) * Math.sin(s.theta) - drag * s.omega) * h
    s.theta += s.omega * h
  }
}

/** Work, power, weight, charge, kelvin. */
export const workDone = (F: number, s: number): number => F * s
export const powerOf = (W: number, t: number): number => (t > 0 ? W / t : 0)
export const weightOf = (m: number, g = G_EARTH): number => m * g
export const chargeOf = (I: number, t: number): number => I * t
export const kelvin = (c: number): number => c + 273
