import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../config', () => ({
  CONFIG: { LESSONS_URL: 'http://test/lessons/active' },
}))

import { fetchActiveLesson } from '../services/lessons'

const valid = {
  lessonId: 'physics-101',
  title: 'Bohr Model',
  modelUrl: 'http://cdn/model.glb',
  simulation: {
    atomicNumber: 1, nInitial: 3, nFinal: 2,
    anomalyTrialNumber: 3, anomalyShiftMultiplier: 1.2,
  },
}

describe('fetchActiveLesson', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('GETs and returns contract', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(valid), { status: 200 }),
    )
    const lesson = await fetchActiveLesson()
    expect(lesson).toEqual(valid)
    expect(fetchSpy).toHaveBeenCalledWith('http://test/lessons/active')
  })

  it('throws on 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 404, statusText: 'Not Found' }),
    )
    await expect(fetchActiveLesson()).rejects.toThrow(/Lesson 404/)
  })

  it('throws when modelUrl missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ...valid, modelUrl: '' }), { status: 200 }),
    )
    await expect(fetchActiveLesson()).rejects.toThrow(/missing modelUrl/)
  })

  it('throws when simulation missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ...valid, simulation: null }), { status: 200 }),
    )
    await expect(fetchActiveLesson()).rejects.toThrow(/missing simulation/)
  })
})