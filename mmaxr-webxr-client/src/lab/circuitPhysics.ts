/*
 * The physics behind the Electricity & Circuits lab, kept apart from the drawing so it can be checked on its own.
 * Ohm's law, two identical bulbs wired in series or in parallel, and a fuse wire heating up as the current rises.
 * Brightness is power relative to one bulb on its own across the same battery.
 */
export type Wiring = 'series' | 'parallel'

/** Ohm's law. */
export const currentThrough = (volts: number, ohms: number): number => (ohms > 0 ? volts / ohms : 0)

export interface BulbState {
  /** Current drawn from the battery. */
  battery: number
  /** Current through each bulb. */
  i1: number
  i2: number
  /** Brightness of each bulb compared with a single bulb across the same battery (1 = the same). */
  b1: number
  b2: number
  lit1: boolean
  lit2: boolean
}

/**
 * Two identical bulbs of resistance `r` on a battery of `v` volts. `removed` is 0 for none, or 1 or 2 for the bulb that
 * has been unscrewed. A bulb's brightness follows the power it gets, P = I² R.
 */
export function bulbs(mode: Wiring, v: number, r: number, removed: 0 | 1 | 2 = 0): BulbState {
  const single = v * v / r
  if (mode === 'series') {
    const closed = removed === 0
    const i = closed ? v / (2 * r) : 0
    const b = (i * i * r) / single
    return { battery: i, i1: i, i2: i, b1: b, b2: b, lit1: closed, lit2: closed }
  }
  const i1 = removed === 1 ? 0 : v / r
  const i2 = removed === 2 ? 0 : v / r
  return { battery: i1 + i2, i1, i2, b1: (i1 * i1 * r) / single, b2: (i2 * i2 * r) / single, lit1: i1 > 0, lit2: i2 > 0 }
}

export interface FuseState {
  /** Current in the circuit. */
  amps: number
  /** Power turned into heat in the fuse wire, P = I² R. */
  watts: number
  /** How close to melting the wire is, 0 cold to 1 melting (heat grows with the square of the current). */
  heat: number
  blown: boolean
}

/** A fuse wire of resistance `rFuse`, rated for `rated` amps, in series with a load of `rLoad` ohms on `v` volts. */
export function fuse(v: number, rLoad: number, rFuse: number, rated: number): FuseState {
  const amps = currentThrough(v, rLoad + rFuse)
  return { amps, watts: amps * amps * rFuse, heat: Math.min(1.2, (amps / rated) ** 2), blown: amps >= rated }
}

/** The battery voltage at which the fuse just melts. */
export const voltageToBlow = (rLoad: number, rFuse: number, rated: number): number => rated * (rLoad + rFuse)

/** The colour of a heating wire: black, dull red, orange, yellow-white. `heat` is 0 to 1. */
export function glowColor(heat: number): [number, number, number] {
  const h = Math.max(0, Math.min(1, heat))
  if (h < 0.35) return [0.12 + 0.2 * h, 0.1, 0.1]
  if (h < 0.7) {
    const k = (h - 0.35) / 0.35
    return [0.35 + 0.65 * k, 0.1 + 0.25 * k, 0.05]
  }
  const k = (h - 0.7) / 0.3
  return [1, 0.35 + 0.55 * k, 0.05 + 0.6 * k]
}

/** Colour-band digits for a resistor of a whole number of ohms (two digits and a multiplier). */
export function resistorBands(ohms: number): [number, number, number] {
  let mult = 0
  let x = ohms
  while (x >= 100) {
    x /= 10
    mult++
  }
  while (x < 10 && mult > -1) {
    x *= 10
    mult--
  }
  const d = Math.round(x)
  return [Math.floor(d / 10), d % 10, Math.max(0, mult)]
}
