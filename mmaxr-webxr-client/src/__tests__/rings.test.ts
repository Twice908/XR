import { describe, expect, it } from 'vitest'
import { arc, daysLeft, remaining, ringNudge } from '../gamification/rings'

const ring = (value: number, goal: number) => ({ value, goal, percent: Math.min(100, Math.round((value / goal) * 100)), closed: value >= goal })

describe('rings', () => {
  it('says what is left on a ring, with the right unit', () => {
    expect(remaining('complete', ring(2, 3))).toBe('1 more lab')
    expect(remaining('master', ring(0, 2))).toBe('2 more mastered labs')
    expect(remaining('explore', ring(59, 60))).toBe('1 more minute')
    expect(remaining('explore', ring(60, 60))).toBeNull()
  })

  it('nudges towards the ring closest to closing', () => {
    expect(ringNudge({ explore: ring(10, 60), master: ring(1, 2), complete: ring(2, 3), allClosed: false, bonusPackId: null })).toBe('1 more lab to close your Complete ring.')
    // Ties go to finishing labs over minutes.
    expect(ringNudge({ explore: ring(30, 60), master: ring(0, 2), complete: ring(1, 2), allClosed: false, bonusPackId: null })).toBe('1 more lab to close your Complete ring.')
    // With two rings closed, the last one earns the bonus.
    expect(ringNudge({ explore: ring(45, 60), master: ring(2, 2), complete: ring(3, 3), allClosed: false, bonusPackId: null })).toBe('15 more minutes and earn this week’s bonus pack.')
    expect(ringNudge({ explore: ring(60, 60), master: ring(2, 2), complete: ring(3, 3), allClosed: true, bonusPackId: 'p' })).toContain('bonus pack is waiting')
    // Bonus already earned and the goal raised afterwards: no second bonus is promised.
    expect(ringNudge({ explore: ring(65, 90), master: ring(3, 3), complete: ring(5, 5), allClosed: false, bonusPackId: 'p' })).toBe('25 more minutes to close your Explore ring.')
  })

  it('counts days until Monday', () => {
    expect(daysLeft(new Date(2026, 10, 23))).toBe(7) // Monday
    expect(daysLeft(new Date(2026, 10, 26))).toBe(4) // Thursday
    expect(daysLeft(new Date(2026, 10, 29))).toBe(1) // Sunday
  })

  it('draws arcs clamped to 0-100%', () => {
    const r = 10
    const full = 2 * Math.PI * r
    expect(arc(50, r).dash).toBe(`${(full / 2).toFixed(2)} ${full.toFixed(2)}`)
    expect(arc(140, r).dash.split(' ')[0]).toBe(full.toFixed(2))
    expect(arc(-5, r).dash.split(' ')[0]).toBe('0.00')
  })
})

import { elementPosition } from '../gamification/periodic'
describe('periodic table layout', () => {
  it('places elements where the table has them', () => {
    expect(elementPosition(1)).toEqual({ row: 1, col: 1 })
    expect(elementPosition(2)).toEqual({ row: 1, col: 18 })
    expect(elementPosition(5)).toEqual({ row: 2, col: 13 })
    expect(elementPosition(26)).toEqual({ row: 4, col: 8 })
    expect(elementPosition(56)).toEqual({ row: 6, col: 2 })
    expect(elementPosition(57)).toEqual({ row: 9, col: 3 })
    expect(elementPosition(71)).toEqual({ row: 9, col: 17 })
    expect(elementPosition(72)).toEqual({ row: 6, col: 4 })
    expect(elementPosition(79)).toEqual({ row: 6, col: 11 })
    expect(elementPosition(88)).toEqual({ row: 7, col: 2 })
    expect(elementPosition(103)).toEqual({ row: 10, col: 17 })
    expect(elementPosition(118)).toEqual({ row: 7, col: 18 })
  })
  it('never puts two elements in one cell', () => {
    const cells = new Set(Array.from({ length: 118 }, (_, i) => { const p = elementPosition(i + 1); return `${p.row}:${p.col}` }))
    expect(cells.size).toBe(118)
  })
})
