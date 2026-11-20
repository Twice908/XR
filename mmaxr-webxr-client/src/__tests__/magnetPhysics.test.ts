import { describe, expect, it } from 'vitest'
import { BAR, HORSE, TWO_NN, clipsHeld, countCrossings, fieldAt, fieldLines, flemingForce, forceNewtons, galvo, mag, oerstedDegrees, traceLine } from '../lab/magnetPhysics'

describe('field of a bar magnet', () => {
  it('runs from North to South outside the magnet', () => {
    expect(fieldAt(BAR, [4.5, 0, 0])[0]).toBeGreaterThan(0) // beyond the N end: away
    expect(fieldAt(BAR, [-4.5, 0, 0])[0]).toBeGreaterThan(0) // beyond the S end: towards the magnet
    expect(fieldAt(BAR, [0, 0, 1.6])[0]).toBeLessThan(0) // beside the middle: towards the S end
    const near = fieldAt(BAR, [2.6, 0, 1.3])
    expect(near[0] * 0.8 + near[2] * 1.3).toBeGreaterThan(0) // just beside the N end: away from the N pole
  })
  it('is strongest near a pole and weakens with distance', () => {
    expect(mag(fieldAt(BAR, [2.4, 0, 0]))).toBeGreaterThan(mag(fieldAt(BAR, [0, 0, 2.2])))
    expect(mag(fieldAt(BAR, [-2.8, 0, 0]))).toBeGreaterThan(mag(fieldAt(BAR, [-5.5, 0, 0])))
  })
  it('a horseshoe gap field points straight across, North tip to South tip', () => {
    const b = fieldAt(HORSE, [0, 0, 1.4])
    expect(b[0]).toBeGreaterThan(0)
    expect(Math.abs(b[2])).toBeLessThan(1e-6)
  })
})

describe('field lines', () => {
  it('leave the North pole and end at the South pole', () => {
    const line = traceLine(BAR, [1.8 + 0.28 * Math.cos(1.2), 0, 0.28 * Math.sin(1.2)])
    const last = line[line.length - 1]
    expect(Math.hypot(last[0] - -1.8, last[1], last[2])).toBeLessThan(0.5)
    expect(line.length).toBeGreaterThan(20)
  })
  it('never cross, for a bar, a horseshoe or two magnets pushed together', () => {
    for (const poles of [BAR, HORSE, TWO_NN]) expect(countCrossings(fieldLines(poles, 12))).toBe(0)
  })
  it('the counter does notice a real crossing', () => {
    const a: [number, number, number][] = [[0, 0, 0], [2, 0, 2]]
    const b: [number, number, number][] = [[0, 0, 2], [2, 0, 0]]
    expect(countCrossings([a, b], 1)).toBeGreaterThan(0)
  })
})

describe('Oersted', () => {
  it('current North above the needle: West; reversed or above the wire: East; across the needle: nothing', () => {
    const base = { current: 1, amps: 3, placement: 'under', wire: 'ns', distance: 3 }
    expect(oerstedDegrees(base)).toBeCloseTo(-26.57, 1)
    expect(oerstedDegrees({ ...base, current: -1 })).toBeCloseTo(26.57, 1)
    expect(oerstedDegrees({ ...base, placement: 'over' })).toBeCloseTo(26.57, 1)
    expect(oerstedDegrees({ ...base, wire: 'ew' })).toBe(0)
  })
  it('doubling the current takes tan from 0.5 to 1: 45 degrees', () => {
    expect(Math.abs(oerstedDegrees({ current: 1, amps: 6, placement: 'under', wire: 'ns', distance: 3 }))).toBeCloseTo(45, 3)
  })
})

describe('electromagnet and force', () => {
  it('clips grow with turns and current; an air core is far weaker', () => {
    expect(clipsHeld(10, 1, 'iron')).toBe(3)
    expect(clipsHeld(40, 1.5, 'iron')).toBe(clipsHeld(20, 1.5, 'iron') * 2)
    expect(clipsHeld(20, 3, 'iron')).toBe(clipsHeld(20, 1.5, 'iron') * 2)
    expect(clipsHeld(20, 1.5, 'air')).toBeLessThan(clipsHeld(20, 1.5, 'iron') / 4)
  })
  it('Fleming: current up, field right: into the screen (away from you)', () => {
    expect(flemingForce([0, 1, 0], [1, 0, 0])).toEqual([0, 0, -1])
    expect(flemingForce([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1])
    expect(forceNewtons(0.5, 4, 0.3)).toBeCloseTo(0.6, 9)
  })
})

describe('induction', () => {
  it('the needle swings while the pole moves in, the other way coming out, and not at all when still', () => {
    expect(galvo(-1, 2, true, 40)).toBeGreaterThan(0.05)
    expect(galvo(-1, -2, true, 40)).toBeLessThan(-0.05)
    expect(galvo(0.2, 0, true, 40)).toBeCloseTo(0, 9)
    expect(galvo(-1, 2, false, 40)).toBeLessThan(-0.05)
  })
  it('faster and more turns give a bigger swing', () => {
    expect(galvo(-1, 1, true, 40)).toBeCloseTo(galvo(-1, 0.5, true, 40) * 2, 5)
    expect(galvo(-1, 0.5, true, 80)).toBeCloseTo(galvo(-1, 0.5, true, 40) * 2, 5)
  })
})
