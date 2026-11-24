import { describe, expect, it } from 'vitest'
import { apparentWeightN, boatFloats, bowlDepth, buoyantN, displacedCm3, weightN, density, floats, heatDuration, heatState, heatStages, layerOrder, massOf, scaleMass, submergedFraction } from '../lab/matterPhysics'

describe('heating curve', () => {
  it('melting: the temperature holds at 0 °C until all the ice has gone, then rises', () => {
    const during = [2, 3, 4, 5].map((t) => heatState('melt', t))
    for (const s of during) {
      expect(s.T).toBe(0)
      expect(s.phase).toBe('melting')
    }
    expect(during[0].melted).toBeLessThan(during[3].melted)
    expect(heatState('melt', 6).melted).toBe(1)
    expect(heatState('melt', 6.5).T).toBeGreaterThan(0)
    expect(heatState('melt', 0).phase).toBe('ice')
    expect(heatState('melt', 0).T).toBe(-10)
  })
  it('boiling: stays at 100 °C while the water boils away', () => {
    const s = heatState('boil_sealed', 5)
    expect(s.T).toBe(100)
    expect(s.phase).toBe('boiling')
    expect(heatState('boil_sealed', heatDuration('boil_sealed')).boiled).toBeCloseTo(1, 6)
    expect(heatState('boil_open', heatDuration('boil_open')).boiled).toBeCloseTo(1 / 3, 6)
  })
  it('freezing runs the other way and ends below zero', () => {
    expect(heatState('freeze', 0).melted).toBe(1)
    expect(heatState('freeze', 4).T).toBe(0)
    expect(heatState('freeze', 6).melted).toBe(0)
    expect(heatState('freeze', heatDuration('freeze')).T).toBeCloseTo(-8, 6)
  })
  it('every mode has stages, and the temperature never jumps between them', () => {
    for (const mode of ['melt', 'freeze', 'boil_sealed', 'boil_open', 'curve']) {
      const st = heatStages(mode)
      for (let i = 1; i < st.length; i++) expect(st[i].from).toBe(st[i - 1].to)
    }
  })
})

describe('mass on the scale', () => {
  it('is conserved when nothing escapes, and falls when steam leaves an open beaker', () => {
    expect(scaleMass(100, 150, 0, false)).toBe(250)
    expect(scaleMass(100, 150, 1, false)).toBe(250)
    expect(scaleMass(100, 200, 0, true)).toBe(300)
    expect(scaleMass(100, 200, 1 / 3, true)).toBeCloseTo(233.33, 1)
  })
})

describe('density', () => {
  it('mass, volume and density agree', () => {
    expect(massOf(1.42, 50)).toBeCloseTo(71, 6)
    expect(density(71, 50)).toBeCloseTo(1.42, 6)
  })
  it('layers settle densest first, and an object floats only if it is less dense', () => {
    const rho = { honey: 1.42, water: 1.0, oil: 0.92 }
    expect(layerOrder(['oil', 'honey', 'water'], rho)).toEqual(['honey', 'water', 'oil'])
    expect(floats(0.24, 1)).toBe(true)
    expect(floats(7.8, 1)).toBe(false)
    expect(floats(0.92, 0.79)).toBe(false)
    expect(submergedFraction(0.92, 1)).toBeCloseTo(0.92, 6)
  })
})

describe("Archimedes' principle", () => {
  it('buoyant force is the weight of the liquid displaced, and the scale reads weight minus that', () => {
    expect(buoyantN(1, 1000)).toBeCloseTo(9.8, 6)
    expect(weightN(7.87, 200)).toBeCloseTo(15.425, 2)
    expect(apparentWeightN(7.87, 1, 200)).toBeCloseTo(13.465, 2)
  })
  it('equal volumes feel equal buoyant forces, whatever the material', () => {
    expect(buoyantN(1, 100)).toBe(buoyantN(1, 100))
    expect(apparentWeightN(7.87, 1, 100)).toBeGreaterThan(apparentWeightN(2.7, 1, 100))
    expect(weightN(7.87, 100) - apparentWeightN(7.87, 1, 100)).toBeCloseTo(weightN(2.7, 100) - apparentWeightN(2.7, 1, 100), 9)
  })
  it('a sinking object displaces its volume, a floating one its weight of liquid', () => {
    expect(displacedCm3(7.87, 1, 64)).toBe(64)
    expect(displacedCm3(0.6, 1, 512)).toBeCloseTo(307.2, 6)
    expect(displacedCm3(0.9, 1, 125)).toBeCloseTo(112.5, 6)
  })
  it('a clay boat floats only if its hull is big enough', () => {
    expect(boatFloats(100, 250, 1)).toBe(true)
    expect(boatFloats(100, 80, 1)).toBe(false)
    expect(boatFloats(120, 125, 0.79)).toBe(false)
    expect(boatFloats(150, 170, 0.92)).toBe(true)
  })
  it('a bowl sinks deeper the more it has to displace', () => {
    expect(bowlDepth(0)).toBeCloseTo(0, 3)
    expect(bowlDepth(1)).toBeCloseTo(1, 3)
    expect(bowlDepth(0.4)).toBeLessThan(bowlDepth(0.8))
    const x = bowlDepth(0.5)
    expect((x * x * (3 - x)) / 2).toBeCloseTo(0.5, 4)
  })
})
