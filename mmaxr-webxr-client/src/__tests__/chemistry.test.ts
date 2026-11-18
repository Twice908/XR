import { describe, expect, it } from 'vitest'
import { XapiVerb } from '@mmaxr/schema'
import type { ChemistryLessonContract, TelemetryEvent } from '@mmaxr/schema'
import { ChemistryExperiment, StateError } from '../state/chemistry'

const lesson: ChemistryLessonContract = {
  lessonId: 'chemistry-101',
  type: 'chemistry_indicators',
  title: 'Test lab',
  modelUrl: 'http://x/y.glb',
  config: { totalTestTubes: 2, requiredIndicatorsToSelect: 2 },
  indicators: [
    { id: 'litmus', name: 'Litmus', source: 'n', colors: { neutral: 'Purple', acid: 'Red', base: 'Blue' } },
    { id: 'turmeric', name: 'Turmeric', source: 'n', colors: { neutral: 'Yellow', acid: 'Yellow', base: 'Reddish-Brown' } },
    { id: 'ph_paper', name: 'pH paper', source: 's', isPhTest: true, colors: { neutral: '', acid: '', base: '' } },
  ],
  assignedSolutions: [
    { id: 'hcl', name: 'Hydrochloric Acid', formula: 'HCl', type: 'acid', ph: 1 },
    { id: 'naoh', name: 'Sodium Hydroxide', formula: 'NaOH', type: 'base', ph: 14 },
  ],
}

function setup() {
  const events: { verb: XapiVerb; object: TelemetryEvent['object'] }[] = []
  let t = 1000
  const exp = new ChemistryExperiment(lesson, (verb, object) => events.push({ verb, object }), () => (t += 500))
  return { exp, events }
}

describe('ChemistryExperiment', () => {
  it('blocks testing until the required indicators are chosen', () => {
    const { exp } = setup()
    expect(exp.canTest(0).ok).toBe(false)
    exp.toggleIndicator('litmus')
    expect(() => exp.startTesting()).toThrow(StateError)
    exp.toggleIndicator('turmeric')
    exp.startTesting()
    expect(exp.phase).toBe('testing')
  })

  it('refuses a third indicator and the pH paper as a choice', () => {
    const { exp } = setup()
    expect(exp.toggleIndicator('ph_paper')).toBe(false)
    exp.toggleIndicator('litmus')
    exp.toggleIndicator('turmeric')
    expect(exp.toggleIndicator('nope')).toBe(false)
  })

  it('enforces the prediction gate: no action without a prediction', () => {
    const { exp } = setup()
    exp.toggleIndicator('litmus')
    exp.toggleIndicator('turmeric')
    exp.startTesting()
    expect(() => exp.act()).toThrow(StateError)
    expect(() => exp.predict(0, '', 2, 100)).toThrow(StateError)
  })

  it('fires PREDICTED before ACTED and OBSERVED, in order, with the reaction colour', () => {
    const { exp, events } = setup()
    exp.toggleIndicator('litmus')
    exp.toggleIndicator('turmeric')
    exp.startTesting()
    exp.predict(0, 'Red', 3, 2500)
    const r = exp.act()
    expect(r.actual).toBe('Red')
    expect(r.match).toBe(true)
    const verbs = events.map((e) => e.verb)
    expect(verbs.slice(-3)).toEqual([XapiVerb.PREDICTED, XapiVerb.ACTED, XapiVerb.OBSERVED])
    const predicted = events.find((e) => e.verb === XapiVerb.PREDICTED)!
    expect(predicted.object.value).toBe('Red')
    expect((predicted.object.data as { decisionMs: number }).decisionMs).toBe(2500)
  })

  it('does not allow a second test while one is pending, or repeating a result', () => {
    const { exp } = setup()
    exp.toggleIndicator('litmus')
    exp.toggleIndicator('turmeric')
    exp.startTesting()
    exp.predict(0, 'Red', 1, 10)
    expect(exp.canTest(1).ok).toBe(false)
    exp.act()
    expect(exp.canTest(0).ok).toBe(false)
    expect(exp.canTest(1).ok).toBe(true)
  })

  it('logs REVISED_MODEL when a conclusion changes after new evidence', () => {
    const { exp, events } = setup()
    exp.toggleIndicator('litmus')
    exp.toggleIndicator('turmeric')
    exp.startTesting()
    exp.selectTool('turmeric')
    exp.predict(0, 'Yellow', 1, 10)
    exp.act()
    exp.setConclusion(0, 'neutral')
    exp.selectTool('litmus')
    exp.predict(0, 'Purple', 1, 10)
    exp.act()
    exp.setConclusion(0, 'acid')
    const revised = events.filter((e) => e.verb === XapiVerb.REVISED_MODEL)
    expect(revised).toHaveLength(1)
    expect(revised[0].object.data).toMatchObject({ from: 'neutral', to: 'acid', wasCorrect: false, nowCorrect: true, evidenceCount: 2 })
  })

  it('refuses to conclude an untested tube', () => {
    const { exp } = setup()
    exp.toggleIndicator('litmus')
    exp.toggleIndicator('turmeric')
    exp.startTesting()
    expect(() => exp.setConclusion(1, 'base')).toThrow(StateError)
  })

  it('walks the whole flow to the reveal and scores it', () => {
    const { exp } = setup()
    exp.toggleIndicator('litmus')
    exp.toggleIndicator('turmeric')
    exp.startTesting()
    exp.selectTool('litmus')
    exp.predict(0, 'Red', 2, 10)
    exp.act()
    exp.recordColor(0, 'litmus', 'Red')
    exp.setConclusion(0, 'acid')
    expect(exp.phase).toBe('testing')
    exp.predict(1, 'Purple', 2, 10)
    exp.act()
    exp.setConclusion(1, 'base')
    expect(exp.phase).toBe('ph')
    expect(exp.activeTool).toBe('ph_paper')
    exp.predict(0, 'Red', 3, 10)
    exp.act()
    exp.recordPh(0, 1)
    exp.predict(1, 'Purple', 3, 10)
    exp.act()
    expect(() => exp.submit()).toThrow(StateError)
    exp.recordPh(1, 13)
    const s = exp.submit()
    expect(exp.phase).toBe('reveal')
    expect(s.conclusionsCorrect).toBe(2)
    expect(s.phExact).toBe(1)
    expect(s.phWithinOne).toBe(2)
    expect(s.predictionsCorrect).toBe(3)
    expect(s.colorEntriesCorrect).toBe(1)
  })

  it('rejects an out-of-range pH', () => {
    const { exp } = setup()
    expect(() => exp.recordPh(0, 20)).toThrow(StateError)
  })
})
