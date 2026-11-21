/*
 * Pure physics for the matter lab: no Three.js, so it can be tested on its own. The scene only draws what these
 * functions say.
 */

// ---- heating and cooling water ----
export type Phase = 'ice' | 'melting' | 'water' | 'boiling' | 'steam'
export interface HeatState {
  /** Temperature in °C. */
  T: number
  phase: Phase
  /** How much of the ice has melted (0-1), how much of the water has boiled away (0-1). */
  melted: number
  boiled: number
}
interface Stage {
  phase: Phase
  /** Temperature at the start and end of the stage. */
  from: number
  to: number
  seconds: number
  /** For the changes of state: the fraction reached at the end of the stage. */
  endFraction?: number
}

/** The stages of each run, in order. Plateaus are where the temperature stays put while the state changes. */
export function heatStages(mode: string, show = ''): Stage[] {
  switch (mode) {
    case 'freeze':
      return [
        { phase: 'water', from: 15, to: 0, seconds: 2 },
        { phase: 'melting', from: 0, to: 0, seconds: 4, endFraction: 1 }, // freezing: the "melted" fraction runs backwards
        { phase: 'ice', from: 0, to: -8, seconds: 1.5 },
      ]
    case 'boil_sealed':
      return [
        { phase: 'water', from: 20, to: 100, seconds: 3 },
        { phase: 'boiling', from: 100, to: 100, seconds: 4, endFraction: 1 },
      ]
    case 'boil_open':
      return [
        { phase: 'water', from: 20, to: 100, seconds: 3 },
        { phase: 'boiling', from: 100, to: 100, seconds: 4, endFraction: 1 / 3 },
      ]
    case 'curve':
      if (show === 'boil' || show === 'volume')
        return [
          { phase: 'water', from: 70, to: 100, seconds: 1.5 },
          { phase: 'boiling', from: 100, to: 100, seconds: 5, endFraction: show === 'volume' ? 1 : 0.5 },
        ]
      return [
        { phase: 'ice', from: -10, to: 0, seconds: 1.5 },
        { phase: 'melting', from: 0, to: 0, seconds: 4.5, endFraction: 1 },
        { phase: 'water', from: 0, to: 12, seconds: 1.5 },
      ]
    default: // melt
      return [
        { phase: 'ice', from: -10, to: 0, seconds: 1.5 },
        { phase: 'melting', from: 0, to: 0, seconds: 4, endFraction: 1 },
        { phase: 'water', from: 0, to: 8, seconds: 1.5 },
      ]
  }
}
export const heatDuration = (mode: string, show = '') => heatStages(mode, show).reduce((a, s) => a + s.seconds, 0)

/** The state of the water t seconds into the run. */
export function heatState(mode: string, t: number, show = ''): HeatState {
  const stages = heatStages(mode, show)
  const freezing = mode === 'freeze'
  let left = Math.max(0, t)
  let melted = freezing ? 1 : 0
  let boiled = 0
  for (const s of stages) {
    const k = Math.min(1, left / s.seconds)
    if (left <= s.seconds || s === stages[stages.length - 1]) {
      const T = s.from + (s.to - s.from) * k
      if (s.phase === 'melting') melted = freezing ? 1 - k : k
      if (s.phase === 'boiling') boiled = (s.endFraction ?? 1) * k
      return { T, phase: s.phase, melted, boiled }
    }
    left -= s.seconds
    if (s.phase === 'melting') melted = freezing ? 0 : 1
    if (s.phase === 'boiling') boiled = s.endFraction ?? 1
  }
  return { T: 0, phase: 'water', melted, boiled }
}

/** Mass on the scale: constant, unless the steam is allowed to leave an open beaker. */
export function scaleMass(beaker: number, sub: number, boiled: number, open: boolean): number {
  return beaker + sub * (open ? 1 - boiled : 1)
}

// ---- density ----
export const density = (mass: number, volume: number) => mass / volume
export const massOf = (rho: number, volume: number) => rho * volume
/** Darkest to lightest: the order the layers settle in, bottom first. */
export const layerOrder = (keys: string[], rho: Record<string, number>): string[] => [...keys].sort((a, b) => rho[b] - rho[a])
export const floats = (objectDensity: number, liquidDensity: number) => objectDensity < liquidDensity
/** How much of a floating object is under the surface. */
export const submergedFraction = (objectDensity: number, liquidDensity: number) => Math.min(1, objectDensity / liquidDensity)

// ---- Archimedes' principle ----
export const G_ACC = 9.8
/** Weight in newtons of `volume` cm³ of something with density `rho` g/cm³. */
export const weightN = (rho: number, volume: number) => (rho * volume * G_ACC) / 1000
/** Buoyant force: the weight of the liquid pushed aside by `volume` cm³ held fully under. */
export const buoyantN = (liquidRho: number, volume: number) => (liquidRho * volume * G_ACC) / 1000
/** What a spring scale reads for an object hanging fully under a liquid. Negative means it has to be held down. */
export const apparentWeightN = (objectRho: number, liquidRho: number, volume: number) => weightN(objectRho, volume) - buoyantN(liquidRho, volume)
/** Liquid pushed out (cm³) by an object released in it: its own volume if it sinks, its weight's worth of liquid if it floats. */
export const displacedCm3 = (objectRho: number, liquidRho: number, volume: number) => (objectRho >= liquidRho ? volume : (objectRho * volume) / liquidRho)
/** A boat floats if its hull can displace liquid weighing as much as the boat: hull volume ≥ mass ÷ liquid density. */
export const boatFloats = (massG: number, hullCm3: number, liquidRho: number) => hullCm3 >= massG / liquidRho
/**
 * A bowl-shaped hull is a half sphere. How deep (as a fraction of its radius) must it sink to displace a fraction f of its
 * own volume? Solves x²(3 − x)/2 = f for x in [0, 1].
 */
export function bowlDepth(f: number): number {
  const target = Math.max(0, Math.min(1, f))
  let lo = 0
  let hi = 1
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if ((mid * mid * (3 - mid)) / 2 < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
