import { describe, expect, it } from 'vitest'
import { density, floats, heatDuration, heatState, heatStages, layerOrder, massOf, scaleMass, submergedFraction } from '../lab/matterPhysics'

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
