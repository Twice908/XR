import { describe, expect, it } from 'vitest'
import { leverClass, leverEffort, pulleyEffort, rampEffort, ropePulled, turnsToLift, wheelEffort, work } from '../lab/machinePhysics'

describe('levers', () => {
  it('a longer effort arm needs less effort; moving the fulcrum to the load shortens the load arm', () => {
    expect(leverEffort(200, 0.5, 1.5)).toBeCloseTo(66.67, 1)
    expect(leverEffort(200, 0.25, 1.75)).toBeLessThan(leverEffort(200, 0.5, 1.5))
  })
  it('classifies the three classes by where the fulcrum, load and effort sit', () => {
    expect(leverClass(1, 0, 2)).toBe(1) // seesaw: fulcrum between
    expect(leverClass(0, 0.5, 1.4)).toBe(2) // wheelbarrow: load between
    expect(leverClass(0, 1.2, 0.7)).toBe(3) // tweezers: effort between
  })
  it('class 2 gives a mechanical advantage over 1 and class 3 under 1', () => {
    expect(leverEffort(100, 0.5, 1.4)).toBeLessThan(100)
    expect(leverEffort(100, 0.12, 0.07)).toBeGreaterThan(100)
  })
})

describe('pulleys', () => {
  it('effort is load / n and rope pulled n × height: the product is unchanged', () => {
    for (const n of [1, 2, 3, 4, 6]) expect(work(pulleyEffort(240, n), ropePulled(1, n))).toBeCloseTo(240, 6)
  })
})

describe('wheel and axle', () => {
  it('a bigger wheel needs less force but more turns of the rim', () => {
    expect(wheelEffort(200, 0.05, 0.25)).toBeCloseTo(40)
    expect(wheelEffort(200, 0.05, 0.5)).toBeLessThan(wheelEffort(200, 0.05, 0.25))
    expect(work(wheelEffort(200, 0.05, 0.25), (2 * Math.PI * 0.25 * 1) / (2 * Math.PI * 0.05))).toBeCloseTo(200, 6)
    expect(turnsToLift(1, 0.05)).toBeCloseTo(3.18, 2)
  })
})

describe('inclined plane', () => {
  it('a longer ramp needs less force over more distance: effort × length = load × height', () => {
    expect(rampEffort(800, 1.2, 4)).toBeCloseTo(240)
    expect(rampEffort(800, 1.2, 8)).toBeLessThan(rampEffort(800, 1.2, 4))
    for (const len of [2, 3, 5, 8]) expect(work(rampEffort(600, 1.5, len), len)).toBeCloseTo(900, 6)
  })
})
