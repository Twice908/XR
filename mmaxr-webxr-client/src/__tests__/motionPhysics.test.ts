import { describe, expect, it } from 'vitest'
import { BALL_TERMINAL, DROP_HEIGHT, FEATHER_TERMINAL, LAP, LEAD, LOOP_R, carAt, cradleAngle, elastic, kinematics, profile, pushOnFloor, simulateFall } from '../lab/motionPhysics'

describe('track', () => {
  it('the straight is 50 m and the lap returns exactly to its start', () => {
    const a = carAt(0)
    const b = carAt(LEAD)
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(50, 6)
    const start = carAt(LEAD)
    const end = carAt(LEAD + LAP)
    expect(end.x).toBeCloseTo(start.x, 6)
    expect(end.z).toBeCloseTo(start.z, 6)
    expect(LOOP_R * 2 * Math.PI).toBeCloseTo(100, 6)
  })
  it('the loop joins the straight smoothly and runs anticlockwise', () => {
    const before = carAt(LEAD - 0.01)
    const after = carAt(LEAD + 0.01)
    expect(after.x - before.x).toBeGreaterThan(0)
    expect(Math.abs(after.z - before.z)).toBeLessThan(1e-3)
    expect(carAt(LEAD + LAP / 4).heading).toBeCloseTo(Math.PI / 2, 6)
  })
})

describe('kinematics', () => {
  it('straight drive: distance equals displacement', () => {
    const k = kinematics(0, 50, 0, 0)
    expect(k.distance).toBeCloseTo(50)
    expect(k.displacement).toBeCloseTo(50)
  })
  it('full lap: distance 100, displacement 0', () => {
    const k = kinematics(LEAD, LEAD + LAP, 5, 0)
    expect(k.distance).toBeCloseTo(100)
    expect(k.displacement).toBeCloseTo(0, 6)
  })
  it('half way round the loop the displacement is the diameter', () => {
    expect(kinematics(LEAD, LEAD + LAP / 2, 5, 0).displacement).toBeCloseTo(2 * LOOP_R, 6)
  })
  it('steady lap: constant speed but non-zero acceleration (v squared over r)', () => {
    const k = kinematics(LEAD, LEAD + 30, 5, 0)
    expect(k.accel).toBeCloseTo(25 / LOOP_R, 6)
    expect(k.towardsCentre).toBe(true)
  })
  it('the steady profile covers the lap at 5 m/s in 20 s', () => {
    const p = profile('drive_lap_steady')!
    expect(p.at(20) - p.at(0)).toBeCloseTo(100)
    expect(profile('nope')).toBeNull()
  })
})

describe('drives with this session’s values', () => {
  it('back and forth: the end position is the net of the legs, and the car really reverses', () => {
    const p = profile('drive_straight', { legs: [40, -15] })!
    expect(p.at(p.duration)).toBeCloseTo(25, 6)
    const peak = Math.max(...Array.from({ length: 200 }, (_, i) => p.at((i / 199) * p.duration)))
    expect(peak).toBeCloseTo(40, 3)
    expect(p.at(0)).toBe(0)
  })
  it('a fraction of the lap covers that fraction of 100 m', () => {
    for (const fr of [0.25, 0.5, 0.75, 1, 1.5]) {
      const p = profile('drive_lap', { frac: fr })!
      expect(p.at(p.duration) - p.at(0)).toBeCloseTo(100 * fr, 6)
    }
  })
  it('a steady drive keeps its speed and takes distance over speed', () => {
    const p = profile('drive_lap_steady', { frac: 0.5, speed: 10 })!
    expect(p.duration).toBeCloseTo(5, 6)
    expect(p.at(2) - p.at(1)).toBeCloseTo(10, 6)
    const s = profile('drive_lap_steady', { mode: 'straight', speed: 6, length: 36 })!
    expect(s.from).toBe(0)
    expect(s.at(s.duration)).toBeCloseTo(36, 6)
    expect(s.duration).toBeCloseTo(6, 6)
  })
})

describe('forces', () => {
  it('a small push on a heavy crate is matched by static friction', () => {
    const r = pushOnFloor(20, 80, 0.5, 0.4, false)
    expect(r.moving).toBe(false)
    expect(r.friction).toBe(20)
    expect(r.net).toBe(0)
  })
  it('past the limit the crate slides and accelerates', () => {
    const r = pushOnFloor(500, 80, 0.5, 0.4, false)
    expect(r.moving).toBe(true)
    expect(r.accel).toBeCloseTo((500 - 0.4 * 80 * 9.8) / 80)
  })
})

describe('collisions', () => {
  it('conserves momentum and energy, heavy into light', () => {
    const [a, b] = elastic(5, 4, 1, 0)
    expect(a).toBeCloseTo(8 / 3, 6)
    expect(b).toBeCloseTo(20 / 3, 6)
    expect(5 * a + 1 * b).toBeCloseTo(20, 6)
    expect(0.5 * 5 * a * a + 0.5 * b * b).toBeCloseTo(0.5 * 5 * 16, 6)
  })
})

describe('falling', () => {
  it('vacuum: 4.9 m takes one second for anything', () => {
    expect(simulateFall(DROP_HEIGHT, null).time).toBeCloseTo(1, 1)
  })
  it('air: the ball is almost as quick as in a vacuum, the feather is much slower', () => {
    const ball = simulateFall(DROP_HEIGHT, BALL_TERMINAL).time
    const feather = simulateFall(DROP_HEIGHT, FEATHER_TERMINAL).time
    expect(ball).toBeLessThan(1.05)
    expect(feather).toBeGreaterThan(3.5)
    expect(feather).toBeGreaterThan(ball * 3)
  })
})

describe('newtons cradle', () => {
  it('left comes down, right goes up, and back again', () => {
    expect(cradleAngle(0).left).toBeLessThan(-0.6)
    expect(cradleAngle(0.4 * 1.99).left).toBeCloseTo(0, 1)
    expect(cradleAngle(0.4 * 1.5).right).toBeGreaterThan(0.4)
    expect(cradleAngle(0.4 * 1.5).left).toBe(0)
  })
})
