import { describe, expect, it, vi } from 'vitest'

vi.mock('../services/telemetry', () => ({
  telemetry: { emit: vi.fn(), configure: vi.fn() },
}))
vi.mock('@mmaxr/schema', () => ({
  XapiVerb: { Launched: 'launched', Attempted: 'attempted', Completed: 'completed', Asked: 'asked' },
}))

import { createStateMachine } from '../state/machine'
import type { LessonContract } from '@mmaxr/schema'

function makeLesson(
  overrides: Partial<LessonContract['simulation']> = {},
): LessonContract {
  return {
    lessonId: 'physics-101',
    title: 'Bohr Model',
    modelUrl: 'http://example/model.glb',
    simulation: {
      atomicNumber: 1,
      nInitial: 3,
      nFinal: 2,
      anomalyTrialNumber: 2,
      anomalyShiftMultiplier: 1.3,
      ...overrides,
    },
  } as LessonContract
}

describe('createStateMachine — physics', () => {
  it('Hydrogen 3→2 (Balmer-alpha) ≈ 656 nm', () => {
    const m = createStateMachine(makeLesson())
    const wl = m.wavelengthNm(3, 2)
    expect(wl).toBeGreaterThan(650)
    expect(wl).toBeLessThan(660)
  })

  it('energy scales with Z² (He+ Z=2 is 4× hydrogen)', () => {
    const h = createStateMachine(makeLesson({ atomicNumber: 1 }))
    const he = createStateMachine(makeLesson({ atomicNumber: 2 }))
    expect(he.energyEv(3, 2) / h.energyEv(3, 2)).toBeCloseTo(4, 5)
  })

  it('|wavelength| is symmetric across n order', () => {
    const m = createStateMachine(makeLesson())
    expect(m.wavelengthNm(3, 2)).toBeCloseTo(m.wavelengthNm(2, 3), 5)
  })

  it('Lyman-alpha H (2→1) ≈ 122 nm', () => {
    const m = createStateMachine(makeLesson())
    const wl = m.wavelengthNm(2, 1)
    expect(wl).toBeGreaterThan(118)
    expect(wl).toBeLessThan(125)
  })
})

describe('createStateMachine — anomaly', () => {
  it('flags anomaly exactly on anomalyTrialNumber', () => {
    const m = createStateMachine(makeLesson({ anomalyTrialNumber: 3 }))
    expect(m.registerTrial().isAnomaly).toBe(false)
    expect(m.registerTrial().isAnomaly).toBe(false)
    const third = m.registerTrial()
    expect(third.isAnomaly).toBe(true)
    expect(third.multiplier).toBe(1.3)
  })

  it('does not re-flag after resolve', () => {
    const m = createStateMachine(makeLesson({ anomalyTrialNumber: 2 }))
    m.registerTrial()
    expect(m.registerTrial().isAnomaly).toBe(true)
    m.resolveAnomaly()
    expect(m.registerTrial().isAnomaly).toBe(false)
  })

  it('resolveAnomaly is idempotent', () => {
    const m = createStateMachine(makeLesson())
    m.resolveAnomaly()
    m.resolveAnomaly()
    expect(m.anomalyResolved).toBe(true)
  })

  it('trialCount increments per registerTrial', () => {
    const m = createStateMachine(makeLesson())
    expect(m.trialCount).toBe(0)
    m.registerTrial()
    m.registerTrial()
    expect(m.trialCount).toBe(2)
  })
})