import { describe, expect, it } from 'vitest'
import type { ChemistryLessonContract } from '@mmaxr/schema'
import { ChemistryExperiment } from '../state/chemistry'
import { buildSecrets, buildSnapshot, buildTruth } from '../lab/coachContext'

const lesson: ChemistryLessonContract = {
  lessonId: 'chemistry-101',
  type: 'chemistry_indicators',
  title: 'T',
  modelUrl: 'http://x/y.glb',
  config: { totalTestTubes: 2, requiredIndicatorsToSelect: 1 },
  indicators: [
    { id: 'litmus', name: 'Litmus Paper', source: 'n', colors: { neutral: 'Purple', acid: 'Red', base: 'Blue' } },
    { id: 'ph_paper', name: 'pH paper', source: 's', isPhTest: true, colors: { neutral: '', acid: '', base: '' } },
  ],
  assignedSolutions: [
    { id: 'hcl', name: 'Hydrochloric Acid', formula: 'HCl', type: 'acid', ph: 1 },
    { id: 'naoh', name: 'Sodium Hydroxide', formula: 'NaOH', type: 'base', ph: 14 },
  ],
}

describe('coach context', () => {
  const exp = new ChemistryExperiment(lesson, () => {}, () => 1)
  exp.toggleIndicator('litmus')
  exp.startTesting()
  exp.predict(0, 'Blue', 2, 1000)
  exp.act()

  it('describes only what the student has seen', () => {
    const snap = buildSnapshot(exp)
    expect(snap.tools).toEqual(['Litmus Paper'])
    expect(snap.tubes[0].tests[0]).toMatchObject({ tool: 'Litmus Paper', predicted: 'Blue', observed: 'Red', matched: false })
    expect(snap.tubes[1].tests).toEqual([])
    const text = JSON.stringify(snap)
    for (const secret of ['Hydrochloric', 'HCl', 'Sodium', 'NaOH', '"acid"', '"base"']) expect(text).not.toContain(secret)
  })

  it('keeps the hidden answers in separate structures for the guard and the reveal', () => {
    expect(buildSecrets(exp)[0]).toMatchObject({ tube: 1, terms: ['Hydrochloric Acid', 'HCl'], verdict: 'acid', ph: 1 })
    expect(buildTruth(exp)[1]).toMatchObject({ tube: 2, name: 'Sodium Hydroxide', type: 'base', ph: 14 })
  })
})
