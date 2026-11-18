import { describe, expect, it } from 'vitest'
import type { ChemistryLessonContract } from '@mmaxr/schema'
import { ChemistryExperiment } from '../state/chemistry'
import { buildSnapshot } from '../lab/coachContext'

const lesson: ChemistryLessonContract = {
  lessonId: 'chemistry-101',
  type: 'chemistry_indicators',
  title: 'T',
  modelUrl: 'http://x/y.glb',
  config: { totalTestTubes: 2, requiredIndicatorsToSelect: 1 },
  indicators: [
    { id: 'litmus', name: 'Litmus Paper', source: 'n', colors: { neutral: 'Purple' } },
    { id: 'ph_paper', name: 'pH paper', source: 's', isPhTest: true },
  ],
}

describe('coach context', () => {
  const exp = new ChemistryExperiment(lesson, () => {}, () => 1)
  exp.toggleIndicator('litmus')
  exp.startTesting()
  exp.predict(0, 'Blue', 2, 1000)
  exp.act('Red')

  it('describes only what the student has seen', () => {
    const snap = buildSnapshot(exp)
    expect(snap.tools).toEqual(['Litmus Paper'])
    expect(snap.tubes[0].tests[0]).toMatchObject({ tool: 'Litmus Paper', predicted: 'Blue', observed: 'Red', matched: false })
    expect(snap.tubes[1].tests).toEqual([])
  })
})
