import { describe, expect, it } from 'vitest'
import { bulbs, currentThrough, fuse, glowColor, resistorBands, voltageToBlow } from '../lab/circuitPhysics'

describe('Ohm\'s law', () => {
  it('doubling the voltage doubles the current, doubling the resistance halves it', () => {
    expect(currentThrough(4, 4)).toBeCloseTo(2 * currentThrough(2, 4))
    expect(currentThrough(4, 8)).toBeCloseTo(currentThrough(4, 4) / 2)
  })
  it('a zero resistance does not give an infinite current', () => {
    expect(currentThrough(5, 0)).toBe(0)
  })
})

describe('two identical bulbs', () => {
  it('in series each gets half the voltage and a quarter of the brightness, and the battery supplies half the current', () => {
    const s = bulbs('series', 6, 6)
    expect(s.b1).toBeCloseTo(0.25)
    expect(s.b1).toBe(s.b2)
    expect(s.battery).toBeCloseTo(currentThrough(6, 6) / 2)
  })
  it('in parallel each is as bright as a single bulb, and the battery supplies twice the current', () => {
    const p = bulbs('parallel', 6, 6)
    expect(p.b1).toBeCloseTo(1)
    expect(p.b2).toBeCloseTo(1)
    expect(p.battery).toBeCloseTo(2 * currentThrough(6, 6))
  })
  it('parallel is brighter than series for every battery and bulb', () => {
    for (const v of [3, 6, 9, 12]) for (const r of [2, 4, 6, 10]) expect(bulbs('parallel', v, r).b1).toBeGreaterThan(bulbs('series', v, r).b1)
  })
  it('removing a bulb from a series circuit puts both out', () => {
    for (const removed of [1, 2] as const) {
      const s = bulbs('series', 6, 6, removed)
      expect([s.lit1, s.lit2, s.battery]).toEqual([false, false, 0])
    }
  })
  it('removing a bulb from a parallel circuit leaves the other as bright as before, and halves the battery current', () => {
    const before = bulbs('parallel', 6, 6)
    for (const removed of [1, 2] as const) {
      const after = bulbs('parallel', 6, 6, removed)
      const other = removed === 1 ? after.b2 : after.b1
      expect(other).toBeCloseTo(before.b1)
      expect(after.battery).toBeCloseTo(before.battery / 2)
      expect(removed === 1 ? after.lit1 : after.lit2).toBe(false)
    }
  })
})

describe('the fuse', () => {
  it('blows exactly when the current reaches its rating', () => {
    const vb = voltageToBlow(4.5, 0.5, 2)
    expect(vb).toBeCloseTo(10)
    expect(fuse(vb - 0.1, 4.5, 0.5, 2).blown).toBe(false)
    expect(fuse(vb, 4.5, 0.5, 2).blown).toBe(true)
  })
  it('heat grows with the square of the current: twice the current, four times the heat', () => {
    const a = fuse(5, 4.5, 0.5, 4)
    const b = fuse(10, 4.5, 0.5, 4)
    expect(b.watts / a.watts).toBeCloseTo(4)
    expect(b.heat / a.heat).toBeCloseTo(4)
  })
  it('the thin fuse wire gets far hotter than the connecting wires carrying the same current', () => {
    const f = fuse(10, 4.5, 0.5, 5)
    const leadWatts = f.amps * f.amps * 0.01
    expect(f.watts).toBeGreaterThan(leadWatts * 20)
  })
  it('glows from dark to white as it heats', () => {
    expect(glowColor(0)[0]).toBeLessThan(glowColor(0.5)[0])
    const hot = glowColor(1)
    expect(hot[1]).toBeGreaterThan(glowColor(0.5)[1])
    expect(hot[2]).toBeGreaterThan(glowColor(0.5)[2])
  })
})

describe('resistor colour bands', () => {
  it('gives two digits and a multiplier', () => {
    expect(resistorBands(10)).toEqual([1, 0, 0])
    expect(resistorBands(47)).toEqual([4, 7, 0])
    expect(resistorBands(220)).toEqual([2, 2, 1])
    expect(resistorBands(5)).toEqual([5, 0, 0])
  })
})
